# Route 2（AG-UI Events）Troubleshooting

本文档把 Route 2（AG-UI events over SSE）常见故障与排查路径固化下来。它的目标与 `docs/route1-troubleshooting.md` 一致：减少重复踩坑。

引用（官方协议定义）：

- AG-UI events：https://docs.ag-ui.com/concepts/events
- AG-UI TS SDK events/types：
  - Events：https://docs.ag-ui.com/sdk/js/core/events
  - Types（`RunAgentInput`）：https://docs.ag-ui.com/sdk/js/core/types
- Interrupts（Draft）：https://docs.ag-ui.com/drafts/interrupts

本仓库 Route 2 demo2 入口：`apps/agui_events_demo2/src/server.py`。

---

## 1) 端口占用：启动时报 address already in use

现象：

- FastAPI/uvicorn 启动失败，提示端口已被占用。

原因：

- 同一个端口已经有进程监听（常见于上次未停干净，或其它项目占用）。

解决：

- Route 2 demo2 已提供 Makefile 运维入口：`apps/agui_events_demo2/Makefile`
  - `make -C apps/agui_events_demo2 stop/status` 管理进程
  - 默认 `FORCE_STOP=1` 会安全地停止“属于本子项目”的占用进程（未知进程不杀）
- Route 1 运维入口：`apps/server_api_ui_demo1/Makefile`（同理）

---

## 2) CORS / 跨域：前端连不上 SSE

现象：

- 浏览器控制台报 CORS 错误。
- SSE 建立失败（EventSource/fetch stream 被浏览器拦截）。

原因：

- 前端域名/端口与 FastAPI 不同，且 FastAPI 未配置 CORS。

解决（策略级）：

- 同域部署：让 UI 与 FastAPI 走同一 host（最省事）。
- 反向代理：在 UI dev server 或网关层做代理，把 `/agent` 或 `/`（Route2 endpoint）代理到后端。
- FastAPI CORS：在 FastAPI 添加 CORS middleware（这需要改代码；本任务不改代码，因此这里只指出方向）。

验证点：

- 服务端是否返回 `text/event-stream`（SSE）。
- 浏览器 Network 是否看到持续打开的连接与持续的 data 片段。

---

## 3) 本机没有 ripgrep（rg）

现象：

- `rg: command not found`

原因：

- 环境未安装 ripgrep。

解决：

- Route 1 Makefile 提供 `install-rg`（macOS + Homebrew）：

```bash
make -C apps/server_api_ui_demo1 install-rg
```

---

## 4) 前端“收不到事件”或只收到一个 JSON：SSE / Accept header 不匹配

现象：

- 前端以为是 SSE，但后端返回了普通 JSON（一次性响应）。
- 或后端返回 SSE，但前端按 JSON 解析导致报错。

原因：

- 客户端未按 AG-UI 的 SSE 方式请求（例如缺少 `Accept: text/event-stream`，或使用了不支持流式的 HTTP 客户端封装）。

解决：

- 对照 AG-UI 设计：HttpAgent 支持 SSE 传输，并通过 HTTP POST 请求发送 `RunAgentInput`，再接收 `BaseEvent` 流。见：https://docs.ag-ui.com/concepts/architecture
- 对照事件格式：事件对象必须符合 `BaseEvent` + `EventType` 判别字段。见：https://docs.ag-ui.com/sdk/js/core/events

排查建议：

- 先用 `curl`/浏览器 Network 面板确认响应的 `Content-Type` 是否为 `text/event-stream`。
- 检查前端是否真的以“流”的方式消费响应。

---

## 5) 事件顺序/关联 ID 不一致：UI 渲染错乱

现象：

- 文本被拼到错误的 message bubble。
- 工具参数/结果显示在错误的 tool call 上。

原因：

- 未按 `messageId`/`toolCallId` 关联事件。
- start/content/end 的边界事件缺失或顺序错误。

解决：

- 按官方事件模型实现关联：
  - 文本：`TEXT_MESSAGE_START`/`TEXT_MESSAGE_CONTENT`/`TEXT_MESSAGE_END` 通过同一个 `messageId` 关联。见：https://docs.ag-ui.com/concepts/events
  - 工具：`TOOL_CALL_START`/`TOOL_CALL_ARGS`/`TOOL_CALL_END` 通过同一个 `toolCallId` 关联；结果用 `TOOL_CALL_RESULT`。见：https://docs.ag-ui.com/sdk/js/core/events

---

## 6) 工具不被调用：你以为有 tool calls，实际上没有

现象：

