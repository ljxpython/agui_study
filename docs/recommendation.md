# 建议：同时探索两条官方路线，按“四层职责”推进

本仓库当前已经具备：
- DIY FastAPI wrapper + 进程内 LangGraph：`src/langgraph_teach/api.py`
- 一个完整的 Next.js demo：`ui_demo1/`（LangGraph SDK UI，要求后端是 Server API 风格）
- GPT-5 的 Responses API 封装：`src/llms.py`

核心目标：
- 开发者易懂：模块边界清晰，新同学知道该改哪一层。
- 不重复造轮子：协议与运行时语义优先复用官方合约。
- 本仓库的目标是“验证/探索/对比”：
  - 不是把某个 SQL 助手做成最终产品
  - 而是用一个可重复的基准用例（SQL 助手 + MCP 图表工具 + 产物下载）来对比方案优劣
- 两条官方路线都要探索：
  - 官方路线 1：LangGraph Server / Agent Server API（threads/runs/stream/resume/cancel/history）
  - 官方路线 2：AG-UI Events over SSE（标准化事件协议，UI 与执行面可替换）

## 1. 两条后端路线（优先要测什么）

### 路线 B：DIY FastAPI + 进程内 LangGraph
- 使用 LangGraph 库 API：
  - streaming：`graph.stream/graph.astream` + stream_mode
    - https://docs.langchain.com/oss/python/langgraph/streaming
  - persistence：compile with checkpointer + config 传 `thread_id`
    - https://docs.langchain.com/oss/python/langgraph/persistence

如果你需要以下能力，需要自建：
- run_id 生命周期、取消、重试
- 可恢复 streaming（Last-Event-ID 语义）
- 后台 runs / 队列

### 路线 A：LangGraph Agent Server / server API
Server API 明确提供的能力：
- create+stream run：`POST /threads/{thread_id}/runs/stream`
  - https://docs.langchain.com/langsmith/agent-server-api/thread-runs/create-run-stream-output
- join/resume run stream（Last-Event-ID）：`GET /threads/{thread_id}/runs/{run_id}/stream`
  - https://docs.langchain.com/langsmith/agent-server-api/thread-runs/join-run-stream
- background runs：`POST /threads/{thread_id}/runs`
  - https://docs.langchain.com/langsmith/agent-server-api/thread-runs/create-background-run
- cancel run：`POST /threads/{thread_id}/runs/{run_id}/cancel`
  - https://docs.langchain.com/langsmith/agent-server-api/thread-runs/cancel-run

自建时的关键运维取舍：
- 数据面语义通常依赖 Redis + Postgres
  - https://docs.langchain.com/langsmith/deploy-standalone-server

## 2. 协议/UI：避免重造“事件层”

你有三种现实选择：

### 选项 P1：保留 `ui_demo1`（LangGraph SDK UI）
- 如果 `LANGGRAPH_API_URL` 背后是 LangGraph server API，前端阻力最小。
- 与 Agent Server / RemoteGraph 最匹配。

### 选项 P2：把 AG-UI 作为稳定事件协议（如果你想长期灵活，推荐）
AG-UI 提供 typed event 模型覆盖：
- run/step 生命周期
- 文本流式事件
- tool call 事件
- state snapshot + JSON Patch delta

核心事实：
- `run(input) -> Observable<BaseEvent>`
  - https://github.com/ag-ui-protocol/ag-ui/blob/5d68c0feeab702e870ea70f0d79146d6bfdfe484/docs/concepts/architecture.mdx#L89-L134
- HttpAgent 默认使用 `Accept: text/event-stream`
  - https://github.com/ag-ui-protocol/ag-ui/blob/5d68c0feeab702e870ea70f0d79146d6bfdfe484/docs/sdk/js/client/http-agent.mdx#L96-L106
- 最小强制事件：`RUN_STARTED` 与（`RUN_FINISHED` 或 `RUN_ERROR`）
  - https://github.com/ag-ui-protocol/ag-ui/blob/5d68c0feeab702e870ea70f0d79146d6bfdfe484/docs/concepts/events.mdx#L36-L75
- 已提供 LangGraph 集成：
  - Python FastAPI endpoint helper
    - https://github.com/ag-ui-protocol/ag-ui/blob/5d68c0feeab702e870ea70f0d79146d6bfdfe484/integrations/langgraph/python/ag_ui_langgraph/endpoint.py#L12-L27

这条路线的优势：前端不绑定某个后端 runtime，未来可替换执行面。

### 选项 P3：Ant Design X / ProChat
- Ant Design X 可消费结构化 SSE（会解析 event/data/id/retry），你可以定义 `data:` 内 JSON
  - https://github.com/ant-design/x/blob/c683f417eb46dee02588323057a57c018b2cac8b/packages/x-sdk/src/x-stream/index.ts#L64-L77
  - https://github.com/ant-design/x/blob/c683f417eb46dee02588323057a57c018b2cac8b/packages/x-sdk/src/x-request/index.ts#L238-L251
- ProChat 默认消费“原始文本流”；如果后端是 SSE，你通常要先解析 SSE 再把文本 delta 重新 enqueue
  - https://github.com/ant-design/pro-chat/blob/73be565e1b00787435fd951df7fbc684db7923d5/docs/guide/sse.en-US.md#L84-L133

