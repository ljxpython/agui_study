# Route 2（AG-UI Events）教学 + 概览

本文档面向本仓库的 Route 2：用 AG-UI（Agent User Interaction Protocol）事件协议，通过 SSE（Server-Sent Events）把 LangGraph 的执行过程以“结构化事件流”输出给前端。

适用代码位置（本仓库现状）：

- Route 2 demo：`apps/agui_events_demo2/src/server.py`
- Route 2 graph：`apps/agui_events_demo2/src/agent_graph.py`
- Route 2 依赖声明：`apps/agui_events_demo2/pyproject.toml`

> 重要说明（避免“发明 API”）：本仓库 Route 2 demo 是一个“进程内 LangGraph + FastAPI + AG-UI SSE endpoint”的最小可运行实现，并包含：工具调用（SQL/下载）+ interrupt/resume（基于 `ag_ui_langgraph` 的 `Command(resume=...)` 机制）+ checkpoint（sqlite）。本文会把“协议层”与“本仓库 demo2 当前实现”分开描述：
> 
> - 协议层：严格依据官方 AG-UI 文档与类型定义（带引用链接）。
> - Demo2 层：只描述从 `apps/agui_events_demo2/src/server.py` 能确定的事实；对“可能由 `ag-ui-langgraph` 适配器产生的事件”只按协议解释其意义，并标注为“依赖适配器实现”。

---

## 1. Route 2 为什么存在：对齐 Route 1 基准目标

本仓库在 Route 1 中用 `ui_demo1` 对接 LangGraph Server API，验证了基准能力（chat / streaming / tool calls / interrupt / history）。见：`docs/route1-progress.md`。

Route 2 的定位是：把“对外合约层”从“某个具体后端 runtime 的 REST/SSE 形态”抽象成**标准化事件协议**，使得：

- UI 不被绑死在 LangGraph Server API（或某个 SDK 的特定数据模型）。
- 执行面（LangGraph 进程内、LangGraph Agent Server、甚至其它 agent runtime）可替换，只要能输出 AG-UI 事件。
- 工具调用、状态同步、history 初始化等都落到统一的事件语义里。

对照基准目标，Route 2 的“验收口径”应当与 Route 1 一致：

- chat：能把 user input 变为 assistant message。
- streaming：文本与工具参数可以增量输出。
- tool calls：能把 tool 的开始/参数/结束/结果结构化展示。
- interrupt：能在人类审批/缺少输入时暂停并恢复。
- history：能恢复或重放（至少在 UI 侧能重建 thread 的 messages/state）。

Route 2 的差异在于：这些能力不是通过“Server API 的特定 endpoint 组合”表达，而是通过**AG-UI events** 表达。

---

## 2. AG-UI 的核心抽象：`run(input: RunAgentInput) -> Observable<BaseEvent>`

AG-UI 的协议层把 agent 的运行抽象成：输入一次 `RunAgentInput`，输出一个 `BaseEvent` 事件流。

官方描述与示例见：

- AG-UI Core architecture（协议抽象、HttpAgent、SSE 与 binary transport）：https://docs.ag-ui.com/concepts/architecture

在该抽象下：

- “一次运行”由 `runId` 标识。
- “一次会话/线程”由 `threadId` 标识。
- 运行过程中的文本输出、工具调用、状态同步等，都通过事件流表达。

---

## 3. 事件（Events）：AG-UI 的最小必需事件与常见事件族

AG-UI 是事件驱动协议。事件类型与字段定义在官方文档中是明确的，不应在项目里随意自造。

- Concepts / Events（事件类别、模式、语义解释）：https://docs.ag-ui.com/concepts/events
- TypeScript SDK / `@ag-ui/core` / Events（枚举与 TS 类型定义，便于精确对照字段）：https://docs.ag-ui.com/sdk/js/core/events

### 3.1 最小必需事件（协议边界）

官方 Events 文档明确：一次 run 至少应有 `RunStarted`，并以 `RunFinished`（成功）或 `RunError`（失败）收尾。

- `RUN_STARTED`：标记 run 的边界与标识符（`threadId`、`runId`），可选携带 `input`（即 `RunAgentInput`）。
- `RUN_FINISHED` / `RUN_ERROR`：标记 run 完成或失败。

