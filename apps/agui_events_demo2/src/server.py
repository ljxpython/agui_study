import os
import sqlite3
from typing import Any, AsyncGenerator

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

from ag_ui.core import EventType, RunErrorEvent
from ag_ui.core.types import RunAgentInput
from ag_ui.encoder import EventEncoder
from ag_ui_langgraph import LangGraphAgent
from ag_ui_langgraph import utils as ag_utils
from ag_ui_langgraph.utils import langchain_messages_to_agui
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from agent_graph import build_graph


_original_make_json_safe = ag_utils.make_json_safe


def _patched_make_json_safe(value: Any, *args: Any, **kwargs: Any) -> Any:
    if isinstance(value, sqlite3.Connection):
        return "<sqlite3.Connection>"
    try:
        return _original_make_json_safe(value, *args, **kwargs)
    except Exception:
        try:
            return str(value)
        except Exception:
            return "<unserializable>"


ag_utils.make_json_safe = _patched_make_json_safe


async def _load_mcp_tools() -> list[Any]:
    if os.getenv("ENABLE_MCP_CHART", "0") != "1":
        return []

    from langchain_mcp_adapters.client import MultiServerMCPClient

    client = MultiServerMCPClient(
        {
            "mcp-server-chart": {
                "command": "npx",
                "args": ["-y", "@antv/mcp-server-chart"],
                "transport": "stdio",
            }
        }
    )
    return await client.get_tools()


def _load_dotenv() -> None:
    try:
        load_dotenv()
    except Exception:
        pass

_load_dotenv()
app = FastAPI(title="agui-events-demo2")


def _get_checkpointer_path() -> str:
    return os.getenv("CHECKPOINTER_PATH", "./data/checkpoints.sqlite")


def _ensure_parent_dir(path: str) -> None:
    parent = os.path.dirname(os.path.abspath(path))
    if parent:
        os.makedirs(parent, exist_ok=True)


_checkpointer_cm = None
_checkpointer: AsyncSqliteSaver | None = None
_agent: LangGraphAgent | None = None


@app.on_event("startup")
async def _startup() -> None:
    global _checkpointer_cm, _checkpointer, _agent

    ckpt_path = _get_checkpointer_path()
    _ensure_parent_dir(ckpt_path)

    _checkpointer_cm = AsyncSqliteSaver.from_conn_string(ckpt_path)
    _checkpointer = await _checkpointer_cm.__aenter__()
    if _checkpointer is not None and not hasattr(_checkpointer.conn, "is_alive"):
        setattr(_checkpointer.conn, "is_alive", lambda: True)

    mcp_tools = await _load_mcp_tools()
    graph = build_graph(checkpointer=_checkpointer, mcp_tools=mcp_tools)
    _agent = LangGraphAgent(name="agent", graph=graph)


@app.on_event("shutdown")
async def _shutdown() -> None:
    global _checkpointer_cm, _checkpointer, _agent

    _agent = None
    _checkpointer = None
    if _checkpointer_cm is not None:
        await _checkpointer_cm.__aexit__(None, None, None)
        _checkpointer_cm = None


def _require_agent() -> LangGraphAgent:
    if _agent is None:
        raise RuntimeError("agent not initialized")
    return _agent


@app.post("/agent")
async def agent_endpoint(input_data: RunAgentInput, request: Request) -> StreamingResponse:
    accept_header = request.headers.get("accept") or ""
    encoder = EventEncoder(accept=accept_header)
    agent = _require_agent()

    async def _emit_event(evt: Any) -> AsyncGenerator[str, None]:
        if isinstance(evt, str):
            yield evt
            return

        if getattr(evt, "type", None) == EventType.RAW and hasattr(evt, "event"):
            try:
                evt.event = ag_utils.make_json_safe(evt.event)
            except Exception:
                evt.event = {"error": "failed to serialize raw event"}

        yield encoder.encode(evt)

    async def event_generator() -> AsyncGenerator[str, None]:
        try:
            async for event in agent.run(input_data):
                async for chunk in _emit_event(event):
                    yield chunk
        except ValueError as e:
            if str(e) == "Message ID not found in history":
                try:
                    agent_state = await agent.graph.aget_state({"configurable": {"thread_id": input_data.thread_id}})
                    history = langchain_messages_to_agui(agent_state.values.get("messages", []))
                    input_data.messages = [*history, *(input_data.messages or [])]
                    async for event in agent.run(input_data):
                        async for chunk in _emit_event(event):
                            yield chunk
                    return
                except Exception:
                    pass
            yield encoder.encode(RunErrorEvent(type=EventType.RUN_ERROR, message=str(e)))
        except Exception as e:
            yield encoder.encode(RunErrorEvent(type=EventType.RUN_ERROR, message=str(e)))

    return StreamingResponse(event_generator(), media_type=encoder.get_content_type())


@app.get("/agent/health")
def health() -> dict:
    agent = _require_agent()
    return {"status": "ok", "agent": {"name": agent.name}}