注意：Ant Design 是 UI 组件层，本身不解决 agent 事件协议问题。

## 3. 路线图（Roadmap）：先复用 ui_demo1，再探索 AG-UI

## 3.1 建议的探索目录结构（一个子目录一条探索线）

建议把“探索线”按合约/目标拆分到单独子目录，形成三个**完全独立的小项目**，互不干扰：

- `apps/server_api_ui_demo1/`：官方路线 1（让 ui_demo1 直连的 Server API 形态）
- `apps/ag_ui_events/`：官方路线 2（AG-UI endpoint + SSE events）
- `apps/control_plane/`：控制面（users/projects/memberships/config/audit）

约束（你已确认）：
- 每个目录都是一个独立项目：各自拥有 `.env`、`pyproject.toml`、`uv.lock`、`.venv`（如需要）。
- 允许直接复制必要代码到各自目录，互不干扰。
- 注意：完全复制会带来“版本漂移”风险，因此建议把“对比基准用例”的输入/输出合约写死（见下文测试计划）。

安全提醒
- `.env` 文件允许存在于每个子项目，但任何真实 key 都不要提交到 git。


我们的偏好是：
- 先复用 `ui_demo1`（最大化不造 UI 轮子）
- 同时把“控制面”（用户/项目/配置/审计）预留出来，但权限细节不作为当前重点

### 阶段 0：定边界（只做一次，后面不反复争）
- 执行层：LangGraph Graph + tools + `src/llms.py`
- 状态层：checkpoint（sqlite/postgres）
- 对外合约层：两条官方路线并行探索（Server API / AG-UI）
- UI 层：先用 `ui_demo1`，后续再做自研精美 UI

### 阶段 1：官方路线 1（跑通 ui_demo1 + Server API 语义）
目标：用最少改动让 `ui_demo1` 端到端可用，并把“产品化语义”交给官方 runtime。

验证点（Pass/Fail）
- Functional：能聊天、能流式、能展示 tool calls、能处理 interrupts、能看历史线程
- Observable：`GET {apiUrl}/info` 通过；threads 能 search/delete；stream 能跑完并更新 thread list
- Pass/Fail：ui_demo1 不改协议的前提下能完整跑通一次对话

### 阶段 2：官方路线 2（引入 AG-UI 作为稳定事件合约）
目标：把事件协议标准化，后续自研 UI（Ant Design X/Pro）时不需要再发明 SSE schema。

验证点（Pass/Fail）
- 事件最小集：`RUN_STARTED` ... `RUN_FINISHED/RUN_ERROR`（并满足 AG-UI verifier 约束）
- 文本流：`TEXT_MESSAGE_*` 或 `TEXT_MESSAGE_CHUNK`
- 工具：`TOOL_CALL_*` + 可选 `TOOL_CALL_RESULT`

### 阶段 3：自研精美 UI（但不自研协议/运行时语义）
目标：做一个“项目/用户/配置/审计 + Chat”的工作台式 UI。

控制面（建议作为单独模块/服务）
- 数据对象：User、Project、Membership（用户-项目关联）、Role/Permission（预留）
- 职责：
  - 管理用户/项目/成员关系
  - 保存 UI/Agent 配置（例如默认模型、工具开关、配额策略）
  - 把 thread_id / run_id 归档到 project/user（不重写 runs/threads 的执行语义）

鉴权（不重复造轮子）
- 目标：优先使用成熟第三方库/托管方案；当前阶段先把接口留出来，不在本阶段把 RBAC 做满。
- 最小落地原则：
  - UI 访问控制面 API（用户/项目）需要鉴权
  - 执行面（Server API 或 AG-UI SSE）也必须能拿到“当前用户/当前项目”的身份上下文（哪怕暂时只做 project_id 透传）

原则
- UI 可以自研，但不要自研执行面协议：优先消费 Server API 或 AG-UI。
- 控制面（FastAPI + SQL）可以自研，但鉴权/会话尽量对接成熟方案，减少重复造轮子。

### 阶段 4：收敛与演进
- 选择“长期主对外合约”：继续 Server API，或以 AG-UI 为主、Server API 为兼容层。
- 增加多租户/权限（如果必要）：控制面先落地，执行面跟随控制面做访问控制与审计。

## 4. 测试计划（如何证明结论）

目标
- 证明 streaming 正确性、（如需要）可恢复性、持久化，以及 UI 能正确消费事件。

最小用例
1) Streaming
- 测 TTFB 与 chunk cadence。

2) 断线/重连
- DIY：只有实现了 resumable 语义才算通过。
- Agent Server：验证 `Last-Event-ID` resume。

3) Tool calls
- 验证 UI 能把 tool calls 与 assistant 文本区分渲染。

4) Persistence
- 验证 thread_id 在多次调用间能保持状态。

成功标准
- 所有测试都能复现且通过。

## 5. 收敛用的简短问卷

回答这些就能把“最优方案”收敛到 1 套：
- 你是否把可恢复 streaming 作为硬性要求？（yes/no）
- 你是否想把 `ui_demo1` 作为主 UI，还是切到 Ant Design X/Pro？
- 你是想用 CopilotKit，还是只采用 AG-UI 协议但不用 CopilotKit？
- 部署目标：单实例还是多实例？
