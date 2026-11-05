"""아침 업무 처리 워크플로(Microsoft Agent Framework).

prepare → 접수 에이전트 3개(병렬) → merge → 정산·배송 에이전트(병렬) → plan → 검토 에이전트
  → (중대한 지적이면 재접수 1회) → 사장님 확인 질문(HITL) → replan → 고객응대 에이전트
  → 승인(HITL) → commit(트랜잭션)
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from datetime import date
from typing import Any, Callable

from agent_framework import Executor, WorkflowBuilder, WorkflowContext, handler, response_handler

from . import domain
from .agents import (
    CommsOut,
    CopilotRuntime,
    FinanceOut,
    IntakeOut,
    ReviewOut,
    ShippingOut,
    run_structured,
)
from .parsing import PhoneMasker, parse_deposits, parse_kakao
from .store import CommitConflict, Store

WORKFLOW_NAME = "morning-ops"
INTAKE_WORKERS = 3

# run_id → 진행 이벤트 수신 함수. 실행 중 화면 표시용이며 체크포인트에는 저장하지 않는다.
PROGRESS: dict[str, Callable[[dict], None]] = {}


def emit(run_id: str, **event: Any) -> None:
    fn = PROGRESS.get(run_id)
    if fn:
        fn(event)


@dataclass
class Deps:
    store: Store
    runtime: CopilotRuntime


def ws_view(job: dict) -> dict:
    ws = job["ws"]
    return {
        "catalog": ws["catalog"],
        "policy": ws["policy"],
        "business_date": ws["business_date"],
        "inventory": ws["inventory"],
        "ledger": ws["ledger"],
        "profiles_masked": job["profiles_masked"],
    }


def message_block(job: dict, customer: str) -> str:
    return "\n".join(f"{m['id']} | {m['at']} | {m['text_masked']}" for m in job["messages"] if m["sender"] == customer)


# ---------------------------------------------------------------- 계획(결정적 계산)


def compute_plan(job: dict, intake: dict, finance: dict, shipping: dict, answers: dict) -> dict:
    ws = job["ws"]
    catalog, policy = ws["catalog"], ws["policy"]
    today = date.fromisoformat(ws["business_date"])
    blocked = policy["no_ship_weekdays_perishable"]
    questions: list[dict] = []
    lines: list[dict] = []
    cancellations, flags, inquiries, notes = [], [], [], []
    msg_by_id = {m["id"]: m for m in job["messages"]}

    def evidence(ids: list[str]) -> list[dict]:
        return [{"id": i, "at": msg_by_id[i]["at"], "text": msg_by_id[i]["text_masked"]} for i in ids if i in msg_by_id]

    for customer in sorted(intake):
        item = intake[customer]
        if not item.get("ok"):
            qid = f"intake_failed:{customer}"
            notes.append({"customer": customer, "text": f"AI 해석 실패: {item.get('error', '')}"})
            questions.append(
                {
                    "id": qid, "type": "intake_failed", "customer": customer,
                    "title": f"{customer}님 메시지를 AI가 해석하지 못했습니다",
                    "detail": "자동 처리에서 제외하고 보류합니다. 원문을 직접 확인해 주세요.",
                    "evidence": evidence([m["id"] for m in job["messages"] if m["sender"] == customer]),
                    "options": [{"value": "hold", "label": "보류(직접 처리)", "recommended": True}],
                }
            ) if qid not in answers else None
            continue
        res = item["result"]
        customer_hold = False
        for k, conf in enumerate(res.get("needs_confirmation", [])):
            if conf["topic"] == "last_year_repeat":
                continue
            qid = f"ambiguous:{customer}:{k}"
            if answers.get(qid) == "hold":
                customer_hold = True
            elif qid not in answers:
                questions.append(
                    {
                        "id": qid, "type": "ambiguous", "customer": customer,
                        "title": f"{customer}님 요청 확인", "detail": conf["text"], "evidence": evidence(conf.get("source_ids", [])),
                        "options": [
                            {"value": "proceed", "label": "AI 해석대로 진행", "recommended": False},
                            {"value": "hold", "label": "보류하고 고객에게 확인", "recommended": True},
                        ],
                    }
                )
        for i, o in enumerate(res.get("orders", [])):
            line_id = f"{customer}#{i + 1}"
            ship = shipping.get(line_id, {})
            complete = ship.get("address_complete", bool(o.get("address")))
            address = o.get("address") if complete else None
            line = {
                "line_id": line_id,
                "customer": customer,
                "product": o["product"],
                "qty": int(o["qty"]),
                "recipient": o["recipient"],
                "address": address,
                "address_raw": o.get("address"),
                "phone": o.get("phone"),
                "source_ids": o.get("source_ids", []),
                "history": o.get("history", ""),
                "from_last_year": bool(o.get("from_last_year")),
                "requested_when": o.get("requested_when"),
                "requested_date": ship.get("requested_date"),
                "shipping_note": ship.get("note", ""),
                "region": domain.region_of(address),
                "status": "pending",
            }
            if line["product"] not in catalog:
                line["status"] = "hold"
                notes.append({"customer": customer, "text": f"알 수 없는 상품 코드 {line['product']}"})
            if customer_hold:
                line["status"] = "hold"
            if line["from_last_year"]:
                qid = f"last_year_repeat:{customer}"
                ans = answers.get(qid)
                if ans == "hold":
                    line["status"] = "hold"
                elif ans != "accept":
                    line["status"] = "wait_confirm"
                    if not any(q["id"] == qid for q in questions):
                        product = catalog.get(line["product"], {}).get("name", line["product"])
                        questions.append(
                            {
                                "id": qid, "type": "last_year_repeat", "customer": customer,
                                "title": f"{customer}님의 '작년처럼' 주문",
                                "detail": f"작년 주문 기록({product} {line['qty']}박스, {line['recipient']}, {line['address_raw'] or '주소 없음'})으로 접수할까요?",
                                "evidence": evidence(line["source_ids"]),
                                "options": [
                                    {"value": "accept", "label": "작년과 같게 접수", "recommended": True},
                                    {"value": "hold", "label": "보류하고 고객에게 확인", "recommended": False},
                                ],
                            }
                        )
            override = answers.get(f"ship_date_conflict:{line_id}")
            if override == "today":
                line["ship_date_override"] = today.isoformat()
            elif override == "next":
                line["ship_date_override"] = domain.next_shippable_day(today, blocked).isoformat()
            elif override == "hold":
                line["status"] = "hold"
            lines.append(line)
        cancellations += [{"customer": customer, **c, "evidence": evidence(c.get("source_ids", []))} for c in res.get("cancelled", [])]
        flags += [{"customer": customer, **f, "evidence": evidence([f["source_id"]])} for f in res.get("injection_flags", [])]
        inquiries += [{"customer": customer, **q, "evidence": evidence(q.get("source_ids", []))} for q in res.get("inquiries", [])]

    totals = domain.customer_totals(lines, catalog, policy)
    for customer in intake:
        totals.setdefault(customer, 0)

    deposits = job["deposits"]
    ai_matches = {m["deposit_id"]: m for m in finance.get("matches", [])}
    matches = []
    for d in deposits:
        ai = ai_matches.get(d["id"])
        if d["payer"] in totals:
            matches.append({"deposit_id": d["id"], "customer": d["payer"], "confirmed": True, "by": "code", "reason": "입금자명과 주문자명 일치"})
        elif ai and ai["customer"] in totals:
            qid = f"deposit_match:{d['id']}"
            ans = answers.get(qid)
            matches.append({"deposit_id": d["id"], "customer": ai["customer"], "confirmed": ans == "link", "by": "ai", "reason": ai["reason"]})
            if ans is None:
                questions.append(
                    {
                        "id": qid, "type": "deposit_match", "customer": ai["customer"],
                        "title": f"{d['payer']} {domain.won(d['amount'])} 입금",
                        "detail": f"{ai['customer']}님 주문 입금으로 연결할까요? 근거: {ai['reason']}",
                        "evidence": [{"id": d["id"], "at": d["at"], "text": d["raw"]}],
                        "options": [
                            {"value": "link", "label": f"{ai['customer']}님 주문에 연결", "recommended": True},
                            {"value": "leave", "label": "미확인 입금으로 둠", "recommended": False},
                        ],
                    }
                )
    payments = domain.reconcile(totals, deposits, matches)
    unmatched_ids = set(payments.pop("_unmatched")["deposit_ids"])

    refunds = []
    for customer, p in payments.items():
        if p["status"] != "over":
            continue
        qid = f"overpayment:{customer}"
        ans = answers.get(qid)
        amount = -p["balance"]
        if ans == "refund":
            refunds.append({"customer": customer, "amount": amount, "reason": "초과 입금", "status": "pending"})
        elif ans is None:
            cancelled = [c for c in cancellations if c["customer"] == customer]
            reason = f" (취소: {', '.join(catalog.get(c['product'], {}).get('name', c['product']) for c in cancelled)})" if cancelled else ""
            questions.append(
                {
                    "id": qid, "type": "overpayment", "customer": customer,
                    "title": f"{customer}님 초과 입금 {domain.won(amount)}",
                    "detail": f"주문 금액 {domain.won(p['total'])}보다 {domain.won(amount)} 더 입금되었습니다{reason}. 환불 예정으로 기록할까요?",
                    "evidence": [{"id": i, "at": "", "text": next(d['raw'] for d in deposits if d['id'] == i)} for i in p["deposit_ids"]],
                    "options": [
                        {"value": "refund", "label": "환불 예정으로 기록", "recommended": True},
                        {"value": "hold", "label": "보류", "recommended": False},
                    ],
                }
            )

    customers_meta = {
        c: {"regular": bool(ws["customers"].get(c, {}).get("regular")), "first_message_at": job["first_message_at"].get(c, "9999")}
        for c in intake
    }
    alloc = domain.allocate(lines, payments, customers_meta, ws["inventory"], catalog, policy, today)

    for line in lines:
        if line["status"] == "date_conflict":
            qid = f"ship_date_conflict:{line['line_id']}"
            if qid in answers:
                continue
            next_day = domain.next_shippable_day(today, blocked)
            requested = domain.parse_date(line.get("requested_date"))
            questions.append(
                {
                    "id": qid, "type": "ship_date_conflict", "customer": line["customer"],
                    "title": f"{line['customer']}님 발송일 정책 충돌",
                    "detail": f"고객은 {domain.date_label(requested) if requested else line.get('requested_when')} 발송을 원하지만 반시는 금·토 발송을 하지 않습니다(주말 배송 중 무름 방지).",
                    "evidence": evidence(line["source_ids"]),
                    "options": [
                        {"value": "today", "label": f"오늘 {domain.date_label(today)} 발송", "recommended": True},
                        {"value": "next", "label": f"{domain.date_label(next_day)} 발송", "recommended": False},
                        {"value": "hold", "label": "고객에게 먼저 확인", "recommended": False},
                    ],
                }
            )

    for line in lines:
        line["status_label"] = domain.LINE_STATUS_LABEL.get(line["status"], line["status"])
        line["amount"] = domain.line_amount(line, catalog, policy) if line["product"] in catalog else 0
        line["product_name"] = catalog.get(line["product"], {}).get("name", line["product"])

    inv_after = domain.inventory_after(lines, ws["inventory"])
    deposit_rows = []
    match_by_dep = {m["deposit_id"]: m for m in matches}
    for d in deposits:
        m = match_by_dep.get(d["id"])
        deposit_rows.append({**d, "customer": m["customer"] if m else None, "confirmed": bool(m and m["confirmed"]), "by": m["by"] if m else None, "reason": m["reason"] if m else "연결 근거 없음", "unmatched": d["id"] in unmatched_ids})

    shortages_alt = []
    if alloc["shortages"]:
        for code, qty in alloc["shortages"].items():
            alts = [f"다음 수확분({domain.date_label(date.fromisoformat(policy['next_harvest_date']))}) 예약"]
            for alt_code, left in alloc["remaining"].items():
                if alt_code != code and catalog[alt_code]["perishable"] and left > 0:
                    alts.append(f"{catalog[alt_code]['name']}로 변경(남은 {left}박스)")
            shortages_alt.append({"product": code, "product_name": catalog[code]["name"], "qty": qty, "alternatives": alts})

    return {
        "lines": lines,
        "cancellations": cancellations,
        "flags": flags,
        "inquiries": inquiries,
        "notes": notes,
        "payments": payments,
        "deposits": deposit_rows,
        "refunds": refunds,
        "questions": questions,
        "inventory_before": ws["inventory"],
        "inventory_after": inv_after,
        "shortages": shortages_alt,
        "remaining": alloc["remaining"],
        "counts": {
            "ship_today_boxes": sum(l["qty"] for l in lines if l["status"] == "ship_today"),
            "ship_today_parcels": sum(1 for l in lines if l["status"] == "ship_today"),
            "customers": len(intake),
            "messages": len(job["messages"]),
            "deposits": len(deposits),
        },
    }


def comms_facts(job: dict, plan: dict) -> list[dict]:
    ws = job["ws"]
    policy = ws["policy"]
    facts = []
    for customer, pay in plan["payments"].items():
        cust_lines = [l for l in plan["lines"] if l["customer"] == customer]
        refund = next((r["amount"] for r in plan["refunds"] if r["customer"] == customer), 0)
        items = []
        for l in cust_lines:
            entry = {"받는분": l["recipient"], "상품": l["product_name"], "수량": l["qty"], "상태": l["status_label"]}
            if l.get("ship_date"):
                entry["발송일"] = domain.date_label(date.fromisoformat(l["ship_date"]))
            if l["region"] in ("jeju", "island"):
                entry["도서지역 추가운임"] = domain.won(policy["remote_fee_per_box"] * l["qty"])
            if l["status"] == "short_stock":
                entry["대안"] = next((s["alternatives"] for s in plan["shortages"] if s["product"] == l["product"]), [])
            if l["status"] == "wait_address":
                entry["요청"] = "받는 분 주소와 연락처 필요"
            if l.get("requested_when"):
                entry["고객 희망"] = l["requested_when"]
            items.append(entry)
        cancels = [c for c in plan["cancellations"] if c["customer"] == customer]
        asks = [q["text"] for q in plan["inquiries"] if q["customer"] == customer]
        allowed = {pay["total"], pay["paid"], abs(pay["balance"]), refund, policy["remote_fee_per_box"]}
        allowed |= {p["price"] for p in ws["catalog"].values()}
        allowed |= {l["amount"] for l in cust_lines}
        facts.append(
            {
                "customer": customer,
                "주문": items,
                "취소 반영": [ws["catalog"].get(c["product"], {}).get("name", c["product"]) for c in cancels],
                "주문 금액": domain.won(pay["total"]),
                "입금 확인 금액": domain.won(pay["paid"]),
                "남은 입금액": domain.won(pay["balance"]) if pay["balance"] > 0 else "없음",
                "환불 예정": domain.won(refund) if refund else "없음",
                "고객 문의": asks,
                "_allowed": sorted(a for a in allowed if a),
            }
        )
    return facts


# ---------------------------------------------------------------- 실행 단계(Executor)


class Prepare(Executor):
    def __init__(self, deps: Deps) -> None:
        super().__init__(id="prepare")
        self.deps = deps

    @handler
    async def run(self, job_in: dict, ctx: WorkflowContext[dict]) -> None:
        run_id = job_in["run_id"]
        emit(run_id, kind="step", step="prepare", status="running", text="메시지·입금 문자 읽기, 전화번호 가명화")
        loaded = await self.deps.store.get_workspace(job_in["wsid"])
        if loaded is None:
            raise ValueError("작업공간을 찾을 수 없습니다")
        ws, etag = loaded
        year = int(ws["business_date"][:4])
        messages = parse_kakao(job_in["inbox"], ws["farm"]["owner"], year)
        deposits = parse_deposits(job_in["deposits"], year)
        masker = PhoneMasker()
        for m in messages:
            m["text_masked"] = masker.mask(m["text"])
        profiles_masked = json.loads(masker.mask(json.dumps({k: {"customer": k, **v} for k, v in ws["customers"].items()}, ensure_ascii=False)))
        first_at: dict[str, str] = {}
        for m in messages:
            first_at.setdefault(m["sender"], m["at"])
        job = {
            "wsid": job_in["wsid"],
            "run_id": run_id,
            "etag": etag,
            "ws": ws,
            "messages": messages,
            "deposits": deposits,
            "phone_map": masker.mapping,
            "profiles_masked": profiles_masked,
            "first_message_at": first_at,
        }
        ctx.set_state("job", job)
        ctx.set_state("review_round", 0)
        customers = sorted(first_at)
        emit(run_id, kind="step", step="prepare", status="done", text=f"고객 {len(customers)}명, 메시지 {len(messages)}건, 입금 {len(deposits)}건, 전화번호 {len(masker.mapping)}개 가명화")
        await ctx.send_message({"customers": customers})


async def intake_one(deps: Deps, job: dict, customer: str, worker: str, feedback: str | None = None) -> dict:
    run_id = job["run_id"]
    emit(run_id, kind="agent", step=worker, status="running", text=f"{customer}님 메시지 해석")
    prompt = (
        f"기준일: {job['ws']['business_date']}\n고객: {customer}\n메시지(id | 시각 | 내용, 시간순):\n{message_block(job, customer)}"
    )
    if feedback:
        prompt += f"\n\n검토 담당의 지적(원문과 다시 대조해 고쳐라):\n{feedback}"
    try:
        out = await run_structured(deps.runtime.agent("intake"), prompt, IntakeOut, ws_view(job))
        data = out.model_dump()
        data["customer"] = customer
        summary = f"{customer}: 주문 {len(data['orders'])}줄"
        if data["cancelled"]:
            summary += f", 취소 {len(data['cancelled'])}건"
        if data["injection_flags"]:
            summary += ", 메시지 속 지시문 무시"
        emit(run_id, kind="agent", step=worker, status="done", text=summary)
        return {"customer": customer, "ok": True, "result": data}
    except Exception as exc:  # noqa: BLE001
        emit(run_id, kind="agent", step=worker, status="failed", text=f"{customer}: 해석 실패 — 보류 처리")
        return {"customer": customer, "ok": False, "error": str(exc)[:300]}


class IntakeWorker(Executor):
    def __init__(self, deps: Deps, index: int) -> None:
        super().__init__(id=f"intake_{index + 1}")
        self.deps = deps
        self.index = index

    @handler
    async def run(self, msg: dict, ctx: WorkflowContext[list]) -> None:
        job = ctx.get_state("job")
        mine = msg["customers"][self.index :: INTAKE_WORKERS]
        results = await asyncio.gather(*(intake_one(self.deps, job, c, self.id) for c in mine))
        await ctx.send_message(list(results))


class Reintake(Executor):
    def __init__(self, deps: Deps) -> None:
        super().__init__(id="reintake")
        self.deps = deps

    @handler
    async def run(self, msg: dict, ctx: WorkflowContext[dict]) -> None:
        job = ctx.get_state("job")
        results = await asyncio.gather(
            *(intake_one(self.deps, job, c, self.id, msg["feedback"].get(c)) for c in msg["customers"])
        )
        await ctx.send_message({"results": list(results)})


class Merge(Executor):
    def __init__(self) -> None:
        super().__init__(id="merge")

    @handler
    async def from_workers(self, parts: list, ctx: WorkflowContext[dict]) -> None:
        await self._merge([r for part in parts for r in part], ctx)

    @handler
    async def from_reintake(self, msg: dict, ctx: WorkflowContext[dict]) -> None:
        await self._merge(msg["results"], ctx)

    async def _merge(self, results: list[dict], ctx: WorkflowContext[dict]) -> None:
        intake = dict(ctx.get_state("intake") or {})
        for r in results:
            intake[r["customer"]] = r
        ctx.set_state("intake", intake)
        await ctx.send_message({"stage": "intake_merged"})


def draft_lines(intake: dict) -> list[dict]:
    rows = []
    for customer in sorted(intake):
        item = intake[customer]
        if not item.get("ok"):
            continue
        for i, o in enumerate(item["result"]["orders"]):
            rows.append({"line_id": f"{customer}#{i + 1}", "customer": customer, **o})
    return rows


class Finance(Executor):
    def __init__(self, deps: Deps) -> None:
        super().__init__(id="finance")
        self.deps = deps

    @handler
    async def run(self, _msg: dict, ctx: WorkflowContext[dict]) -> None:
        job, intake = ctx.get_state("job"), ctx.get_state("intake")
        run_id = job["run_id"]
        emit(run_id, kind="agent", step="finance", status="running", text="입금 문자와 주문 금액 대조")
        catalog, policy = job["ws"]["catalog"], job["ws"]["policy"]
        totals: dict[str, int] = {}
        for row in draft_lines(intake):
            if row["product"] in catalog:
                row = {**row, "region": domain.region_of(row.get("address"))}
                totals[row["customer"]] = totals.get(row["customer"], 0) + domain.line_amount(row, catalog, policy)
        deposits = "\n".join(f"{d['id']} | {d['at']} | 입금자 {d['payer']} | {domain.won(d['amount'])}" for d in job["deposits"])
        orders = "\n".join(f"{c} | 주문 금액(작년처럼 제안 포함) {domain.won(t)}" for c, t in sorted(totals.items()))
        prompt = f"입금 문자:\n{deposits}\n\n고객별 주문 금액(코드 계산):\n{orders}"
        try:
            out = await run_structured(self.deps.runtime.agent("finance"), prompt, FinanceOut, ws_view(job))
            data = out.model_dump()
            emit(run_id, kind="agent", step="finance", status="done", text=f"입금 {len(data['matches'])}건 연결 제안")
        except Exception as exc:  # noqa: BLE001
            data = {"matches": [], "notes": [f"정산 에이전트 실패: {str(exc)[:200]}"]}
            emit(run_id, kind="agent", step="finance", status="failed", text="정산 에이전트 실패 — 입금자명 일치 건만 자동 연결")
        ctx.set_state("finance", data)
        await ctx.send_message({"from": "finance"})


class Shipping(Executor):
    def __init__(self, deps: Deps) -> None:
        super().__init__(id="shipping")
        self.deps = deps

    @handler
    async def run(self, _msg: dict, ctx: WorkflowContext[dict]) -> None:
        job, intake = ctx.get_state("job"), ctx.get_state("intake")
        run_id = job["run_id"]
        emit(run_id, kind="agent", step="shipping", status="running", text="주소 완성도·발송 희망일 확인")
        rows = draft_lines(intake)
        text = "\n".join(
            f"{r['line_id']} | 받는분 {r['recipient']} | 주소 {r.get('address') or '없음'} | 희망 {r.get('requested_when') or '없음'}" for r in rows
        )
        today = date.fromisoformat(job["ws"]["business_date"])
        prompt = f"기준일: {today.isoformat()} ({domain.WEEKDAY_KO[today.weekday()]}요일)\n주문 줄:\n{text}"
        try:
            out = await run_structured(self.deps.runtime.agent("shipping"), prompt, ShippingOut, ws_view(job))
            data = {l.line_id: l.model_dump() for l in out.lines}
            incomplete = sum(1 for v in data.values() if not v["address_complete"])
            emit(run_id, kind="agent", step="shipping", status="done", text=f"{len(data)}줄 확인, 주소 미완성 {incomplete}건")
        except Exception:  # noqa: BLE001
            data = {}
            emit(run_id, kind="agent", step="shipping", status="failed", text="배송 에이전트 실패 — 주소 유무만으로 판단")
        ctx.set_state("shipping", data)
        await ctx.send_message({"from": "shipping"})


class Plan(Executor):
    def __init__(self) -> None:
        super().__init__(id="plan")

    @handler
    async def run(self, _parts: list, ctx: WorkflowContext[dict]) -> None:
        job = ctx.get_state("job")
        emit(job["run_id"], kind="step", step="plan", status="running", text="금액·입금·재고 배정·출고 정책 계산(코드)")
        plan = compute_plan(job, ctx.get_state("intake"), ctx.get_state("finance") or {}, ctx.get_state("shipping") or {}, {})
        ctx.set_state("plan", plan)
        emit(job["run_id"], kind="step", step="plan", status="done", text=f"오늘 출고 {plan['counts']['ship_today_boxes']}박스, 확인 필요 {len(plan['questions'])}건")
        await ctx.send_message({"stage": "planned"})


class Review(Executor):
    def __init__(self, deps: Deps) -> None:
        super().__init__(id="review")
        self.deps = deps

    @handler
    async def run(self, _msg: dict, ctx: WorkflowContext[dict]) -> None:
        job, plan = ctx.get_state("job"), ctx.get_state("plan")
        rnd = ctx.get_state("review_round") or 0
        run_id = job["run_id"]
        emit(run_id, kind="agent", step="review", status="running", text="원문과 정리 결과를 독립 대조" + (" (재검토)" if rnd else ""))
        blocks = []
        for customer in sorted({m["sender"] for m in job["messages"]}):
            mine = [l for l in plan["lines"] if l["customer"] == customer]
            result = "; ".join(f"{l['recipient']} {l['product_name']} {l['qty']}박스 주소={l['address_raw'] or '없음'}" for l in mine) or "주문 없음"
            cancels = ", ".join(f"{c['product']} 취소" for c in plan["cancellations"] if c["customer"] == customer)
            blocks.append(f"## {customer}\n원문:\n{message_block(job, customer)}\n정리 결과: {result}{(' / ' + cancels) if cancels else ''}")
        try:
            out = await run_structured(self.deps.runtime.agent("review"), "\n\n".join(blocks), ReviewOut, ws_view(job))
            findings = [f.model_dump() for f in out.findings]
        except Exception as exc:  # noqa: BLE001
            findings = [{"customer": "-", "severity": "minor", "issue": f"검토 에이전트 실패: {str(exc)[:120]}", "fix": "사장님 직접 확인"}]
        critical = [f for f in findings if f["severity"] == "critical" and f["customer"] in (ctx.get_state("intake") or {})]
        ctx.set_state("review", {"round": rnd, "findings": findings})
        if critical and rnd == 0:
            ctx.set_state("review_round", 1)
            emit(run_id, kind="agent", step="review", status="done", text=f"중대한 불일치 {len(critical)}건 — 해당 고객 재해석 요청")
            feedback: dict[str, str] = {}
            for f in critical:
                feedback[f["customer"]] = (feedback.get(f["customer"], "") + f"- {f['issue']} → {f['fix']}\n").strip()
            await ctx.send_message({"action": "reintake", "customers": sorted(feedback), "feedback": feedback})
        else:
            emit(run_id, kind="agent", step="review", status="done", text="불일치 없음" if not findings else f"지적 {len(findings)}건(질문·메모로 전달)")
            await ctx.send_message({"action": "ask", "findings": findings})


class QuestionsGate(Executor):
    def __init__(self) -> None:
        super().__init__(id="questions")

    @handler
    async def run(self, msg: dict, ctx: WorkflowContext[dict]) -> None:
        job, plan = ctx.get_state("job"), ctx.get_state("plan")
        questions = list(plan["questions"])
        for i, f in enumerate(msg.get("findings", [])):
            if f["severity"] == "critical":
                questions.append(
                    {
                        "id": f"review:{i}", "type": "review", "customer": f["customer"],
                        "title": f"검토 담당 지적: {f['customer']}", "detail": f"{f['issue']} (제안: {f['fix']})", "evidence": [],
                        "options": [
                            {"value": "proceed", "label": "현재 정리대로 진행", "recommended": False},
                            {"value": "hold", "label": "이 고객 보류", "recommended": True},
                        ],
                    }
                )
        ctx.set_state("pending_questions", questions)
        if questions:
            emit(job["run_id"], kind="step", step="questions", status="waiting", text=f"사장님 확인 {len(questions)}건 대기")
            await ctx.request_info({"kind": "questions", "questions": questions, "plan": plan}, dict)
        else:
            await ctx.send_message({"answers": {}})

    @response_handler
    async def on_answers(self, request: dict, response: dict, ctx: WorkflowContext[dict]) -> None:
        valid: dict[str, str] = {}
        for q in request["questions"]:
            value = response.get("answers", {}).get(q["id"])
            allowed = {o["value"] for o in q["options"]}
            valid[q["id"]] = value if value in allowed else "hold"
        for qid, value in list(valid.items()):
            if qid.startswith("review:") and value == "hold":
                customer = next(q["customer"] for q in request["questions"] if q["id"] == qid)
                valid[f"ambiguous:{customer}:review"] = "hold"
        await ctx.send_message({"answers": valid})


class Replan(Executor):
    def __init__(self) -> None:
        super().__init__(id="replan")

    @handler
    async def run(self, msg: dict, ctx: WorkflowContext[dict]) -> None:
        job = ctx.get_state("job")
        answers = msg["answers"]
        intake = ctx.get_state("intake")
        held = {k.split(":")[1] for k, v in answers.items() if k.startswith("ambiguous:") and k.endswith(":review") and v == "hold"}
        if held:
            intake = {c: ({**v, "result": {**v["result"], "needs_confirmation": v["result"]["needs_confirmation"] + [{"topic": "other", "text": "검토 지적으로 보류", "source_ids": []}]}} if c in held and v.get("ok") else v) for c, v in intake.items()}
            for c in held:
                k = len(intake[c]["result"]["needs_confirmation"]) - 1 if intake[c].get("ok") else 0
                answers[f"ambiguous:{c}:{k}"] = "hold"
        plan = compute_plan(job, intake, ctx.get_state("finance") or {}, ctx.get_state("shipping") or {}, answers)
        plan["answers"] = answers
        plan["review"] = ctx.get_state("review")
        ctx.set_state("plan", plan)
        emit(job["run_id"], kind="step", step="replan", status="done", text=f"답변 반영 재계산: 오늘 출고 {plan['counts']['ship_today_boxes']}박스")
        await ctx.send_message({"stage": "replanned"})


class Comms(Executor):
    def __init__(self, deps: Deps) -> None:
        super().__init__(id="comms")
        self.deps = deps

    @handler
    async def run(self, _msg: dict, ctx: WorkflowContext[dict]) -> None:
        job, plan = ctx.get_state("job"), ctx.get_state("plan")
        run_id = job["run_id"]
        emit(run_id, kind="agent", step="comms", status="running", text="고객별 안내 메시지 초안 작성")
        facts = comms_facts(job, plan)
        allowed = {f["customer"]: set(f.pop("_allowed")) for f in facts}
        prompt = f"농가: {job['ws']['farm']['name']}\n고객별 사실(코드 계산값):\n{json.dumps(facts, ensure_ascii=False, indent=1)}"
        drafts = []
        try:
            out = await run_structured(self.deps.runtime.agent("comms"), prompt, CommsOut, ws_view(job))
            for d in out.drafts:
                if d.customer not in allowed:
                    continue
                bad = domain.unknown_amounts(d.text, allowed[d.customer])
                drafts.append({"customer": d.customer, "text": d.text, "amount_check": "ok" if not bad else "mismatch", "unknown_amounts": bad})
            emit(run_id, kind="agent", step="comms", status="done", text=f"메시지 {len(drafts)}통, 금액 검증 실패 {sum(1 for d in drafts if d['amount_check'] != 'ok')}통")
        except Exception:  # noqa: BLE001
            emit(run_id, kind="agent", step="comms", status="failed", text="고객응대 에이전트 실패 — 메시지 없이 승인 가능")
        plan["drafts"] = drafts
        ctx.set_state("plan", plan)
        await ctx.send_message({"stage": "drafted"})


class ApprovalGate(Executor):
    def __init__(self) -> None:
        super().__init__(id="approval")

    @handler
    async def run(self, _msg: dict, ctx: WorkflowContext[dict, dict]) -> None:
        job, plan = ctx.get_state("job"), ctx.get_state("plan")
        emit(job["run_id"], kind="step", step="approval", status="waiting", text="출고안 승인 대기")
        await ctx.request_info({"kind": "approval", "plan": plan}, dict)

    @response_handler
    async def on_decision(self, _request: dict, response: dict, ctx: WorkflowContext[dict, dict]) -> None:
        if response.get("decision") == "approve":
            await ctx.send_message({"decision": "approve"})
        else:
            await ctx.yield_output({"status": "rejected"})


def build_committed_state(job: dict, plan: dict) -> tuple[dict, dict]:
    ws = json.loads(json.dumps(job["ws"]))
    masker = PhoneMasker(job["phone_map"])
    run_id = job["run_id"]
    ledger = ws["ledger"]
    prefix = run_id[:6].upper()
    shipped = 0
    for n, line in enumerate(plan["lines"], start=1):
        order = {k: line.get(k) for k in ("line_id", "customer", "product", "product_name", "qty", "recipient", "address", "region", "status", "status_label", "ship_date", "amount", "history", "source_ids")}
        order.update(order_id=f"{prefix}-{n:02d}", run_id=run_id, phone=masker.unmask(line.get("phone")))
        ledger["orders"].append(order)
        if line["status"] == "ship_today":
            shipped += line["qty"]
            ledger["shipments"].append(
                {"shipment_id": f"S-{prefix}-{n:02d}", "order_id": order["order_id"], "customer": line["customer"], "recipient": line["recipient"], "phone": order["phone"], "address": line["address"], "product": line["product"], "product_name": line["product_name"], "qty": line["qty"], "ship_date": line["ship_date"], "tracking": None, "run_id": run_id}
            )
    for d in plan["deposits"]:
        if d["confirmed"]:
            ledger["payments"].append({"deposit_id": d["id"], "customer": d["customer"], "payer": d["payer"], "amount": d["amount"], "at": d["at"], "matched_by": d["by"], "run_id": run_id})
    for r in plan["refunds"]:
        ledger["refunds"].append({**r, "run_id": run_id})
    ws["inventory"] = plan["inventory_after"]
    ledger["accounts"] = plan["payments"]
    summary = {"run_id": run_id, "orders": len(plan["lines"]), "shipped_boxes": shipped, "refunds": sum(r["amount"] for r in plan["refunds"]), "payments": sum(1 for d in plan["deposits"] if d["confirmed"])}
    ledger["events"].append({"type": "morning_commit", **summary})
    return ws, summary


class Commit(Executor):
    def __init__(self, deps: Deps) -> None:
        super().__init__(id="commit")
        self.deps = deps

    @handler
    async def run(self, _msg: dict, ctx: WorkflowContext[dict, dict]) -> None:
        job, plan = ctx.get_state("job"), ctx.get_state("plan")
        run_id = job["run_id"]
        emit(run_id, kind="step", step="commit", status="running", text="장부·재고 확정(트랜잭션)")
        state, summary = build_committed_state(job, plan)
        try:
            status, result = await self.deps.store.commit(job["wsid"], state, job["etag"], run_id, summary)
        except CommitConflict:
            emit(run_id, kind="step", step="commit", status="failed", text="승인 전에 장부가 바뀌어 확정하지 않았습니다")
            await ctx.yield_output({"status": "conflict"})
            return
        emit(run_id, kind="step", step="commit", status="done", text=f"확정 완료: 출고 {result.get('shipped_boxes', 0)}박스" + (" (이미 반영됨)" if status == "duplicate" else ""))
        await ctx.yield_output({"status": "committed" if status == "ok" else "duplicate", "summary": result})


def build_workflow(deps: Deps, checkpoint_storage) -> Any:
    prepare = Prepare(deps)
    workers = [IntakeWorker(deps, i) for i in range(INTAKE_WORKERS)]
    merge = Merge()
    reintake = Reintake(deps)
    finance = Finance(deps)
    shipping = Shipping(deps)
    plan = Plan()
    review = Review(deps)
    questions = QuestionsGate()
    replan = Replan()
    comms = Comms(deps)
    approval = ApprovalGate()
    commit = Commit(deps)
    return (
        WorkflowBuilder(name=WORKFLOW_NAME, start_executor=prepare, checkpoint_storage=checkpoint_storage, max_iterations=60)
        .add_fan_out_edges(prepare, workers)
        .add_fan_in_edges(workers, merge)
        .add_edge(reintake, merge)
        .add_fan_out_edges(merge, [finance, shipping])
        .add_fan_in_edges([finance, shipping], plan)
        .add_edge(plan, review)
        .add_edge(review, reintake, condition=lambda m: m.get("action") == "reintake")
        .add_edge(review, questions, condition=lambda m: m.get("action") == "ask")
        .add_edge(questions, replan)
        .add_edge(replan, comms)
        .add_edge(comms, approval)
        .add_edge(approval, commit)
        .build()
    )
