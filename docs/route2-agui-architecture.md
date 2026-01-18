# Route 2（AG-UI Events）架构说明

本文档给出 Route 2 的架构视图、数据流与关键交互序列（normal chat / tool call / interrupt-resume / history & state snapshot）。

引用来源（官方）：

- AG-UI Core architecture：https://docs.ag-ui.com/concepts/architecture
- AG-UI Events（概念解释）：https://docs.ag-ui.com/concepts/events
- AG-UI TS SDK events/types（字段级定义）：
  - Events：https://docs.ag-ui.com/sdk/js/core/events
  - Types（`RunAgentInput`）：https://docs.ag-ui.com/sdk/js/core/types
- Interrupts（Draft）：https://docs.ag-ui.com/drafts/interrupts

本仓库 Route 2 demo2 实现入口：`apps/agui_events_demo2/src/server.py`。

> 重要边界：demo2 代码只展示了“FastAPI + LangGraphAgent + endpoint helper”的最小组合。下文对 tool、interrupt、history 的序列，会以“协议允许且推荐的事件形态”描述，并在需要处标注“取决于执行面/适配器是否实现”。

---

## 1. 架构图（ASCII）

Route 2 用 AG-UI 把“对外合约层”标准化成一个事件流端点。

```text
+---------------------------+       POST RunAgentInput        +---------------------------+
|           UI              |  -----------------------------> |        FastAPI             |
|  (AG-UI client/HttpAgent) |                                  |  (Contract: AG-UI over SSE)|
+-------------+-------------+       SSE stream<BaseEvent>      +-------------+-------------+
              |               <-----------------------------                 |
              |                                                              |
              v                                                              v
+---------------------------+                                  +---------------------------+
|  AG-UI client components  |                                  |   Execution (LangGraph)    |
|  - HttpAgent              |                                  |   - Graph nodes/tools/LLM  |
|  - Event decoder          |                                  |   - Checkpointer (optional)|
|  - Subscriber/middleware  |                                  +-------------+-------------+
+---------------------------+                                                |
              |                                                              |
              v                                                              v
+---------------------------+                                  +---------------------------+
|   UI Renderers / State    |                                  |  Persistence (optional)    |
|   - messages timeline     |                                  |  - thread checkpoints      |
|   - tool call panel       |                                  |  - audit index (control)   |
|   - shared state view     |                                  +---------------------------+
+---------------------------+
```

关键点：

- UI 与执行面之间只约定两件事：`RunAgentInput`（输入）与 `BaseEvent`（输出）。见：https://docs.ag-ui.com/concepts/architecture
- 传输层可选 SSE 或 binary；本仓库 Route 2 定位为 SSE。见：https://docs.ag-ui.com/concepts/architecture

---

## 2. 数据流图（Dataflow）

以下用“数据对象”描述一次 run 的流向。

```text
[User Action]
  |
  | (1) UI collects: messages/state/tools/context
  v
[RunAgentInput]
  - threadId
  - runId
  - messages[]
  - state
  - tools[]
  - context[]
  - forwardedProps
  |
  | (2) HTTP POST to AG-UI endpoint (Accept: text/event-stream)
  v
[FastAPI Contract Layer]
  |
  | (3) Execution: agent.run(input)
  v
[Event Stream: BaseEvent...]
  - RUN_STARTED
  - (TEXT_MESSAGE_*/TOOL_CALL_*/STATE_*/MESSAGES_SNAPSHOT/CUSTOM...)
  - RUN_FINISHED or RUN_ERROR
  |
  | (4) SSE frames (data: <event json>)
  v
[UI Event Handler]
  - update message buffers by messageId
  - update tool call buffers by toolCallId
  - apply STATE_DELTA patches or replace by STATE_SNAPSHOT
  - refresh history by MESSAGES_SNAPSHOT
```

字段级参考：

- `RunAgentInput`：https://docs.ag-ui.com/sdk/js/core/types
- `EventType` 与各事件结构：https://docs.ag-ui.com/sdk/js/core/events

---

## 3. 关键序列（Sequence Diagrams / ASCII）

### 3.1 正常聊天（Normal chat）

目标：把一条 user 输入变成一条 assistant 输出，支持文本流式。

