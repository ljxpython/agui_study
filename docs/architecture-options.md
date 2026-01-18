# 架构选项：LangGraph x Web x UI

本文档对本仓库的后端路线与 UI/协议对接路线做系统对比。

仓库上下文：
- Python 后端（uv）：`src/`（FastAPI + LangGraph）
- Next.js UI demo：`ui_demo1/`（LangGraph SDK / server 风格对接）
- 模型封装：`src/llms.py`（ChatOpenAI，已为 GPT-5 启用 Responses API）

引用以 URL 内联给出。

## 1. 目标（什么算“好”）

功能目标
- 支持由 LangGraph graph/agent 驱动的类聊天交互。
- 支持流式输出（streaming）。
- 支持工具调用（tool calls）以及中间步骤可见。
- 支持持久化（至少 thread 级状态持久化）。

工程/运维目标
- 需要时支持安全鉴权与多租户隔离（优先对接成熟第三方库/托管方案，避免重复造轮子）。
- 支持可观测性（日志 + trace 关联）。
- 为水平扩展提供路径。

非目标
- 不在本文档中裁决模型质量或 prompt 策略。
- 除非明确选择，否则不把前端锁死在某一种后端运行时上。

## 2. 核心原则：四层职责划分（开发者易懂 + 不重复造轮子）

本项目把系统拆成四层。每一层只有一个核心职责，避免“UI/业务/执行/持久化”互相渗透。

- UI 层（Frontend）
  - 职责：渲染与交互（聊天、项目管理、审计可视化等）。
  - 依赖：只依赖“对外合约层”的 API/事件；不直接依赖模型/Graph 内部细节。

- 对外合约层（Contract Layer）
  - 职责：对外提供稳定的协议/API（这层决定前后端如何对接）。
  - 目标：尽量采用标准合约，避免自造 SSE schema。
  - 两条官方路线（两条都要探索）：
    - 官方路线 1：LangGraph Server / Agent Server API（threads/runs/state/history/stream/resume/cancel）
    - 官方路线 2：AG-UI Events over SSE（标准化事件协议，UI 和执行面都能替换）

- 执行层（Execution / Graph）
  - 职责：LangGraph 图、节点、工具编排、模型调用（使用 `src/llms.py` 的 GPT-5 Responses API wrapper）。
  - 目标：业务逻辑集中在 Graph；不把 HTTP/鉴权/数据库细节塞进节点。

- 状态层（Persistence）
  - 职责：checkpoint/持久化（sqlite/postgres）；为 thread_id/回放/分支提供底座。
  - 目标：状态可追溯、可回放；但不负责 UI 协议。

补充：控制面 vs 执行面
- 控制面（Control Plane）：用户/项目/权限/配置/审计等业务管理（通常是 FastAPI + SQL），属于“对外合约层”的一部分。
- 执行面（Data Plane）：一次 run 的生成与工具执行、流式输出与状态推进（由执行层 + 状态层 + 官方合约共同实现）。

### 2.1 架构图（概念）

说明：控制面与执行面分离。
- 控制面：用户/项目/成员关系/配置/审计（FastAPI + SQL）
- 执行面：LangGraph 执行、流式输出、checkpoint（由执行层 + 状态层 + 官方合约承担）

```text
+----------------------------- UI 层 ------------------------------+
|  Chat UI: ui_demo1 (LangGraph SDK)  |  Workbench: 自研 Ant X/Pro |
+---------------------------+--------------------------------------+ 
                            |
                            v
+------------------------- 控制面（Control Plane） -----------------+
| FastAPI + SQL: users/projects/memberships/config/audit            |
|  - 统一鉴权入口（优先对接第三方 authn/authz）                      |
|  - 维护 project_id <-> thread_id/run_id 的归档映射                 |
+---------------------------+--------------------------------------+
                            |
                            | 选择一种“对外合约层”（两条官方路线都探索）
                            v
+-------------------- 对外合约层（Contract Layer） ------------------+
| 路线 1：LangGraph Server/Agent Server API (threads/runs/stream/...) |
| 路线 2：AG-UI Events over SSE (RUN_*, TEXT_*, TOOL_*, STATE_*)      |
+---------------------------+--------------------------------------+
                            |
                            v
+--------------------------- 执行层（Execution） --------------------+
| LangGraph Graph + Tools + LLM (src/llms.py, GPT-5 Responses API)   |
+---------------------------+--------------------------------------+
                            |
                            v
+--------------------------- 状态层（Persistence） ------------------+
| Checkpointer: sqlite/postgres (thread_id / checkpoint_id)          |
+--------------------------------------------------------------------+
```

