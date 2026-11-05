"""워크플로 실행 관리: 시작, 진행 이벤트 스트리밍, 사람 확인 응답으로 체크포인트에서 재개."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from .morning import CANCELLED, COMMITTING, PROGRESS, WORKFLOW_NAME, Deps, build_workflow
from .store import StoreCheckpointStorage, jsonable, new_id

log = logging.getLogger("samujang.runs")

ACTIVE = {"running"}
WAITING = {"waiting_questions", "waiting_approval"}


class RunBusy(Exception):
    pass


class RunManager:
    def __init__(self, deps: Deps) -> None:
        self.deps = deps
        self.subscribers: dict[str, set[asyncio.Queue]] = {}
        self.locks: dict[str, asyncio.Lock] = {}
        self.tasks: dict[str, asyncio.Task] = {}
        self.cache: dict[str, dict] = {}

    def _lock(self, run_id: str) -> asyncio.Lock:
        return self.locks.setdefault(run_id, asyncio.Lock())

    async def get(self, wsid: str, run_id: str) -> dict | None:
        if run_id in self.cache and self.cache[run_id]["wsid"] == wsid:
            return self.cache[run_id]
        doc = await self.deps.store.get_doc(wsid, f"run:{run_id}")
        if doc and doc.get("status") in ACTIVE and run_id not in self.tasks:
            # 서버 재시작으로 실행 주체가 사라진 작업. 확정 표식이 있으면 완료, 없으면 장부 미변경 중단으로 정리한다.
            marker = await self.deps.store.get_doc(wsid, f"commit:{run_id}")
            run = {k: v for k, v in doc.items() if not k.startswith("_") and k not in ("id", "kind")}
            run["wsid"] = wsid
            if marker:
                run["status"], run["result"] = "completed", {"status": "committed", "summary": marker.get("result", {})}
            else:
                run["status"] = "failed"
                run["error"] = "서버가 다시 시작되어 진행 중이던 AI 처리가 중단되었습니다. 장부는 바뀌지 않았습니다. 같은 자료로 다시 실행해 주세요."
            run["pending"] = None
            self._record(run, {"kind": "status", "status": run["status"], "text": run.get("error") or "재시작 전 확정 완료 확인"})
            await self._save(run)
            return run
        return doc

    async def _save(self, run: dict) -> None:
        self.cache[run["run_id"]] = run
        await self.deps.store.put_doc(run["wsid"], f"run:{run['run_id']}", "run", {k: v for k, v in run.items() if k not in ("id", "kind", "wsid")})

    def _publish(self, run_id: str, event: dict) -> None:
        for q in list(self.subscribers.get(run_id, ())):
            q.put_nowait(event)

    def _record(self, run: dict, event: dict) -> None:
        event = {"seq": len(run["events"]) + 1, "ts": time.time(), **event}
        run["events"].append(event)
        self._publish(run["run_id"], {"type": "event", "event": event})

    async def start_morning(self, wsid: str, inbox: str, deposits: str) -> dict:
        active = [r for r in self.cache.values() if r["wsid"] == wsid and r["status"] in ACTIVE]
        if active:
            raise RunBusy("이 작업공간에서 이미 실행 중인 작업이 있습니다.")
        run_id = new_id()
        run = {
            "run_id": run_id, "wsid": wsid, "type": "morning", "status": "running", "events": [],
            "pending": None, "result": None, "error": None, "created_at": time.time(), "workflow": WORKFLOW_NAME,
        }
        await self._save(run)
        message = {"wsid": wsid, "run_id": run_id, "inbox": inbox, "deposits": deposits}
        self.tasks[run_id] = asyncio.create_task(self._drive(run, message=message))
        return run

    async def respond(self, wsid: str, run_id: str, request_id: str, payload: dict) -> dict:
        async with self._lock(run_id):
            run = await self.get(wsid, run_id)
            if run is None:
                raise KeyError(run_id)
            pending = run.get("pending")
            if not pending or pending["request_id"] != request_id:
                # 같은 응답의 중복 전송(이중 클릭·재시도)은 현재 상태를 그대로 돌려준다.
                if request_id in run.get("answered", []):
                    return run
                raise RunBusy("응답할 수 있는 대기 요청이 없습니다.")
            run.setdefault("answered", []).append(request_id)
            run["pending"] = None
            run["status"] = "running"
            self._record(run, {"kind": "status", "status": "running", "text": "사장님 응답 반영, 체크포인트에서 재개"})
            await self._save(run)
            self.tasks[run_id] = asyncio.create_task(
                self._drive(run, checkpoint_id=pending["checkpoint_id"], responses={request_id: payload})
            )
            return run

    async def cancel(self, wsid: str, run_id: str) -> dict:
        """확정 전 AI 처리 취소. 장부 확정이 시작된 뒤에는 취소하지 않는다."""
        async with self._lock(run_id):
            run = await self.get(wsid, run_id)
            if run is None:
                raise KeyError(run_id)
            if run["status"] not in ACTIVE | WAITING:
                return run
            if run_id in COMMITTING:
                raise RunBusy("이미 장부 확정이 시작되어 취소할 수 없습니다.")
            CANCELLED.add(run_id)
            task = self.tasks.pop(run_id, None)
            if task and not task.done():
                task.cancel()
            run["status"] = "cancelled"
            run["pending"] = None
            self._record(run, {"kind": "status", "status": "cancelled", "text": "사장님이 AI 처리를 취소함 — 장부·재고 변경 없음"})
            await self._save(run)
            self._publish(run_id, {"type": "run", "run": run})
            return run

    async def _drive(self, run: dict, message: dict | None = None, checkpoint_id: str | None = None, responses: dict | None = None) -> None:
        run_id, wsid = run["run_id"], run["wsid"]
        storage = StoreCheckpointStorage(self.deps.store, wsid, run_id)
        workflow = build_workflow(self.deps, storage)
        PROGRESS[run_id] = lambda ev: self._record(run, ev)
        pending: dict[str, Any] | None = None
        output: Any = None
        failure: str | None = None
        try:
            if message is not None:
                stream = workflow.run(message, stream=True)
            else:
                stream = workflow.run(stream=True, checkpoint_id=checkpoint_id, checkpoint_storage=storage, responses=responses)
            async for event in stream:
                if event.type == "request_info":
                    pending = {"request_id": event.request_id, "data": jsonable(event.data)}
                elif event.type == "output":
                    output = jsonable(event.data)
                elif event.type in ("failed", "executor_failed", "error"):
                    details = getattr(event, "details", None) or getattr(event, "data", None)
                    failure = str(getattr(details, "message", details))[:500]
        except Exception as exc:  # noqa: BLE001
            log.exception("workflow run failed")
            failure = f"{type(exc).__name__}: {str(exc)[:400]}"
        finally:
            PROGRESS.pop(run_id, None)
            if self.tasks.get(run_id) is asyncio.current_task():
                self.tasks.pop(run_id, None)

        if run_id in CANCELLED:
            return
        if pending is not None:
            latest = await storage.get_latest(workflow_name=WORKFLOW_NAME)
            pending["checkpoint_id"] = latest.checkpoint_id if latest else None
            pending["kind"] = pending["data"].get("kind")
            run["pending"] = pending
            run["status"] = "waiting_questions" if pending["kind"] == "questions" else "waiting_approval"
            run["plan"] = pending["data"].get("plan")
        elif output is not None:
            run["result"] = output
            run["status"] = {"committed": "completed", "duplicate": "completed", "duplicate_input": "completed", "rejected": "rejected", "conflict": "conflict", "cancelled": "cancelled"}.get(output.get("status"), "completed")
        else:
            run["status"] = "failed"
            run["error"] = failure or "워크플로가 결과 없이 종료되었습니다."
        self._record(run, {"kind": "status", "status": run["status"], "text": run.get("error") or ""})
        await self._save(run)
        self._publish(run_id, {"type": "run", "run": run})

    def subscribe(self, run_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self.subscribers.setdefault(run_id, set()).add(q)
        return q

    def unsubscribe(self, run_id: str, q: asyncio.Queue) -> None:
        self.subscribers.get(run_id, set()).discard(q)
