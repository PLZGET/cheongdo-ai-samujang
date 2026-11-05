"""결정적 업무 규칙: 금액, 입금 정산, 출고 정책, 재고 배정, 환불, 마감 지표.

AI 결과는 제안일 뿐이며 금액·재고·정책 판단은 모두 이 모듈이 계산한다.
"""

from __future__ import annotations

import math
import re
from datetime import date, timedelta

WEEKDAY_KO = ["월", "화", "수", "목", "금", "토", "일"]

LINE_STATUS_LABEL = {
    "ship_today": "오늘 출고",
    "scheduled": "출고 예약",
    "wait_payment": "입금 대기(재고 확보)",
    "wait_address": "주소 대기",
    "wait_confirm": "확인 대기",
    "date_conflict": "발송일 정책 충돌",
    "short_stock": "재고 부족(대기)",
    "hold": "보류",
    "cancelled": "취소",
}


def won(n: int) -> str:
    return f"{n:,}원"


def parse_date(s: str | None) -> date | None:
    if not s:
        return None
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def date_label(d: date) -> str:
    return f"{d.month}/{d.day}({WEEKDAY_KO[d.weekday()]})"


def next_shippable_day(day: date, blocked: list[int]) -> date:
    d = day + timedelta(days=1)
    while d.weekday() in blocked or d.weekday() == 6:
        d += timedelta(days=1)
    return d


def region_of(address: str | None) -> str:
    if not address:
        return "unknown"
    if "제주" in address:
        return "jeju"
    if any(k in address for k in ("울릉", "백령", "연평", "흑산")):
        return "island"
    return "normal"


def line_amount(line: dict, catalog: dict, policy: dict) -> int:
    product = catalog[line["product"]]
    fee = policy["remote_fee_per_box"] if line.get("region") in ("jeju", "island") else 0
    return (product["price"] + fee) * int(line["qty"])


def customer_totals(lines: list[dict], catalog: dict, policy: dict) -> dict[str, int]:
    totals: dict[str, int] = {}
    for line in lines:
        totals.setdefault(line["customer"], 0)
        if line["status"] in ("cancelled", "hold", "wait_confirm"):
            continue
        totals[line["customer"]] += line_amount(line, catalog, policy)
    return totals


def reconcile(totals: dict[str, int], deposits: list[dict], matches: list[dict]) -> dict[str, dict]:
    """확정된 입금 매칭만으로 고객별 결제 상태와 결제 완료 시각을 계산한다."""
    by_id = {d["id"]: d for d in deposits}
    paid: dict[str, list[dict]] = {c: [] for c in totals}
    used: set[str] = set()
    for m in matches:
        if not m.get("confirmed") or m["customer"] not in paid:
            continue
        dep = by_id.get(m["deposit_id"])
        if dep is None or dep["id"] in used:
            continue
        used.add(dep["id"])
        paid[m["customer"]].append(dep)

    result: dict[str, dict] = {}
    for customer, total in totals.items():
        deps = sorted(paid[customer], key=lambda d: d["at"])
        running, completed_at = 0, None
        for d in deps:
            running += d["amount"]
            if completed_at is None and total > 0 and running >= total:
                completed_at = d["at"]
        if total == 0 and running == 0:
            status = "none"
        elif running == 0:
            status = "unpaid"
        elif running < total:
            status = "partial"
        elif running == total:
            status = "paid"
        else:
            status = "over"
        result[customer] = {
            "total": total,
            "paid": running,
            "balance": total - running,
            "status": status,
            "completed_at": completed_at,
            "deposit_ids": [d["id"] for d in deps],
        }
    unmatched = [d for d in deposits if d["id"] not in used]
    result["_unmatched"] = {"deposit_ids": [d["id"] for d in unmatched]}
    return result