## 3. 当前仓库现实（Current Reality）

后端
- 已存在一个最小 DIY FastAPI wrapper：`src/langgraph_teach/api.py`
  - `/invoke` 调用 `GRAPH.invoke(...)`
  - `/stream` 调用 `GRAPH.astream(..., stream_mode="updates")` 并返回 SSE（`text/event-stream`）
- 已存在一个最小 graph：`src/langgraph_teach/graph.py`（当前只是 echo 节点）。
- 模型封装在 `src/llms.py`。

前端
- 已存在完整的 Next.js 应用：`ui_demo1/`。
  - 它会探测 `GET {apiUrl}/info`，并通过 `@langchain/langgraph-sdk` 的 `useStream`/`Client.threads.*` 等对接“LangGraph Server API 风格”的后端。
  - 环境变量示例见：`ui_demo1/.env.example`

推论
- 若优先复用 `ui_demo1`：后端需要对齐官方路线 1（LangGraph Server / Agent Server API）。
- 若优先做自研 UI：推荐优先对齐官方路线 2（AG-UI Events），避免自造 SSE schema；执行面可先用本地 LangGraph，后续再替换为 Agent Server。

## 4. 后端路线对比

### 4.1 路线 B（DIY）：FastAPI + 进程内 LangGraph（invoke/astream）

LangGraph 库本身能直接提供的能力
- 流式迭代器：`graph.stream(...)` / `graph.astream(...)`（支持 stream_mode）。
  - https://docs.langchain.com/oss/python/langgraph/streaming
- 持久化/checkpoint：compile 时传入 checkpointer，并在 config 里传 `thread_id`。
  - https://docs.langchain.com/oss/python/langgraph/persistence

要做到“产品级行为”你必须自建的能力
- runs 资源模型：run_id、状态机、幂等、取消。
- 可恢复流式（Last-Event-ID 一类语义）。
- 背压与慢客户端处理。
- 如果需要后台运行：多 worker 执行与队列。

优点
- 基础设施最小；迭代最快。
- 对 auth、租户、存储 schema、API 合约有完全控制。
- 模型封装（`src/llms.py`）可以保持为单一真相源。

缺点
- 一旦你需要：可恢复流式 + 后台 runs + 跨实例 cancel/join，你会逐步重造一个 agent runtime 的大部分能力。

### 4.2 路线 A（Agent Server）：LangGraph Agent Server / server API

明确由 Server API 提供的能力
- 创建 run 并通过 SSE 流式输出：
  - `POST /threads/{thread_id}/runs/stream`
  - https://docs.langchain.com/langsmith/agent-server-api/thread-runs/create-run-stream-output
- join 已存在的 run stream，并支持可选的 resumability：
  - `GET /threads/{thread_id}/runs/{run_id}/stream` + `Last-Event-ID`（创建时需 `stream_resumable=true`）
  - https://docs.langchain.com/langsmith/agent-server-api/thread-runs/join-run-stream
- 后台 runs / run 生命周期：
  - https://docs.langchain.com/langsmith/agent-server-api/thread-runs/create-background-run
- 取消 run：
  - https://docs.langchain.com/langsmith/agent-server-api/thread-runs/cancel-run
- thread state / history API：
  - https://docs.langchain.com/langsmith/agent-server-api/threads/get-thread-state
  - https://docs.langchain.com/langsmith/agent-server-api/threads/get-thread-history

持久化
- 文档明确：当使用 Agent Server 时，checkpointing 由 server 处理。
  - https://docs.langchain.com/oss/python/langgraph/persistence

运维要求（自建）
- standalone server 预期需要 Redis + Postgres 来支撑 streaming/cancel/task queue 语义。
  - https://docs.langchain.com/langsmith/deploy-standalone-server

优点
- 产品级 runs/threads 语义、可恢复流式、取消、扩展指引。
- 更匹配基于 LangGraph SDK 的前端假设。

缺点
- 运维复杂度更高、升级面更大。
- 实践中通常仍需要一个 gateway 层来统一处理 auth/租户/审计。

