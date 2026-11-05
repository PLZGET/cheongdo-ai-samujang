"""API 수준 E2E 확인: 게스트 작업공간 → 아침 업무 → 확인 질문 답변 → 승인 → 정답 대조 → 중복 승인.

사용: python scripts/smoke_api.py [BASE_URL]
"""

import csv
import io
import json
import sys
import time
from pathlib import Path

import httpx

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000").rstrip("/")
RECOMMENDED = {"last_year_repeat": "accept", "deposit_match": "link", "ship_date_conflict": "today", "overpayment": "refund"}


def wait(client: httpx.Client, url: str, statuses: set[str], timeout: float = 420) -> dict:
    start = time.time()
    seen = 0
    while time.time() - start < timeout:
        run = client.get(url).json()
        for ev in run["events"][seen:]:
            print(f"  [{ev.get('step', ev.get('kind'))}] {ev.get('status')} {ev.get('text', '')}")
        seen = len(run["events"])
        if run["status"] in statuses:
            return run
        time.sleep(2)
    raise TimeoutError(f"상태 대기 시간 초과: {statuses}")


FAILURES: list[str] = []


def check(ok: bool, label: str) -> None:
    print(("  PASS " if ok else "  FAIL ") + label)
    if not ok:
        FAILURES.append(label)


def snapshot(c: httpx.Client, wsid: str) -> dict:
    s = c.get(f"{BASE}/api/workspaces/{wsid}").json()["state"]
    led = s["ledger"]
    return {
        "orders": sorted(o["order_id"] for o in led["orders"]),
        "payments": sorted(p["deposit_id"] for p in led["payments"]),
        "refunds": len(led["refunds"]),
        "shipments": sorted(x["shipment_id"] for x in led["shipments"]),
        "inventory": {k: v["on_hand"] for k, v in s["inventory"].items()},
    }


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    with httpx.Client(timeout=60) as c:
        print("health", c.get(f"{BASE}/api/health").json())
        wsid = c.post(f"{BASE}/api/workspaces").json()["wsid"]
        ws = c.get(f"{BASE}/api/workspaces/{wsid}").json()["state"]
        t0 = time.time()
        run = c.post(f"{BASE}/api/workspaces/{wsid}/runs/morning", json={"inbox": ws["samples"]["inbox"], "deposits": ws["samples"]["deposits"]}).json()
        url = f"{BASE}/api/workspaces/{wsid}/runs/{run['run_id']}"
        run = wait(c, url, {"waiting_questions", "waiting_approval", "failed"})
        print(f"1차 처리 {time.time() - t0:.0f}s, 상태 {run['status']}")
        if run["status"] == "waiting_questions":
            qs = run["pending"]["data"]["questions"]
            answers = {}
            for q in qs:
                rec = RECOMMENDED.get(q["type"]) or next((o["value"] for o in q["options"] if o["recommended"]), q["options"][0]["value"])
                answers[q["id"]] = rec
                print(f"  Q [{q['type']}] {q['title']} → {rec}")
            run = c.post(f"{url}/respond", json={"request_id": run["pending"]["request_id"], "answers": answers}).json()
            run = wait(c, url, {"waiting_approval", "failed"})
        check(run["status"] == "waiting_approval", f"승인 대기 도달 (실제 {run['status']} {run.get('error') or ''})")
        if run["status"] != "waiting_approval":
            return
        plan = run["pending"]["data"]["plan"]
        print("출고", plan["counts"], "메시지", len(plan.get("drafts", [])))
        req = run["pending"]["request_id"]
        first = c.post(f"{url}/respond", json={"request_id": req, "decision": "approve"})
        second = c.post(f"{url}/respond", json={"request_id": req, "decision": "approve"})
        check(first.status_code == 200 and second.status_code == 200, f"승인·같은 승인 재전송 응답 200 ({first.status_code}, {second.status_code})")
        run = wait(c, url, {"completed", "conflict", "failed", "rejected", "cancelled"})
        print(f"총 {time.time() - t0:.0f}s", run.get("result"))
        check(run["status"] == "completed" and (run.get("result") or {}).get("status") == "committed", f"최종 상태 completed/committed (실제 {run['status']} {run.get('result')})")
        if run["status"] != "completed":
            return

        ev = c.get(f"{BASE}/api/workspaces/{wsid}/evaluation").json()
        print("정답 대조", json.dumps(ev["summary"], ensure_ascii=False))
        for name, s in ev["summary"].items():
            misses = [r for r in ev["details"][name] if not r["match"]]
            check(s["matched"] == s["total"], f"{name} {s['matched']}/{s['total']}" + (f" 불일치 {misses}" if misses else ""))
        check(not ev["extra_lines"], f"정답에 없는 장부 줄 없음 {ev['extra_lines'] or ''}")

        before = snapshot(c, wsid)
        time.sleep(3)
        check(snapshot(c, wsid) == before, "같은 승인 재전송 뒤 장부·재고 추가 변경 없음")

        # 이미 확정한 같은 자료를 새 실행으로 다시 넣어도 장부가 바뀌지 않아야 한다.
        again = c.post(f"{BASE}/api/workspaces/{wsid}/runs/morning", json={"inbox": ws["samples"]["inbox"], "deposits": ws["samples"]["deposits"]}).json()
        again = wait(c, f"{BASE}/api/workspaces/{wsid}/runs/{again['run_id']}", {"completed", "waiting_questions", "waiting_approval", "failed"})
        check(again["status"] == "completed" and (again.get("result") or {}).get("status") == "duplicate_input", f"같은 자료 새 실행은 재반영 없이 종료 (실제 {again['status']} {again.get('result')})")
        check(snapshot(c, wsid) == before, "같은 자료 새 실행 뒤 주문·입금·출고·재고 변경 없음")

        state = c.get(f"{BASE}/api/workspaces/{wsid}").json()["state"]
        rows = list(csv.reader(io.StringIO(c.get(f"{BASE}/api/workspaces/{wsid}/exports/courier.csv").content.decode("utf-8-sig"))))
        got = sorted((r[0], r[1], r[3], int(r[5])) for r in rows[1:])
        want = sorted((s["order_id"], s["recipient"], s["address"], s["qty"]) for s in state["ledger"]["shipments"] if not s.get("tracking"))
        check(got == want and len(got) > 0, f"택배 CSV {len(got)}줄 = 확정 출고 {len(want)}줄 (주문번호·받는분·주소·수량)")
        ship_orders = sorted((o["order_id"], o["recipient"], o["address"], o["qty"]) for o in state["ledger"]["orders"] if o["status"] == "ship_today")
        check(ship_orders == want, "확정 장부의 오늘 출고 주문 = 출고 목록")
        expected_boxes = sum(e["qty"] for e in scenario_key()["lines"] if e["status"] == "ship_today")
        check(sum(r[3] for r in got) == expected_boxes, f"CSV 박스 수 {sum(r[3] for r in got)} = 정답 {expected_boxes}")
        print("wsid", wsid)


def scenario_key() -> dict:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
    from app.scenario import ANSWER_KEY

    return ANSWER_KEY


if __name__ == "__main__":
    main()
    print("결과:", "통과" if not FAILURES else f"실패 {len(FAILURES)}건")
    sys.exit(1 if FAILURES else 0)
