from __future__ import annotations

import json
from typing import Any, AsyncIterator, cast

from fastapi import FastAPI
from fastapi.responses import JSONResponse, StreamingResponse

from langchain_core.runnables import RunnableConfig

from langgraph_teach.graph import GRAPH, ChatState

app = FastAPI(title="langgraph-teach")


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


@app.post("/invoke")
def invoke(payload: dict[str, Any]) -> JSONResponse:
    messages = payload.get("messages", [])
    inputs = cast(ChatState, {"messages": messages})

    thread_id = payload.get("thread_id")
    config: RunnableConfig | None = None
    if thread_id is not None:
        config = cast(RunnableConfig, {"configurable": {"thread_id": str(thread_id)}})

    result = GRAPH.invoke(inputs, config=config)
    return JSONResponse(result)



@app.post("/stream")
async def stream(payload: dict[str, Any]) -> StreamingResponse:
    messages = payload.get("messages", [])
    inputs = cast(ChatState, {"messages": messages})

    thread_id = payload.get("thread_id")
    config: RunnableConfig | None = None
    if thread_id is not None:
        config = cast(RunnableConfig, {"configurable": {"thread_id": str(thread_id)}})

    async def event_iter() -> AsyncIterator[bytes]:
        async for chunk in GRAPH.astream(inputs, config=config, stream_mode="updates"):
            data = json.dumps(chunk, ensure_ascii=True, separators=(",", ":"))
            yield f"data: {data}\n\n".encode("utf-8")

    return StreamingResponse(event_iter(), media_type="text/event-stream")