### 4.3 RemoteGraph（混合形态）

- RemoteGraph 提供“本地一样”的 Runnable API，但实际执行发生在 server 上。
- 它会根据 config 中是否存在 thread_id 选择不同的 endpoint。
  - https://docs.langchain.com/langsmith/use-remote-graph

## 5. 前端/UI + 协议选项

### 5.1 复用现有 `ui_demo1`（LangGraph SDK UI）

证据
- 仓库包含一个完整 Next.js 应用，带 Thread UI、tool call 渲染，以及 LangGraph SDK 集成。

推论
- 与 Agent Server / LangGraph server API 兼容性最佳。
- 如果选择 DIY backend，需要适配 passthrough 与 client 用法。

### 5.2 Ant Design X + ProChat

Ant Design X
- 使用 fetch body streaming；能把 SSE 协议字段解析为 `{data,event,id,retry}`。
- `data:` 内部放什么 JSON 由你控制。
- 源码证据：
  - `SSEOutput` 类型：
    - https://github.com/ant-design/x/blob/c683f417eb46dee02588323057a57c018b2cac8b/packages/x-sdk/src/x-stream/index.ts#L64-L77
  - 识别 `text/event-stream`：
    - https://github.com/ant-design/x/blob/c683f417eb46dee02588323057a57c018b2cac8b/packages/x-sdk/src/x-request/index.ts#L238-L251

ProChat
- 只做“原始文本流”拼接；不会替你解析 SSE。
- 官方指南建议你自己解析 SSE 并 enqueue 文本 chunk。
  - https://github.com/ant-design/pro-chat/blob/73be565e1b00787435fd951df7fbc684db7923d5/docs/guide/sse.en-US.md#L84-L133

推论
- Ant Design X 适配结构化 SSE 事件更直接。
- ProChat 在后端返回“纯文本 delta”时最省事；若要结构化 tool/state 事件，需要额外协议层/适配层。

### 5.3 CopilotKit + AG-UI

CopilotKit 倾向
- 推荐使用 AG-UI 协议来承载 typed streaming events（通常通过 SSE）。
  - https://copilotkit.ai/blog/ag-ui-protocol-bridging-agents-to-any-front-end
  - https://copilotkit.ai/blog/how-to-add-a-frontend-to-any-langgraph-agent-using-ag-ui-protocol

AG-UI 协议（核心事实）
- 核心抽象：`run(input) -> Observable<BaseEvent>`。
  - https://github.com/ag-ui-protocol/ag-ui/blob/5d68c0feeab702e870ea70f0d79146d6bfdfe484/docs/concepts/architecture.mdx#L89-L134
- 默认 HttpAgent 会发送 `Accept: text/event-stream`。
  - https://github.com/ag-ui-protocol/ag-ui/blob/5d68c0feeab702e870ea70f0d79146d6bfdfe484/docs/sdk/js/client/http-agent.mdx#L96-L106
- 最小强制事件：`RUN_STARTED` 以及（`RUN_FINISHED` 或 `RUN_ERROR`）。
  - https://github.com/ag-ui-protocol/ag-ui/blob/5d68c0feeab702e870ea70f0d79146d6bfdfe484/docs/concepts/events.mdx#L36-L75
- 存在 LangGraph 集成：
  - Python FastAPI endpoint helper：
    - https://github.com/ag-ui-protocol/ag-ui/blob/5d68c0feeab702e870ea70f0d79146d6bfdfe484/integrations/langgraph/python/ag_ui_langgraph/endpoint.py#L12-L27

推论
- 如果你的优先级是“尽量不重造协议/tool/state 轮子”，对齐 AG-UI 是复用性最强的做法。

## 6. 推荐的探索策略（按你的偏好：先复用 ui_demo1，再探索 AG-UI）

你当前偏好：
- UI：先复用 `ui_demo1`（避免重复造 UI 轮子）
- 官方路线：两条都探索（路线 1：Server API；路线 2：AG-UI）
- 业务诉求：需要控制面（用户/项目/权限/审计），但权限细节暂时不是重点

因此推荐按“控制面先行、执行面可替换”的方式推进：

