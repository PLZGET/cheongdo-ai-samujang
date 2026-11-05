"""작업공간·실행·체크포인트 저장소. 로컬은 메모리, Azure는 Cosmos DB(관리 ID)를 쓴다.

한 작업공간의 모든 문서는 같은 논리 파티션(/wsid)에 두고, 확정 반영은
작업공간 ETag 조건 교체 + 확정 표식 생성을 하나의 트랜잭션 배치로 실행한다.
"""

from __future__ import annotations

import asyncio
import copy
import json
import os
import uuid
from typing import Any, Protocol

from agent_framework import WorkflowCheckpoint
from agent_framework._workflows._checkpoint_encoding import decode_checkpoint_value, encode_checkpoint_value


class CommitConflict(Exception):
    """승인 당시 장부 버전이 현재와 다르다."""


class Store(Protocol):
    async def create_workspace(self, wsid: str, state: dict) -> None: ...
    async def get_workspace(self, wsid: str) -> tuple[dict, str] | None: ...
    async def commit(self, wsid: str, state: dict, etag: str, commit_key: str, result: dict) -> tuple[str, dict]: ...
    async def put_doc(self, wsid: str, doc_id: str, kind: str, body: dict) -> None: ...
    async def get_doc(self, wsid: str, doc_id: str) -> dict | None: ...
    async def list_docs(self, wsid: str, kind: str) -> list[dict]: ...


class MemoryStore:
    def __init__(self) -> None:
        self._docs: dict[tuple[str, str], dict] = {}
        self._lock = asyncio.Lock()

    async def create_workspace(self, wsid: str, state: dict) -> None:
        async with self._lock:
            self._docs[(wsid, "ws")] = {"id": "ws", "wsid": wsid, "kind": "workspace", "state": copy.deepcopy(state), "_etag": uuid.uuid4().hex}

    async def get_workspace(self, wsid: str) -> tuple[dict, str] | None:
        doc = self._docs.get((wsid, "ws"))
        return (copy.deepcopy(doc["state"]), doc["_etag"]) if doc else None

    async def commit(self, wsid: str, state: dict, etag: str, commit_key: str, result: dict) -> tuple[str, dict]:
        async with self._lock:
            marker = self._docs.get((wsid, f"commit:{commit_key}"))
            if marker:
                return "duplicate", copy.deepcopy(marker["result"])
            ws = self._docs.get((wsid, "ws"))
            if ws is None or ws["_etag"] != etag:
                raise CommitConflict()
            ws["state"] = copy.deepcopy(state)
            ws["_etag"] = uuid.uuid4().hex
            self._docs[(wsid, f"commit:{commit_key}")] = {"id": f"commit:{commit_key}", "wsid": wsid, "kind": "commit", "result": copy.deepcopy(result)}
            return "ok", result

    async def put_doc(self, wsid: str, doc_id: str, kind: str, body: dict) -> None:
        self._docs[(wsid, doc_id)] = {"id": doc_id, "wsid": wsid, "kind": kind, **copy.deepcopy(body)}

    async def get_doc(self, wsid: str, doc_id: str) -> dict | None:
        doc = self._docs.get((wsid, doc_id))
        return copy.deepcopy(doc) if doc else None

    async def list_docs(self, wsid: str, kind: str) -> list[dict]:
        return [copy.deepcopy(d) for (w, _), d in self._docs.items() if w == wsid and d.get("kind") == kind]