```text
UI                        FastAPI (AG-UI endpoint)         Agent/Execution
|                                 |                          |
| POST RunAgentInput              |                          |
| (threadId, runId, messages,...) |                          |
|-------------------------------> |                          |
|                                 | emit RUN_STARTED         |
|                                 |------------------------> |
| <----- SSE: RUN_STARTED --------|                          |
|                                 | emit TEXT_MESSAGE_START  |
|                                 |------------------------> |
| <--- SSE: TEXT_MESSAGE_START ---|                          |
|                                 | emit TEXT_MESSAGE_CONTENT (delta...)
| <--- SSE: TEXT_MESSAGE_CONTENT -|                          |
|                                 | ... repeated ...         |
| <--- SSE: TEXT_MESSAGE_CONTENT -|                          |
|                                 | emit TEXT_MESSAGE_END
| <--- SSE: TEXT_MESSAGE_END -----|                          |
|                                 | emit RUN_FINISHED
| <----- SSE: RUN_FINISHED -------|                          |
```

语义与事件定义：

- `RUN_STARTED` / `RUN_FINISHED`：https://docs.ag-ui.com/concepts/events
- `TEXT_MESSAGE_*`：https://docs.ag-ui.com/concepts/events

### 3.2 工具调用（Tool call）

目标：让 UI 能“看到 agent 在调用哪个 tool、参数是什么、结果是什么”。

> 说明：本仓库 demo2 graph 目前没有定义工具节点；此序列描述的是 AG-UI 标准事件语义与 UI 应对方式。

```text
UI                        FastAPI (AG-UI endpoint)         Agent/Execution
|                                 |                          |
| POST RunAgentInput (tools=[...])|                          |
|-------------------------------> |                          |
| <----- SSE: RUN_STARTED --------|                          |
|                                 | decide to call tool      |
|                                 | emit TOOL_CALL_START     |
| <--- SSE: TOOL_CALL_START ------|                          |
|                                 | emit TOOL_CALL_ARGS      |
| <--- SSE: TOOL_CALL_ARGS -------|                          |
|                                 | ... args streamed ...    |
| <--- SSE: TOOL_CALL_ARGS -------|                          |
|                                 | emit TOOL_CALL_END       |
| <--- SSE: TOOL_CALL_END --------|                          |
|                                 | execute tool             |
|                                 | emit TOOL_CALL_RESULT    |
| <--- SSE: TOOL_CALL_RESULT -----|                          |
|                                 | continue assistant text  |
| <--- SSE: TEXT_MESSAGE_* -------|                          |
| <----- SSE: RUN_FINISHED -------|                          |
```

字段级定义：https://docs.ag-ui.com/sdk/js/core/events

落地要点：

- UI 应按 `toolCallId` 把 start/args/end/result 关联起来。
- `TOOL_CALL_ARGS.delta` 通常是 JSON 片段，UI 需要拼接并（可选）解析成对象。

### 3.3 中断与恢复（Interrupt / Resume，Draft）

目标：在敏感操作（如执行有副作用的 tool）前暂停，让用户审批/补充输入，再恢复同一 thread。

该模式目前在 AG-UI 文档中属于 Draft（请在项目里明确版本锁定与兼容策略）：

- Interrupt-aware Run Lifecycle proposal：https://docs.ag-ui.com/drafts/interrupts

#### 3.3.1 中断（run finishes with interrupt）

```text
UI                         FastAPI (AG-UI endpoint)          Agent/Execution
|                                  |                           |
| POST RunAgentInput               |                           |
|--------------------------------> |                           |
| <----- SSE: RUN_STARTED ---------|                           |
|                                  | need human approval       |
|                                  | emit RUN_FINISHED         |
|                                  | (outcome="interrupt", interrupt={...})
| <----- SSE: RUN_FINISHED --------|                           |
| UI shows approval form           |                           |
```

关键字段（Draft）：

- `RUN_FINISHED.outcome = "interrupt"`
- `RUN_FINISHED.interrupt = { id?, reason?, payload? }`

见：https://docs.ag-ui.com/drafts/interrupts

#### 3.3.2 恢复（new run with resume payload）

```text
UI                         FastAPI (AG-UI endpoint)          Agent/Execution
|                                  |                           |
| POST RunAgentInput               |                           |
| (same threadId, new runId,       |                           |
|  resume={interruptId,payload})   |                           |
|--------------------------------> |                           |
| <----- SSE: RUN_STARTED ---------|                           |
| <--- SSE: (tool/text/state...) --|                           |
| <----- SSE: RUN_FINISHED --------|                           |
```