（引用）`RunStarted`/`RunFinished` 的字段与语义：

- Concepts / Events / RunStarted：https://docs.ag-ui.com/concepts/events
- SDK / Events / `RunStartedEvent`：https://docs.ag-ui.com/sdk/js/core/events

### 3.2 文本消息事件（TEXT_MESSAGE_*）

用于把 assistant 文本按 chunk 增量传给 UI。

- `TEXT_MESSAGE_START` → `TEXT_MESSAGE_CONTENT`（多个）→ `TEXT_MESSAGE_END`
- 或使用 `TEXT_MESSAGE_CHUNK`（由客户端展开成 start/content/end 三段；细节见 SDK 文档）：https://docs.ag-ui.com/concepts/events

### 3.3 工具调用事件（TOOL_CALL_*）

用于把 tool invocation 结构化呈现（开始、参数流、结束、结果）。

- `TOOL_CALL_START` → `TOOL_CALL_ARGS`（多个）→ `TOOL_CALL_END`
- `TOOL_CALL_RESULT`：tool 的结果（通常是一次性 payload）

字段级定义见：https://docs.ag-ui.com/sdk/js/core/events

### 3.4 状态与历史同步事件（STATE_* / MESSAGES_SNAPSHOT）

AG-UI 提供两种不同维度的“同步”：

- state：应用/agent 的共享状态（可用于 UI 可视化、审批 payload、长流程进度等）
  - `STATE_SNAPSHOT`：全量 state
  - `STATE_DELTA`：JSON Patch（RFC 6902）增量更新
- messages：会话消息历史
  - `MESSAGES_SNAPSHOT`：全量 messages

概念说明见：

- State Management（snapshot/delta、JSON Patch、最佳实践）：https://docs.ag-ui.com/concepts/state
- Events（`STATE_SNAPSHOT`/`STATE_DELTA`/`MESSAGES_SNAPSHOT` 的事件定义）：https://docs.ag-ui.com/concepts/events

### 3.5 自定义事件（CUSTOM）

当标准事件不足以覆盖业务语义时，可使用 `CUSTOM` 扩展。

- `CUSTOM` 事件在协议里是“合法扩展点”，但语义必须在项目文档中明确约定。
- 官方定义见：https://docs.ag-ui.com/concepts/events

---

## 4. `RunAgentInput`：一次运行的输入契约

在 HTTP 模式下，`RunAgentInput` 是 `POST` 请求体。

官方类型定义见：

- `RunAgentInput`（TS 类型）：https://docs.ag-ui.com/sdk/js/core/types

该类型的关键字段（按官方定义）：

- `threadId`：会话线程 ID。
- `runId`：本次运行 ID。
- `parentRunId?`：可选，表示从哪个 run 分叉/派生（便于 lineage / time-travel）。
- `state`：当前 state（类型是 `any`，但项目应建立自己的 state schema 约束）。
- `messages`：当前 messages（会话消息数组）。
- `tools`：可用 tools 列表（tool schema）。
- `context`：补充上下文条目。
- `forwardedProps`：透传字段。

### 4.1 Route 2 的关键工程点：谁生成 `threadId` / `runId`

AG-UI 协议本身不强制 `threadId` / `runId` 的生成位置，但它们必须在请求与事件中一致出现。

本仓库在 `docs/discussion-notes.md` 中讨论了控制面归档（project_id 绑定 thread/run 的审计需求）。这对应一个实践原则：

- 对外合约层（FastAPI gateway/endpoint）通常最适合生成并记录 `threadId` / `runId`（用于审计与幂等），然后把它们注入执行面。

---

## 5. SSE 传输：为什么 Route 2 选择 `text/event-stream`

AG-UI 的 `HttpAgent` 客户端支持多种传输，其中 SSE 是最通用、最容易调试的一种。

- “Standard HTTP client / HttpAgent supports SSE” 的官方说明见：https://docs.ag-ui.com/concepts/architecture

在 SSE 模式下：

- 客户端通常通过 `Accept: text/event-stream` 请求服务端流式返回事件。
- 服务端把 `BaseEvent` 逐条编码（常见做法是 JSON），并以 SSE frame 形式写入响应流。

> 说明：SSE frame 的具体格式（`event:`/`data:`/`id:`）属于传输层细节；AG-UI 关注的是“事件对象”的语义一致性。