class CosmosStore:
    def __init__(self, endpoint: str, database: str, container: str) -> None:
        from azure.cosmos.aio import CosmosClient
        from azure.identity.aio import DefaultAzureCredential

        self._credential = DefaultAzureCredential(managed_identity_client_id=os.environ.get("AZURE_CLIENT_ID"))
        self._client = CosmosClient(endpoint, credential=self._credential)
        self._container = self._client.get_database_client(database).get_container_client(container)

    async def create_workspace(self, wsid: str, state: dict) -> None:
        await self._container.create_item({"id": "ws", "wsid": wsid, "kind": "workspace", "state": state})

    async def get_workspace(self, wsid: str) -> tuple[dict, str] | None:
        from azure.cosmos.exceptions import CosmosResourceNotFoundError

        try:
            doc = await self._container.read_item("ws", partition_key=wsid)
        except CosmosResourceNotFoundError:
            return None
        return doc["state"], doc["_etag"]

    async def commit(self, wsid: str, state: dict, etag: str, commit_key: str, result: dict) -> tuple[str, dict]:
        from azure.cosmos.exceptions import CosmosBatchOperationError

        marker_id = f"commit:{commit_key}"
        ops = [
            ("replace", ("ws", {"id": "ws", "wsid": wsid, "kind": "workspace", "state": state}), {"if_match_etag": etag}),
            ("create", ({"id": marker_id, "wsid": wsid, "kind": "commit", "result": result},)),
        ]
        try:
            await self._container.execute_item_batch(batch_operations=ops, partition_key=wsid)
            return "ok", result
        except CosmosBatchOperationError as err:
            codes = [r.get("statusCode") for r in (err.operation_responses or [])]
            if 409 in codes:
                existing = await self.get_doc(wsid, marker_id)
                return "duplicate", (existing or {}).get("result", {})
            if 412 in codes:
                raise CommitConflict() from err
            raise

    async def put_doc(self, wsid: str, doc_id: str, kind: str, body: dict) -> None:
        await self._container.upsert_item({"id": doc_id, "wsid": wsid, "kind": kind, **body})

    async def get_doc(self, wsid: str, doc_id: str) -> dict | None:
        from azure.cosmos.exceptions import CosmosResourceNotFoundError

        try:
            return await self._container.read_item(doc_id, partition_key=wsid)
        except CosmosResourceNotFoundError:
            return None

    async def list_docs(self, wsid: str, kind: str) -> list[dict]:
        query = "SELECT * FROM c WHERE c.kind = @kind"
        items = self._container.query_items(query, parameters=[{"name": "@kind", "value": kind}], partition_key=wsid)
        return [item async for item in items]


class StoreCheckpointStorage:
    """MAF 워크플로 체크포인트를 작업공간 파티션에 저장한다. 앱 재시작 후에도 승인 대기 작업을 재개할 수 있다."""

    def __init__(self, store: Store, wsid: str, run_id: str) -> None:
        self.store = store
        self.wsid = wsid
        self.run_id = run_id

    async def save(self, checkpoint: WorkflowCheckpoint) -> str:
        encoded = encode_checkpoint_value(checkpoint.to_dict())
        await self.store.put_doc(
            self.wsid,
            f"ckpt:{checkpoint.checkpoint_id}",
            "checkpoint",
            {"run_id": self.run_id, "workflow_name": checkpoint.workflow_name, "timestamp": checkpoint.timestamp, "data": json.dumps(encoded, ensure_ascii=False)},
        )
        return checkpoint.checkpoint_id

    async def load(self, checkpoint_id: str) -> WorkflowCheckpoint:
        doc = await self.store.get_doc(self.wsid, f"ckpt:{checkpoint_id}")
        if doc is None:
            raise KeyError(checkpoint_id)
        return WorkflowCheckpoint.from_dict(decode_checkpoint_value(json.loads(doc["data"])))

    async def list_checkpoints(self, *, workflow_name: str) -> list[WorkflowCheckpoint]:
        docs = [d for d in await self.store.list_docs(self.wsid, "checkpoint") if d["workflow_name"] == workflow_name and d.get("run_id") == self.run_id]
        docs.sort(key=lambda d: d["timestamp"])
        return [WorkflowCheckpoint.from_dict(decode_checkpoint_value(json.loads(d["data"]))) for d in docs]

    async def list_checkpoint_ids(self, *, workflow_name: str) -> list[str]:
        return [c.checkpoint_id for c in await self.list_checkpoints(workflow_name=workflow_name)]

    async def get_latest(self, *, workflow_name: str) -> WorkflowCheckpoint | None:
        items = await self.list_checkpoints(workflow_name=workflow_name)
        return items[-1] if items else None

    async def delete(self, checkpoint_id: str) -> bool:
        return False


def build_store() -> Store:
    if os.environ.get("STORE") == "cosmos":
        return CosmosStore(os.environ["COSMOS_ENDPOINT"], os.environ.get("COSMOS_DATABASE", "samujang"), os.environ.get("COSMOS_CONTAINER", "workspaces"))
    return MemoryStore()


def new_id() -> str:
    return uuid.uuid4().hex


def jsonable(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False, default=str))