`RunAgentInput.resume` 的结构与 contract rules 见：https://docs.ag-ui.com/drafts/interrupts

工程注意点：

- 必须复用同一 `threadId`（contract rule）。
- 兼容性：`outcome` 字段是 optional（back-compat）；UI/服务端应按文档规则处理“缺省 outcome”。

### 3.4 history 与 state snapshot（初始化/重连/回放）

目标：让 UI 在以下场景仍能恢复一致视图：

- UI 刷新页面，需要重建消息历史。
- SSE 断线重连，需要重新对齐 state。

AG-UI 的两类机制：

- 输入侧：`RunAgentInput` 自带 `messages` 与 `state`，这允许“客户端持有历史”模式。
- 事件侧：`MESSAGES_SNAPSHOT`、`STATE_SNAPSHOT`/`STATE_DELTA` 允许“服务端推送历史/状态同步点”。

类型与事件定义：

- `RunAgentInput`：https://docs.ag-ui.com/sdk/js/core/types
- `MESSAGES_SNAPSHOT` / `STATE_SNAPSHOT` / `STATE_DELTA`：https://docs.ag-ui.com/concepts/events
- 状态同步概念与 JSON Patch：https://docs.ag-ui.com/concepts/state

#### 3.4.1 初始化（以 snapshot 为起点）

```text
UI                         FastAPI (AG-UI endpoint)         Agent/Execution
|                                  |                          |
| POST RunAgentInput               |                          |
| (threadId, runId, messages=[])   |                          |
|--------------------------------> |                          |
| <----- SSE: RUN_STARTED ---------|                          |
| <--- SSE: MESSAGES_SNAPSHOT -----|  (optional)              |
| <--- SSE: STATE_SNAPSHOT --------|  (optional)              |
| <--- SSE: (TEXT_MESSAGE_*) ------|                          |
| <----- SSE: RUN_FINISHED --------|                          |
```

#### 3.4.2 运行中增量同步（STATE_DELTA）

```text
UI                         FastAPI (AG-UI endpoint)         Agent/Execution
|                                  |                          |
| <--- SSE: STATE_DELTA -----------| apply JSON Patch         |
| <--- SSE: STATE_DELTA -----------| apply JSON Patch         |
| ...                              |                          |
```

落地建议：

- 对于“可视化进度/表单草稿/审批 proposal”等，优先用 state 并用 `STATE_DELTA` 做增量更新。
- 当 UI 检测到 patch 应用失败或状态漂移时，请求/触发一次新的 `STATE_SNAPSHOT` 作为 resync 点（最佳实践见：https://docs.ag-ui.com/concepts/state）。

---

## 4. Route 2 与 Route 1 的“对外合约层”对比（理解边界）

- Route 1：对外合约 = LangGraph Server / Agent Server API 的 threads/runs/history/stream 等资源模型。
- Route 2：对外合约 = `RunAgentInput` + `BaseEvent stream`。

两者都能满足同一基准目标，但表达方式不同：

- “history”在 Route 1 是一个明确 endpoint（thread history/state）；在 Route 2 可以通过 snapshot 事件或由 client 把历史塞进 `RunAgentInput.messages/state`。
- “interrupt”在 Route 1 可能由 Server API 的 run/interrupt 概念提供；在 Route 2 则是通过 `RUN_FINISHED(outcome="interrupt") + RunAgentInput.resume` 的事件/输入契约表达（Draft）。

---

## 5. LangGraph + FastAPI 的“对外暴露”参考（官方引用）

为了把 LangGraph graph 作为服务暴露出去，LangGraph 文档支持把 FastAPI app 作为 `langgraph.json` 的 `http.app` 挂载，并通过 `langgraph dev` 启动开发服务器。

官方文档（Custom Routes with FastAPI）：https://docs.langchain.com/langsmith/custom-routes

该文档示例展示：

- 如何创建 `FastAPI` app
- 如何在 `langgraph.json` 中配置 `http.app`
- 如何通过 `langgraph dev --no-browser` 启动

（说明：这属于 LangGraph 平台/CLI 的“把 FastAPI 合并进服务”的方式；而本仓库 demo2 直接用 `uvicorn` 启动 FastAPI，并通过 `ag_ui_langgraph.add_langgraph_fastapi_endpoint()` 增加 AG-UI endpoint。）
