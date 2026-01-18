# agui-events-demo2 (Route 2)

目标：探索“官方路线 2（AG-UI events over SSE）”，实现与 `apps/server_api_ui_demo1` 等价的基准能力：

- chat + streaming
- tool_calls（SQL / MCP chart / download）
- interrupt/resume（Human-in-the-loop）
- history/state（以 AG-UI 的 state snapshot/messages snapshot 表达）

## 快速开始

```bash
uv sync
make help
make start
make status
```

- 后端默认端口：`8123`
- 前端默认端口：`8124`

## 文档（教学向）

- `docs/route2-agui-overview.md`
- `docs/route2-agui-architecture.md`
- `docs/route2-agui-troubleshooting.md`

## 目录结构

- `src/server.py`: FastAPI + AG-UI SSE endpoint（POST `/agent`）
- `src/llms.py`: Zhipu LLM 封装
- `ui_demo2/`: Route2 前端 demo（AG-UI SSE client）
- `data/Chinook.db`: 基准数据库
