"""입력 파싱과 개인정보 가명화."""

from __future__ import annotations

import re
from datetime import date

DATE_LINE = re.compile(r"-+\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일")
MSG_LINE = re.compile(r"^\[(?P<name>[^\]]+)\]\s*\[(?P<ampm>오전|오후)\s*(?P<h>\d{1,2}):(?P<m>\d{2})\]\s*(?P<text>.*)$")
DEPOSIT_LINE = re.compile(r"입금\s*(?P<amount>[\d,]+)원\s+(?P<mo>\d{1,2})/(?P<d>\d{1,2})\s+(?P<h>\d{1,2}):(?P<mi>\d{2})\s+(?P<name>[^\s\d]+)")
PHONE = re.compile(r"01[016789]-?\d{3,4}-?\d{4}")

MAX_INPUT_CHARS = 20000


class InputError(ValueError):
    pass


def parse_kakao(text: str, owner: str, year: int) -> list[dict]:
    """카카오톡 PC 대화 내보내기 형식을 메시지 목록으로 바꾼다. 판매자 본인 메시지는 제외한다."""
    if len(text) > MAX_INPUT_CHARS:
        raise InputError(f"대화 내용이 너무 깁니다(최대 {MAX_INPUT_CHARS:,}자).")
    current = None
    messages: list[dict] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        dm = DATE_LINE.search(line)
        if dm:
            current = date(int(dm.group(1)), int(dm.group(2)), int(dm.group(3)))
            continue
        mm = MSG_LINE.match(line)
        if mm and current:
            hour = int(mm.group("h")) % 12 + (12 if mm.group("ampm") == "오후" else 0)
            messages.append(
                {
                    "id": f"m{len(messages) + 1}",
                    "sender": mm.group("name").strip(),
                    "at": f"{current.isoformat()}T{hour:02d}:{mm.group('m')}",
                    "text": mm.group("text").strip(),
                }
            )
        elif messages and current:
            messages[-1]["text"] += "\n" + line
    messages = [m for m in messages if m["sender"] != owner]
    if not messages:
        raise InputError("카카오톡 대화 내보내기 형식의 메시지를 찾지 못했습니다. 예: [이영희] [오후 9:12] 반시 5kg 2박스요")
    return messages


def parse_deposits(text: str, year: int) -> list[dict]:
    if len(text) > MAX_INPUT_CHARS:
        raise InputError("입금 문자가 너무 깁니다.")
    deposits = []
    for raw in text.splitlines():
        m = DEPOSIT_LINE.search(raw)
        if not m:
            continue
        deposits.append(
            {
                "id": f"d{len(deposits) + 1}",
                "payer": m.group("name"),
                "amount": int(m.group("amount").replace(",", "")),
                "at": f"{year}-{int(m.group('mo')):02d}-{int(m.group('d')):02d}T{int(m.group('h')):02d}:{m.group('mi')}",
                "raw": raw.strip(),
            }
        )
    return deposits


class PhoneMasker:
    """모델에 보내기 전 전화번호를 [전화N] 토큰으로 바꾸고, 출고 자료를 만들 때 복원한다."""

    def __init__(self, mapping: dict[str, str] | None = None):
        self.mapping: dict[str, str] = dict(mapping or {})

    def mask(self, text: str) -> str:
        reverse = {v: k for k, v in self.mapping.items()}

        def repl(m: re.Match) -> str:
            digits = re.sub(r"\D", "", m.group(0))
            if digits not in reverse:
                token = f"[전화{len(self.mapping) + 1}]"
                self.mapping[token] = digits
                reverse[digits] = token
            return reverse[digits]

        return PHONE.sub(repl, text)

    def unmask(self, value: str | None) -> str:
        if not value:
            return ""
        digits = self.mapping.get(value.strip())
        if digits is None:
            return value
        return f"{digits[:3]}-{digits[3:-4]}-{digits[-4:]}"
