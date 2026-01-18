# 方案 1 进展：server_api_ui_demo1 (LangGraph Server API + ui_demo1)

## 目标

- 验证/探索/对比：不是把 SQL 助手做成最终产品。
- 以“SQL 基准用例（Chinook.db）+ MCP 图表 + 产物下载”为固定输入，评估：
  - LangGraph Server API（ui_demo1）路线的工程复杂度/能力上限
  - 是否满足：chat / streaming / tool calls / interrupt / history

## 当前状态（可复现的事实）

### 1) 子项目已创建

路径：`apps/server_api_ui_demo1`

- 独立 `pyproject.toml` / `uv.lock` / `.venv`
- 独立 `.env`（不共享根目录）
- DB：`apps/server_api_ui_demo1/data/Chinook.db`
- graph 注册：
  - `apps/server_api_ui_demo1/langgraph.json`
  - `apps/server_api_ui_demo1/graph.json`
  - graph_id = `agent`（与 ui_demo1 默认 assistantId 一致）

### 2) Server API 已启动并可访问

启动方式（当前）：
- `nohup .venv/bin/python start_server.py > server.log 2>&1 &`

证据：
- `GET http://localhost:2024/info` 返回 200
- `/openapi.json` 显示具备 Route 1 所需资源路径：
  - `/info`
  - `/threads/search`
  - `/threads/{thread_id}/runs/stream`
  - `/threads/{thread_id}/history`
  - `/runs/stream`

## 当前状态（已完成）

- 真实 LLM（glm-4.7）已跑通：chat / tool_calls / streaming / interrupt / resume / history。
- interrupt/resume：在执行 `sql_db_query` 前触发 Agent Inbox 中断（Accept/Edit/Ignore/Response），resume 后继续执行并写入 thread state。
- 运行脚本：已提供 `apps/server_api_ui_demo1/Makefile`（单文件），支持前端/后端单独或一起 start/stop/status/logs/tail。

## 结论（已完成）

本探索线验收通过：

- LangGraph Server API + `ui_demo1` 直连可用
- 真实 LLM（glm-4.7）可用：chat / streaming / tool_calls
- interrupt/resume 可用：SQL 执行前审批（Agent Inbox）
- history 可用：threads/history 可回放
- MCP 图表可用：`ENABLE_MCP_CHART=1` 时会启动 chart MCP server，并在 UI 渲染图表
- 下载可用：
  - 非图片 `data:*;base64,...` 会显示为可下载链接
  - 图表图片提供“打开/下载”（跨域时下载会尽量走 fetch->blob）
- 运维可用：单文件 `Makefile` 支持一键启动/停止/日志/状态（默认自动处理端口冲突）

## 复用原则（给未来的探索子项目）

- 每个探索子项目在 `apps/<name>` 目录下完全独立：自己的 `.env` / `.venv` / Makefile
- 进程管理统一走 Makefile：`make start/stop/restart/status/logs/tail`

## 下一步建议（探索方向）

1) Route 2（AG-UI events）：验证事件流 UI（更强的“可控 UI”能力）与 Route 1 的工程权衡。
2) 将“控制面/数据面”边界写成最小契约（JWT/多租户暂不实现），确保未来可插拔。

