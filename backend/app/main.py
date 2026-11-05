"""FastAPI 진입점: 게스트 작업공간, 아침 업무 실행·스트리밍·응답, 출고 자료, 정답 대조, 상태 확인."""

from __future__ import annotations

import asyncio
import csv
import io
import json
import logging
import os
import re
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from . import scenario
from .agents import CopilotRuntime
from .morning import Deps
from .parsing import InputError
from .runs import RunBusy, RunManager
from .store import build_store, new_id

logging.basicConfig(level=logging.INFO)
logging.getLogger("azure").setLevel(logging.WARNING)
log = logging.getLogger("samujang")

APP_VERSION = os.environ.get("APP_VERSION", "dev")
STATIC_DIR = Path(os.environ.get("STATIC_DIR", Path(__file__).resolve().parents[2] / "web" / "dist"))
WSID_RE = re.compile(r"^[0-9a-f]{32}$")


def setup_telemetry() -> None:
    if not os.environ.get("APPLICATIONINSIGHTS_CONNECTION_STRING"):
        return
    from azure.monitor.opentelemetry import configure_azure_monitor
    from agent_framework.observability import enable_instrumentation

    configure_azure_monitor(logger_name="samujang")
    # 프롬프트·응답 본문(개인정보 포함 가능)은 추적에 남기지 않는다.
    enable_instrumentation(enable_sensitive_data=False)


setup_telemetry()
store = build_store()
runtime = CopilotRuntime()
manager = RunManager(Deps(store=store, runtime=runtime))


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await runtime.start()
    yield
    await runtime.stop()


app = FastAPI(title="청도 농가 AI 사무장", version=APP_VERSION, lifespan=lifespan)

try:
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

    FastAPIInstrumentor.instrument_app(app, excluded_urls="api/health")
except Exception:  # noqa: BLE001
    pass


class RateLimiter:
    """IP별 요청 빈도 제한(단일 인스턴스 기준). Copilot 호출 남용을 막는다."""

    def __init__(self) -> None:
        self.hits: dict[str, deque] = defaultdict(deque)

    def check(self, key: str, limit: int, window: float) -> None:
        now = time.monotonic()
        q = self.hits[key]
        while q and now - q[0] > window:
            q.popleft()
        if len(q) >= limit:
            raise HTTPException(429, "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.")
        q.append(now)


limiter = RateLimiter()


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    length = request.headers.get("content-length")
    if length and int(length) > 6_000_000:
        return JSONResponse({"detail": "요청이 너무 큽니다."}, status_code=413)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-App-Version"] = APP_VERSION
    return response


async def load_ws(wsid: str) -> tuple[dict, str]:
    if not WSID_RE.match(wsid):
        raise HTTPException(404, "작업공간을 찾을 수 없습니다.")
    loaded = await store.get_workspace(wsid)
    if loaded is None:
        raise HTTPException(404, "작업공간을 찾을 수 없습니다. 새로 시작해 주세요.")
    return loaded


def public_run(run: dict) -> dict:
    keep = ("run_id", "type", "status", "events", "pending", "result", "error", "created_at", "plan")
    out = {k: run.get(k) for k in keep}
    if out["pending"]:
        out["pending"] = {k: out["pending"].get(k) for k in ("request_id", "kind", "data")}
    return out


@app.get("/api/health")
async def health() -> dict:
    return {
        "status": "ok",
        "version": APP_VERSION,
        "copilot": "ready" if runtime.client else f"unavailable: {runtime.error}",
        "store": type(store).__name__,
    }


@app.post("/api/workspaces")
async def create_workspace(request: Request) -> dict:
    limiter.check(f"ws:{client_ip(request)}", 20, 3600)
    wsid = new_id()
    await store.create_workspace(wsid, scenario.new_workspace_state())
    return {"wsid": wsid}


@app.get("/api/workspaces/{wsid}")
async def get_workspace(wsid: str) -> dict:
    state, _ = await load_ws(wsid)
    runs = await store.list_docs(wsid, "run")
    runs.sort(key=lambda r: r.get("created_at", 0), reverse=True)
    return {
        "wsid": wsid,
        "state": state,
        "runs": [{k: r.get(k) for k in ("run_id", "type", "status", "created_at")} for r in runs],
        "version": APP_VERSION,
    }


class MorningIn(BaseModel):
    inbox: str = Field(max_length=20000)
    deposits: str = Field(default="", max_length=10000)


@app.post("/api/workspaces/{wsid}/runs/morning")
async def start_morning(wsid: str, body: MorningIn, request: Request) -> dict:
    await load_ws(wsid)
    limiter.check(f"run:{client_ip(request)}", 12, 3600)
    if runtime.client is None:
        raise HTTPException(503, f"AI 런타임이 준비되지 않았습니다: {runtime.error}")
    try:
        run = await manager.start_morning(wsid, body.inbox, body.deposits)
    except RunBusy as exc:
        raise HTTPException(409, str(exc)) from exc
    return public_run(run)


@app.get("/api/workspaces/{wsid}/runs/{run_id}")
async def get_run(wsid: str, run_id: str) -> dict:
    await load_ws(wsid)
    run = await manager.get(wsid, run_id)
    if run is None:
        raise HTTPException(404, "실행 기록이 없습니다.")
    return public_run(run)


