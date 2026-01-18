# 方案 2 进展：agui_events_demo2（AG-UI Events over SSE）

## 目标

- 在本目录内探索“官方路线 2（AG-UI events）”，实现与 Route 1（`apps/server_api_ui_demo1`）等价的基准能力：
  - chat / streaming
  - tool calls（SQL / download；MCP chart 作为可选项）
  - interrupt / resume（Human-in-the-loop）
  - history / state（通过 checkpointer + snapshot events）

## 当前状态（可复现的事实）

路径：`apps/agui_events_demo2`

### 1) 子项目已创建（已完成）

- 独立 `pyproject.toml` / `uv.lock` / `.venv`
- 独立 `.env` / `.env.example`
- 运维入口：`apps/agui_events_demo2/Makefile`（start/stop/status/logs/tail）
- 基准 DB：`apps/agui_events_demo2/data/Chinook.db`

### 2) 后端：AG-UI SSE endpoint + LangGraph（已完成）

- FastAPI 服务：`apps/agui_events_demo2/src/server.py`
  - `POST /agent`：入参 `RunAgentInput`，出参 `text/event-stream`
  - `GET /agent/health`：健康检查
- LangGraph graph：`apps/agui_events_demo2/src/agent_graph.py`
  - SQL 工具（`SQLDatabaseToolkit`）
  - 可选下载工具：`download_text_file`（data URL）
  - Human-in-the-loop：在 `sql_db_query` 前触发 `interrupt(...)`，前端用 `forwarded_props.command.resume=[...]` 恢复
- 持久化/checkpointer：sqlite（必须）
  - 原因：`ag_ui_langgraph` 每次 run 会调用 `graph.aget_state(...)`，没有 checkpointer 会直接报错

### 3) 前端：ui_demo2（已完成）

- `apps/agui_events_demo2/ui_demo2`：Vite + React
- 使用 fetch(POST) + 自实现 SSE parser（因为 EventSource 不支持 POST）
- 支持：
  - streaming 文本（TEXT_MESSAGE_*）
  - 工具调用（TOOL_CALL_* + TOOL_CALL_RESULT）
  - interrupt（CUSTOM: on_interrupt）+ resume（accept/edit/ignore/response）
  - tool 输出中的 link/data URL 下载

### 4) 文档（进行中）

- `docs/route2-agui-overview.md`
- `docs/route2-agui-architecture.md`
- `docs/route2-agui-troubleshooting.md`
- 本进展文档：`docs/route2-progress.md`

## 验收（建议命令）

```bash
# 1) 启动
uv sync
make -C apps/agui_events_demo2 start

# 2) 健康检查
curl -s http://localhost:8123/agent/health

# 3) SSE 冒烟：触发 interrupt
curl -N -H 'Accept: text/event-stream' -H 'Content-Type: application/json' \
  -X POST http://localhost:8123/agent \
  -d '{"thread_id":"t_demo","run_id":"r1","state":{},"messages":[{"id":"m1","role":"user","content":"Run SQL: SELECT COUNT(*) AS n FROM Track;"}],"tools":[],"context":[],"forwarded_props":{}}'

# 4) UI 验收
open http://localhost:8124

# 5) 停止
make -C apps/agui_events_demo2 stop
```

## 未完成项 / 风险

- MCP chart tools（`ENABLE_MCP_CHART=1`）目前仍保持关闭：
  - `langchain_mcp_adapters.MultiServerMCPClient.get_tools()` 是 async，需要把初始化迁移到 FastAPI startup/lifespan，并把 tools 缓存后再构建 graph。