### 6.1 阶段 1：官方路线 1（先跑通 ui_demo1）
- UI：直接使用 `ui_demo1`
- 对外合约层：LangGraph Server / Agent Server API
- 执行层：LangGraph graph + tools + `src/llms.py`
- 状态层：checkpoint（先 sqlite，后续可切 postgres）
- 控制面：FastAPI + SQL 管理用户/项目/配置，把 thread_id/run_id 与 project/user 关联（不自己发明 runs/threads 的执行语义）

### 6.2 阶段 2：官方路线 2（引入 AG-UI 作为稳定事件合约）
- 目标：把“事件协议”标准化，避免自造 SSE schema，让 UI 和执行面都可替换
- 做法：在对外合约层增加一个 AG-UI endpoint（SSE events），内部仍复用同一执行层/状态层
- 收益：
  - 后续你想做“更精美的 UI”（例如 Ant Design X/Pro）时，直接消费 AG-UI events 即可
  - 后续执行面从本地 LangGraph 切到 Agent Server 时，UI 不需要改（或最小改）

### 6.3 什么时候才值得做“全自研协议/全自研运行时”（不默认推荐）
只有在出现硬约束时才考虑：
- 合规/内网/离线导致不能使用现成 server/runtime
- 需要极强的定制化 run 生命周期语义，且官方合约无法满足
- 需要对“断线续流/幂等/工具副作用”做非常强的可证明保证

## 7. 测试计划（非 trivial 验证）

目标
- 验证两条后端路线都能端到端跑通 streaming 与 persistence。

前置条件
- Python 3.13 + `uv sync`。
- Agent Server 自建时：需要 Postgres + Redis。

测试用例
1) DIY：invoke
- 输入：POST `/invoke`，body `{"messages":["hi"],"thread_id":"t1"}`
- 预期：JSON 响应；消息列表包含 assistant 输出。

2) DIY：stream
- 输入：POST `/stream`，body `{"messages":["hi"],"thread_id":"t1"}`
- 预期：`text/event-stream`；多段 chunk；正常结束。

3) Agent Server：可恢复 streaming
- Start：创建 streamable run 且 `stream_resumable=true`。
- 中途断开连接。
- Resume：携带 `Last-Event-ID` 重新连接。
- 预期：不重复副作用，流可继续。

成功标准
- 所有用例通过。

## 8. 控制面与鉴权（尽量不造轮子，权限细节先留口子）

本项目需要“控制面”来管理：用户、项目、成员关系（用户-项目）、配置、审计。
权限（RBAC/ABAC）本身不是当前阶段重点，但需要预留清晰的模块边界。

### 8.1 控制面数据模型（建议最小集）

- User：用户基础信息
- Project：项目
- Membership：用户加入项目的关系（未来可扩展 role/permission）
- AuditLog（可选）：关键操作与 run 归档

### 8.2 鉴权/授权选型（成熟库优先）

目标：不重复造轮子。

- 认证（Authn）建议候选：
  - FastAPI Users：用户系统 + 多种 token 形态（Transport + Strategy）；注意项目处于 maintenance mode
    - https://fastapi-users.github.io/fastapi-users/latest/
    - https://fastapi-users.github.io/fastapi-users/latest/configuration/authentication/
  - Authlib：OAuth2/OIDC client，对接企业 IdP（Keycloak/Okta/Auth0/Azure AD 等）
    - https://docs.authlib.org/en/latest/client/fastapi.html

- 授权（Authz）建议候选：
  - Casbin / PyCasbin：把授权建模为 subject/object/action；适合后续补齐 RBAC/ABAC
    - https://casbin.org/docs/overview/
    - https://casbin.org/docs/rbac
  - FastAPI 中间件参考（减少样板代码）：
    - https://github.com/officialpycasbin/fastapi-casbin-auth

### 8.3 边界原则（写给未来的你/新同学）

- UI 层永远不直接碰数据库。
- 执行层（Graph）永远不关心“用户是谁/项目是谁”，只接受最小上下文（例如 project_id）并把行为记录交给控制面。
- 对外合约层负责把“当前用户/当前项目”的身份上下文注入到执行面（或转发到 Agent Server），并写审计。

## 9. 需要回答的问题（用于最终收敛选型）

- 你是否把“可恢复 streaming（Last-Event-ID 语义）”作为硬性要求？
- 你近期是否要做多实例部署？
- 你希望长期维护的前端是哪一个：`ui_demo1`、Ant Design X/Pro，还是 CopilotKit？