---

## 6. 本仓库 Route 2 demo2 的落地方式（可确定事实）

本仓库的 demo2 把 Route 2 的“对外合约层”落地成一个 FastAPI endpoint（AG-UI over SSE），并把执行面落地为进程内 LangGraph（`StateGraph`）。

关键文件：

- `apps/agui_events_demo2/src/server.py`: FastAPI + SSE endpoint（`POST /agent`、`GET /agent/health`）
- `apps/agui_events_demo2/src/agent_graph.py`: LangGraph graph（SQL tools + download tool + interrupt gate）

`apps/agui_events_demo2/src/server.py` 的关键事实：

1. 使用 `AsyncSqliteSaver` 作为 checkpointer（sqlite），因为 `ag_ui_langgraph` 在每次 run 开始/结束会调用 `graph.aget_state(...)`（需要 checkpointer 支持 async）。
2. 在 startup 生命周期内创建 checkpointer 与 graph/agent，并在 shutdown 时关闭。
3. 直接实现 endpoint（不依赖 `add_langgraph_fastapi_endpoint`）：

- `POST /agent`: 入参 `RunAgentInput`，出参 SSE（通过 `EventEncoder` 编码事件）
- `GET /agent/health`: 健康检查

这意味着：

- Route 2 的对外契约 = `RunAgentInput`（输入） + `BaseEvent` 事件流（输出）。
- LangGraph stream/event 到 AG-UI events 的映射逻辑由 `ag-ui-langgraph` 的 `LangGraphAgent` 提供。
---

## 7. 如何运行（包含 Makefile 运维入口的说明）

Route 2 demo2 已提供完整 Makefile 运维入口：`apps/agui_events_demo2/Makefile`。

### 7.1 一键启动/停止

```bash
uv sync
make -C apps/agui_events_demo2 start
make -C apps/agui_events_demo2 status
make -C apps/agui_events_demo2 logs
make -C apps/agui_events_demo2 tail
make -C apps/agui_events_demo2 stop
```

默认端口：

- 后端：`http://localhost:8123`（`POST /agent`）
- 前端：`http://localhost:8124`

### 7.2 curl 验证（SSE）

注意：`RunAgentInput` 在 `ag-ui-protocol` 的 Python 版本里字段是必填（`state/tools/context/forwarded_props` 不能缺）。例如：

```bash
curl -N -H 'Accept: text/event-stream' -H 'Content-Type: application/json' \
  -X POST http://localhost:8123/agent \
  -d '{"thread_id":"t_demo","run_id":"r1","state":{},"messages":[{"id":"m1","role":"user","content":"List tables"}],"tools":[],"context":[],"forwarded_props":{}}'
```

---

## 8. 术语表（Glossary）

- `AG-UI`：Agent User Interaction Protocol，一个以事件流为核心的 agent↔UI 交互协议。官方入口：https://docs.ag-ui.com/
- `BaseEvent`：所有事件的基类结构，至少包含 `type`（事件类型判别字段）。见：https://docs.ag-ui.com/sdk/js/core/events
- `EventType`：事件类型枚举（如 `RUN_STARTED`、`TEXT_MESSAGE_CONTENT` 等）。见：https://docs.ag-ui.com/sdk/js/core/events
- `RunAgentInput`：运行 agent 的输入契约；HTTP 模式下是 `POST` body。见：https://docs.ag-ui.com/sdk/js/core/types
- `threadId`：会话线程标识；用于把多次 run 关联到同一会话。
- `runId`：一次运行标识；用于把一次事件流的边界划清。
- `SSE`（Server-Sent Events）：HTTP 单向流式传输机制，常用 `text/event-stream`。
- `STATE_SNAPSHOT`：全量 state 同步事件。见：https://docs.ag-ui.com/concepts/state
- `STATE_DELTA`：基于 JSON Patch（RFC 6902）的 state 增量同步事件。见：https://docs.ag-ui.com/concepts/state
- `MESSAGES_SNAPSHOT`：全量 messages 历史快照事件。见：https://docs.ag-ui.com/concepts/events
- `interrupt` / `resume`：用于“人类介入暂停/恢复”的运行生命周期扩展（当前为 Draft）。见：https://docs.ag-ui.com/drafts/interrupts