@app.get("/api/workspaces/{wsid}/runs/{run_id}/events")
async def stream_run(wsid: str, run_id: str, request: Request):
    await load_ws(wsid)
    run = await manager.get(wsid, run_id)
    if run is None:
        raise HTTPException(404, "실행 기록이 없습니다.")
    queue = manager.subscribe(run_id)

    async def gen():
        try:
            yield f"data: {json.dumps({'type': 'run', 'run': public_run(run)}, ensure_ascii=False)}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                if item["type"] == "run":
                    item = {"type": "run", "run": public_run(item["run"])}
                yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"
        finally:
            manager.unsubscribe(run_id, queue)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


class RespondIn(BaseModel):
    request_id: str = Field(max_length=100)
    answers: dict[str, str] | None = None
    decision: str | None = Field(default=None, pattern="^(approve|reject)$")


@app.post("/api/workspaces/{wsid}/runs/{run_id}/respond")
async def respond(wsid: str, run_id: str, body: RespondIn) -> dict:
    await load_ws(wsid)
    payload = {"answers": body.answers or {}} if body.answers is not None else {"decision": body.decision or "reject"}
    try:
        run = await manager.respond(wsid, run_id, body.request_id, payload)
    except KeyError as exc:
        raise HTTPException(404, "실행 기록이 없습니다.") from exc
    except RunBusy as exc:
        raise HTTPException(409, str(exc)) from exc
    return public_run(run)


def csv_response(rows: list[list], filename: str) -> Response:
    buf = io.StringIO()
    csv.writer(buf).writerows(rows)
    return Response(
        content=("\ufeff" + buf.getvalue()).encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@app.get("/api/workspaces/{wsid}/exports/courier.csv")
async def courier_csv(wsid: str) -> Response:
    state, _ = await load_ws(wsid)
    rows = [["주문번호", "받는분", "받는분전화", "받는분주소", "품목", "수량", "발송일"]]
    for s in state["ledger"]["shipments"]:
        if s.get("tracking"):
            continue
        rows.append([s["order_id"], s["recipient"], s["phone"], s["address"], s["product_name"], s["qty"], s["ship_date"]])
    return csv_response(rows, "courier_upload.csv")


@app.get("/api/workspaces/{wsid}/exports/packing.csv")
async def packing_csv(wsid: str) -> Response:
    state, _ = await load_ws(wsid)
    pending = [s for s in state["ledger"]["shipments"] if not s.get("tracking")]
    totals: dict[str, int] = defaultdict(int)
    for s in pending:
        totals[s["product_name"]] += s["qty"]
    rows = [["구분", "품목", "수량", "받는분", "주문번호"]]
    rows += [["합계", name, qty, "", ""] for name, qty in totals.items()]
    rows += [["상자", s["product_name"], s["qty"], s["recipient"], s["order_id"]] for s in pending]
    return csv_response(rows, "packing_list.csv")


@app.get("/api/workspaces/{wsid}/evaluation")
async def evaluation(wsid: str) -> dict:
    state, _ = await load_ws(wsid)
    ledger = state["ledger"]
    if not ledger["orders"]:
        raise HTTPException(409, "아침 업무를 먼저 확정해 주세요.")
    key = scenario.ANSWER_KEY
    actual = [
        {k: o.get(k) for k in ("customer", "product", "qty", "recipient", "status")}
        for o in ledger["orders"]
        if o["status"] not in ("cancelled",)
    ]
    remaining = list(actual)
    line_results = []
    for exp in key["lines"]:
        hit = next((a for a in remaining if a == exp), None)
        if hit:
            remaining.remove(hit)
        line_results.append({"expected": exp, "match": hit is not None})
    accounts = ledger.get("accounts", {})
    pay_results = [{"customer": c, "expected": s, "actual": accounts.get(c, {}).get("status"), "match": accounts.get(c, {}).get("status") == s} for c, s in key["payments"].items()]
    refunds = {r["customer"]: r["amount"] for r in ledger["refunds"]}
    refund_results = [{"customer": c, "expected": a, "actual": refunds.get(c), "match": refunds.get(c) == a} for c, a in key["refunds"].items()]
    inv_results = [{"product": p, "expected": q, "actual": state["inventory"][p]["on_hand"], "match": state["inventory"][p]["on_hand"] == q} for p, q in key["inventory_on_hand_after"].items()]
    groups = {"주문 줄": line_results, "결제 상태": pay_results, "환불": refund_results, "재고": inv_results}
    summary = {name: {"matched": sum(1 for r in rows if r["match"]), "total": len(rows)} for name, rows in groups.items()}
    return {
        "note": "합성 예제 시나리오의 정답 장부와 비교합니다. 권장 답변(작년 주문 접수, 가족 입금 연결, 오늘 발송, 초과 입금 환불 기록)을 선택했을 때의 정답입니다.",
        "summary": summary,
        "extra_lines": remaining,
        "details": groups,
    }


if STATIC_DIR.exists():

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        target = (STATIC_DIR / path).resolve()
        if path and target.is_file() and STATIC_DIR.resolve() in target.parents:
            return FileResponse(target)
        return FileResponse(STATIC_DIR / "index.html")
