# 主线讨论记录（预备）

> 目标：先讨论清楚，再写任何代码。

## 1. 已确认的仓库现实

- Python 后端（uv）：`src/`
  - DIY FastAPI：`src/langgraph_teach/api.py`（`/invoke` + `/stream` SSE）
  - LangGraph graph：`src/langgraph_teach/graph.py`
  - GPT-5 模型封装：`src/llms.py`（Responses API）
- Next.js 前端：`ui_demo1/`
  - 现成 Thread UI + tool call / interrupt / history / multimodal 等组件（待清点细节）
  - 当前更偏向对接 LangGraph server API（通过 passthrough）

## 2. 两条后端路线（讨论对象）

- 路线 A：LangGraph Agent Server / server API
- 路线 B：DIY FastAPI + 进程内 LangGraph

## 3. 三个关键决策点（必须先定）

1) 对外合约（API/协议）
- 直接绑定 Agent Server/Server API
- 采用 AG-UI 事件协议作为稳定合约
- 自定义协议（除非有硬需求，否则不建议）

2) Streaming 可恢复性
- 是否要求 Last-Event-ID 语义级续流

3) UI 选择
- 复用 `ui_demo1`
- Ant Design X/Pro
- CopilotKit

## 4. 控制面 <-> 执行面：最小契约（5 条规则）

目标：不把“用户/项目/权限”塞进 Graph；也不让 UI 直接碰数据库；同时能在两条官方路线下保持一致的业务语义。

1) project_id 如何绑定 thread_id
- 原则：thread 是执行面的“会话容器”，project 是控制面的“业务容器”。
- 最小做法：控制面维护一张映射表 `ProjectThread(project_id, thread_id, created_by_user_id, created_at, metadata)`。
- 约束：
  - 一个 project 可以有多个 thread。
  - thread_id 的创建语义由官方路线决定（路线 1：由 server 创建；路线 2：由控制面生成/分配并注入到事件流上下文）。

2) run_id 如何归档
- 原则：run 是一次执行；控制面只做“归档与审计”，不重写 run 生命周期。
- 最小字段：`RunIndex(run_id, thread_id, project_id, user_id, started_at, finished_at, status, provider)`。
- 约束：run_id 的生成语义同样由官方路线决定（路线 1：server 产生；路线 2：对外合约层产生并写入 AG-UI 的 RUN_STARTED）。

3) 审计最小字段集（AuditLog）
- 原则：先能排障与追溯，RBAC 细节后置。
- 建议最小字段：
  - actor：user_id
  - scope：project_id / thread_id / run_id
  - action：例如 "chat.submit" / "tool.invoke" / "run.cancel"
  - timestamps：created_at + duration_ms（如有）
  - result：success/error_code（如有）
  - summary：输入/输出摘要（注意脱敏与合规；可先只存 hash 或长度）

4) 身份上下文如何注入（不决定 RBAC 细节）
- 原则：对外合约层负责把 `user_id` / `project_id` 注入执行面；执行层只消费最小上下文。
- 做法：
  - 路线 1（Server API）：网关/代理层在转发 server API 请求时携带身份（例如 header 或 server-side session），并在控制面做访问控制。
  - 路线 2（AG-UI）：在 run input 或 config 中附带 `project_id`，并在事件流的 RUN_STARTED 中带上（用于审计和 UI 归档）。

5) UI 访问路径（先 ui_demo1、后自研 UI）
- 原则：先复用 ui_demo1 验证执行面语义；自研 UI 时复用标准合约。
- 路径：
  - 阶段 1：ui_demo1 -> Server API（threads/runs/stream）
  - 阶段 2：自研 UI（Ant Design X/Pro）-> AG-UI Events（SSE）
  - 控制面 UI（项目/用户/配置/审计）始终走控制面 API（FastAPI + SQL），不与执行面耦合。

## 5. 基准用例（用于对比，不是最终产品目标）

我们用一个固定的基准用例来评估三条探索线的优劣：

- 用例：SQL 助手（Chinook.db）+ MCP 图表工具 + 产物下载
- 目标能力：端到端聊天、流式、tool calls、interrupt、history
- 目的：比较“官方路线 1（Server API）”与“官方路线 2（AG-UI）”以及控制面接入后的复杂度/清晰度

数据与代码来源（可复用资产）
- DB：`/Users/bytedance/PycharmProjects/my_best/langgraph_teach/src/examples/Chinook.db`
- 旧例子：`/Users/bytedance/PycharmProjects/my_best/langgraph_teach/src/examples/sql_agent.py`

## 6. 环境变量隔离（每条探索线独立）

你已确认：每条探索线是独立项目，因此 `.env` 不共享。

建议约定：
- `apps/server_api_ui_demo1/.env`
- `apps/ag_ui_events/.env`
- `apps/control_plane/.env`

## 7. 待补充证据

- `ui_demo1` 对后端 API 的具体假设（必需 env、路由、header、payload）
- DIY FastAPI 与上述假设的差距
- AG-UI 事件最小集 + LangGraph 映射
- Ant Design X/ProChat 的流式消费方式
- CopilotKit 对协议/运行时的约束