- 永远没有 `TOOL_CALL_*` 事件。
- LLM 一直用自然语言“描述自己会调用工具”，但不产生 tool call。

常见原因（从协议与本仓库 demo2 现状推断）：

- `RunAgentInput.tools` 没传（或传错 schema），agent 不知道有可用工具。见：https://docs.ag-ui.com/sdk/js/core/types
- 执行面（LangGraph graph）没有 tool node / tool binding，无法产生真实工具调用事件。
  - 若你改坏了 graph：检查 `apps/agui_events_demo2/src/agent_graph.py` 是否仍包含 `ToolNode` + `llm.bind_tools(...)`，否则不会产生 `TOOL_CALL_*` 事件。
- LLM provider/config 不支持 tool calling，或没启用对应模型参数（与具体 provider/SDK 相关）。

解决：

- 先确定“工具调用”是在执行层产生还是由适配器注入：
  - 如果是 LangGraph：需要在 graph 中加入工具节点，并把工具定义传给 LLM。
  - 如果是上层协议：需要确保 `tools` 正确出现在 `RunAgentInput`。

---

## 7) 下载问题（产物下载 / data URL）

现象：

- 后端返回了可下载内容，但前端没有下载入口。
- 跨域下载失败。

原因：

- 下载属于 UI 侧渲染策略问题：AG-UI 事件只负责传递“消息/工具结果/自定义 payload”。
- 跨域时浏览器对 `<a download>` 或 `fetch->blob` 有限制（CORS）。

解决：

- 参考 Route 1 的既有排障经验：`docs/route1-troubleshooting.md` 中记录了 data URL 与跨域下载的处理策略。
- 在 Route 2 中，建议把“下载类 payload”的传输形态明确化：
  - 通过 `TOOL_CALL_RESULT.content` 或 `CUSTOM.value` 传递 data URL/文件引用。
  - UI 侧根据 mimeType/协议统一渲染下载组件。

> 注意：这属于应用层约定，不是 AG-UI 协议强制内容。

---

## 8) interrupt / resume 不工作：schema 不匹配（Draft）

现象：

- 服务端发出 `RUN_FINISHED` 后 UI 没进入“待审批/暂停”状态。
- UI 发了 resume 请求，服务端无法继续或直接报错。

原因：

- 你实现了 interrupt/resume，但字段与 Draft 不一致。
- `threadId` 没复用；或 resume 的 `interruptId` 未回传。

正确的字段（Draft 以官方为准）：

- `RUN_FINISHED` 扩展字段：`outcome?: "success" | "interrupt"` 与 `interrupt?: { id?, reason?, payload? }`
- `RunAgentInput` 扩展字段：`resume?: { interruptId?, payload? }`
- 合同规则：resume 必须使用同一 `threadId`。

见：https://docs.ag-ui.com/drafts/interrupts

解决：

- 把前后端实现对照官方 Draft 字段逐项核对。
- 明确版本锁定：如果你要在生产使用 Draft，请固定 `ag-ui-protocol` / `ag-ui-langgraph` 版本，并为字段变更预留兼容层。

---

## 9) 环境变量缺失：LLM 启动直接报错

现象：

- 服务器启动或第一次请求时报错：缺少某个 env。

原因：

- Route 2 demo2 的 LLM 封装（`apps/agui_events_demo2/src/llms.py`）会强制要求 provider 相关环境变量存在（例如 `ZHIPU_*`），否则抛出异常。

解决：

- 在 `apps/agui_events_demo2/` 的 `.env`（或运行环境）中补齐所需变量。
- 由于本仓库约定“每个探索子项目 env 隔离”，不要假设能复用 Route 1 的 `.env`。

---

## 10) 你在追“history”，但 Route 2 不是 REST history API

现象：

- 习惯了 Route 1 的 `threads/history`，在 Route 2 找不到对应 endpoint。

解释：

- Route 2 的“历史/状态同步”主要通过两种方式实现：
  - 输入侧：在 `RunAgentInput.messages/state` 传入历史/状态；见：https://docs.ag-ui.com/sdk/js/core/types
  - 事件侧：服务端用 `MESSAGES_SNAPSHOT`、`STATE_SNAPSHOT`/`STATE_DELTA` 推送同步点；见：https://docs.ag-ui.com/concepts/events

解决：

- 在项目级别明确“历史的真相源”是谁：
  - 客户端持有历史：每次 run 都带 messages/state。
  - 服务端持有历史：连接建立时先发 snapshot。
- 两种模式可以混用，但要定义冲突处理策略（例如 snapshot 是否覆盖客户端 state）。
