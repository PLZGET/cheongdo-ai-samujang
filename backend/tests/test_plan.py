"""결정적 계획 엔진 검증: 이상적인 에이전트 출력을 넣었을 때 정답 장부와 일치해야 한다."""

from app import scenario
from app.morning import build_committed_state, compute_plan, deposit_key, message_key, source_fingerprints
from app.parsing import PhoneMasker, parse_deposits, parse_kakao


def order(product, qty, recipient, address, ids, **kw):
    return {"product": product, "qty": qty, "recipient": recipient, "address": address, "phone": None, "requested_when": kw.get("when"), "source_ids": ids, "history": "", "from_last_year": kw.get("last_year", False)}


def ok(customer, orders, **kw):
    return {
        "customer": customer,
        "ok": True,
        "result": {
            "customer": customer,
            "orders": orders,
            "cancelled": kw.get("cancelled", []),
            "needs_confirmation": kw.get("confirm", []),
            "injection_flags": kw.get("flags", []),
            "inquiries": kw.get("inquiries", []),
        },
    }


def make_job():
    ws = scenario.new_workspace_state()
    messages = parse_kakao(scenario.INBOX, ws["farm"]["owner"], 2026)
    masker = PhoneMasker()
    for m in messages:
        m["text_masked"] = masker.mask(m["text"])
    first = {}
    for m in messages:
        first.setdefault(m["sender"], m["at"])
    return {
        "wsid": "w", "run_id": "abcdef123456", "etag": "e", "ws": ws, "messages": messages,
        "deposits": parse_deposits(scenario.DEPOSITS, 2026), "phone_map": masker.mapping,
        "profiles_masked": {}, "first_message_at": first,
    }


INTAKE = {
    "이영희": ok("이영희", [order("B5", 2, "이영희", "대구 수성구 달구벌대로 123", ["m1", "m3"]), order("B5", 1, "이영숙", "서울 송파구 올림픽로 300", ["m3", "m11"])]),
    "박민수": ok("박민수", [order("B5", 1, "박민수", "경기 성남시 분당구 정자일로 45", ["m2"], last_year=True)], confirm=[{"topic": "last_year_repeat", "text": "작년처럼", "source_ids": ["m2"]}]),
    "최정우": ok("최정우", [order("B10", 1, "최정우", "부산 해운대구 센텀중앙로 55", ["m4", "m5"])], cancelled=[{"product": "GM1", "qty": 2, "source_ids": ["m5"], "note": ""}]),
    "정미경": ok("정미경", [order("B5", 1, "정미경", "대구 북구 침산로 77", ["m6"]), order("B5", 1, "오지현", "경북 경산시 대학로 280", ["m6"])]),
    "한상철": ok("한상철", [order("B10", 1, "한상철", "제주시 연동 1234-5", ["m7"])], inquiries=[{"text": "제주 배송 가능?", "source_ids": ["m7"]}]),
    "윤서준": ok("윤서준", [order("B5", 1, "윤서준", "서울 마포구 월드컵로 10", ["m8"])], flags=[{"source_id": "m8", "text": "결제 완료·0원 지시"}]),
    "강은비": ok("강은비", [order("B5", 2, "강은비", "인천 연수구 송도과학로 32", ["m9"], when="내일 금요일")]),
    "서동욱": ok("서동욱", [order("B5", 4, "서동욱", "대전 유성구 대학로 99", ["m10"])]),
    "문상현": ok("문상현", [order("B10", 1, "문상현", None, ["m12"])]),
}
SHIPPING = {
    f"{c}#{i + 1}": {"address_complete": bool(o["address"]), "requested_date": None, "note": ""}
    for c, item in INTAKE.items()
    for i, o in enumerate(item["result"]["orders"])
}
SHIPPING["강은비#1"]["requested_date"] = "2026-11-06"
FINANCE = {"matches": [{"deposit_id": "d4", "customer": "박민수", "reason": "배우자 김순자, 금액 일치", "certain": False}]}


def test_questions_before_answers():
    plan = compute_plan(make_job(), INTAKE, FINANCE, SHIPPING, {})
    types = sorted(q["type"] for q in plan["questions"])
    assert types == ["deposit_match", "last_year_repeat", "overpayment", "ship_date_conflict"]
    yoon = next(l for l in plan["lines"] if l["customer"] == "윤서준")
    assert yoon["status"] == "wait_payment"


