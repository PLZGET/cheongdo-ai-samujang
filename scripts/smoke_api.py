"""API 수준 E2E 확인: 게스트 작업공간 → 아침 업무 → 확인 질문 답변 → 승인 → 정답 대조 → 중복 승인.

사용: python scripts/smoke_api.py [BASE_URL]
"""

import json
import sys
import time

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
                print(f"  Q {q['title']} → {rec}")
            run = c.post(f"{url}/respond", json={"request_id": run["pending"]["request_id"], "answers": answers}).json()
            run = wait(c, url, {"waiting_approval", "failed"})
        if run["status"] != "waiting_approval":
            print("실패", run.get("error"))
            sys.exit(1)
        plan = run["pending"]["data"]["plan"]
        print("출고", plan["counts"], "메시지", len(plan.get("drafts", [])))
        req = run["pending"]["request_id"]
        first = c.post(f"{url}/respond", json={"request_id": req, "decision": "approve"})
        second = c.post(f"{url}/respond", json={"request_id": req, "decision": "approve"})
        print("승인 응답", first.status_code, "중복 승인 응답", second.status_code)
        run = wait(c, url, {"completed", "conflict", "failed", "rejected"})
        print("최종", run["status"], run.get("result"), f"총 {time.time() - t0:.0f}s")
        ev = c.get(f"{BASE}/api/workspaces/{wsid}/evaluation").json()
        print("정답 대조", json.dumps(ev["summary"], ensure_ascii=False))
        for name, rows in ev["details"].items():
            for r in rows:
                if not r["match"]:
                    print("  불일치", name, r)
        if ev["extra_lines"]:
            print("  정답에 없는 줄", ev["extra_lines"])
        csv_text = c.get(f"{BASE}/api/workspaces/{wsid}/exports/courier.csv").text
        print("택배 CSV 줄 수", len(csv_text.strip().splitlines()) - 1)
        print("wsid", wsid)


if __name__ == "__main__":
    main()