def allocate(lines: list[dict], payments: dict, customers: dict, inventory: dict, catalog: dict, policy: dict, today: date) -> dict:
    """정책 순서로 재고를 배정하고 각 주문 줄의 상태와 출고일을 정한다.

    우선순위: 입금 완료 시각 → 단골 → 첫 메시지 시각. 미입금 주문은 남는 재고만 확보한다.
    """
    blocked = policy["no_ship_weekdays_perishable"]

    def priority(customer: str) -> tuple:
        pay = payments.get(customer, {})
        paid_rank = 0 if pay.get("status") in ("paid", "over") else 1
        return (paid_rank, pay.get("completed_at") or "9999", 0 if customers.get(customer, {}).get("regular") else 1, customers.get(customer, {}).get("first_message_at", "9999"))

    remaining = {code: inventory[code]["on_hand"] - inventory[code].get("reserved", 0) for code in inventory}
    ordered = sorted(lines, key=lambda l: (priority(l["customer"]), l["line_id"]))
    for line in ordered:
        if line["status"] in ("cancelled", "hold", "wait_confirm"):
            line["allocated"] = False
            continue
        pay = payments.get(line["customer"], {})
        is_paid = pay.get("status") in ("paid", "over")
        qty = int(line["qty"])
        if remaining.get(line["product"], 0) >= qty:
            remaining[line["product"]] -= qty
            line["allocated"] = True
        else:
            line["allocated"] = False
            line["status"] = "short_stock"
            continue

        perishable = catalog[line["product"]]["perishable"]
        requested = parse_date(line.get("requested_date"))
        ship_day = requested or today
        if ship_day < today:
            ship_day = today
        if perishable and ship_day.weekday() in blocked and not line.get("ship_date_override"):
            line["status"] = "date_conflict"
            line["ship_date"] = None
            line["suggested_dates"] = [today.isoformat(), next_shippable_day(ship_day, blocked).isoformat()]
            continue
        line["ship_date"] = line.get("ship_date_override") or ship_day.isoformat()
        if not line.get("address"):
            line["status"] = "wait_address"
        elif not is_paid:
            line["status"] = "wait_payment"
        elif line["ship_date"] == today.isoformat():
            line["status"] = "ship_today"
        else:
            line["status"] = "scheduled"

    shortages: dict[str, int] = {}
    for line in lines:
        if line["status"] == "short_stock":
            shortages[line["product"]] = shortages.get(line["product"], 0) + int(line["qty"])
    return {"remaining": remaining, "shortages": shortages}


def inventory_after(lines: list[dict], inventory: dict) -> dict:
    after = {code: {"on_hand": v["on_hand"], "reserved": v.get("reserved", 0)} for code, v in inventory.items()}
    for line in lines:
        if not line.get("allocated"):
            continue
        if line["status"] == "ship_today":
            after[line["product"]]["on_hand"] -= int(line["qty"])
        elif line["status"] in ("scheduled", "wait_payment", "wait_address"):
            after[line["product"]]["reserved"] += int(line["qty"])
    return after


def claim_refund(damaged: int, product: dict, policy: dict) -> dict:
    """파손 개수에 따른 환불 제안. 기준 이하이면 개당 환불, 넘으면 재발송 또는 전액 환불."""
    per_piece = math.ceil(product["price"] / product["pieces"] / 100) * 100
    limit = policy["claim_partial_max_pieces"]
    if damaged <= 0:
        return {"type": "none", "amount": 0, "per_piece": per_piece}
    if damaged <= limit:
        return {"type": "partial_refund", "amount": per_piece * damaged, "per_piece": per_piece}
    return {"type": "resend_or_full_refund", "amount": product["price"], "per_piece": per_piece}


AMOUNT_RE = re.compile(r"(\d{1,3}(?:,\d{3})+|\d+)\s*원")


def amounts_in_text(text: str) -> list[int]:
    return [int(m.replace(",", "")) for m in AMOUNT_RE.findall(text)]


def unknown_amounts(text: str, allowed: set[int]) -> list[int]:
    """문장 속 금액 중 코드가 계산한 값에 없는 금액을 찾는다(환각 검사)."""
    return [a for a in amounts_in_text(text) if a not in allowed]