def test_family_deposit_found_without_finance_agent():
    plan = compute_plan(make_job(), INTAKE, {"matches": []}, SHIPPING, {})
    q = next(q for q in plan["questions"] if q["type"] == "deposit_match")
    assert q["customer"] == "박민수" and "배우자" in q["detail"]


def test_plan_matches_answer_key():
    answers = {
        "last_year_repeat:박민수": "accept",
        "deposit_match:d4": "link",
        "ship_date_conflict:강은비#1": "today",
        "overpayment:최정우": "refund",
    }
    job = make_job()
    plan = compute_plan(job, INTAKE, FINANCE, SHIPPING, answers)
    assert plan["questions"] == []
    got = sorted((l["customer"], l["product"], l["qty"], l["recipient"], l["status"]) for l in plan["lines"])
    want = sorted((e["customer"], e["product"], e["qty"], e["recipient"], e["status"]) for e in scenario.ANSWER_KEY["lines"])
    assert got == want
    assert {c: p["status"] for c, p in plan["payments"].items()} == scenario.ANSWER_KEY["payments"]
    assert {r["customer"]: r["amount"] for r in plan["refunds"]} == scenario.ANSWER_KEY["refunds"]
    assert {k: v["on_hand"] for k, v in plan["inventory_after"].items()} == scenario.ANSWER_KEY["inventory_on_hand_after"]
    assert plan["payments"]["한상철"]["total"] == 48000

    state, summary = build_committed_state(job, plan)
    assert summary["shipped_boxes"] == 13
    assert len(state["ledger"]["shipments"]) == 8


def test_shipping_failure_holds_lines_until_confirmed():
    plan = compute_plan(make_job(), INTAKE, FINANCE, {"_failed": "timeout"}, {})
    assert all(l["status"] == "hold" and not l["shipping_verified"] for l in plan["lines"])
    assert all(l["status_label"] == "보류 · 배송 검증 실패" for l in plan["lines"])
    assert sum(1 for q in plan["questions"] if q["type"] == "ship_unverified") == len(plan["lines"])
    assert plan["counts"]["ship_today_boxes"] == 0

    missing = {k: v for k, v in SHIPPING.items() if k != "서동욱#1"}
    plan = compute_plan(make_job(), INTAKE, FINANCE, missing, {"ship_verify:서동욱#1": "hold"})
    seo = next(l for l in plan["lines"] if l["customer"] == "서동욱")
    assert seo["status"] == "hold" and "없습니다" in seo["verify_issue"]
    plan = compute_plan(make_job(), INTAKE, FINANCE, missing, {"ship_verify:서동욱#1": "confirm_today"})
    seo = next(l for l in plan["lines"] if l["customer"] == "서동욱")
    assert seo["status"] == "ship_today"

    vague = {**SHIPPING, "강은비#1": {"address_complete": True, "requested_date": None, "note": ""}}
    plan = compute_plan(make_job(), INTAKE, FINANCE, vague, {})
    kang = next(l for l in plan["lines"] if l["customer"] == "강은비")
    assert kang["status"] == "hold" and "내일 금요일" in kang["verify_issue"]


def test_same_sources_not_reapplied_but_distinct_orders_kept():
    job = make_job()
    job["source_fps"] = source_fingerprints(job["messages"], message_key) + source_fingerprints(job["deposits"], deposit_key)
    answers = {"last_year_repeat:박민수": "accept", "deposit_match:d4": "link", "ship_date_conflict:강은비#1": "today", "overpayment:최정우": "refund"}
    state, _ = build_committed_state(job, compute_plan(job, INTAKE, FINANCE, SHIPPING, answers))
    processed = set(state["ledger"]["processed_sources"])
    again = parse_kakao(scenario.INBOX, state["farm"]["owner"], 2026)
    assert all(f in processed for f in source_fingerprints(again, message_key))
    assert all(f in processed for f in source_fingerprints(parse_deposits(scenario.DEPOSITS, 2026), deposit_key))
    # 같은 고객·같은 내용이라도 다른 시각의 새 메시지는 별개 주문으로 처리한다.
    repeat = dict(again[0], at="2026-11-06T09:00")
    assert source_fingerprints([repeat], message_key)[0] not in processed
    # 한 자료 안의 동일한 메시지 두 건도 둘 다 처리 대상이다.
    twin = source_fingerprints([again[0], again[0]], message_key)
    assert twin[0] != twin[1]
