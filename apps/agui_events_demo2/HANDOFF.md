# Route2 (apps/agui_events_demo2) 交接文档

目标读者：接手该探索/实现的工程师（无需阅读本对话上下文）。

## 0. TL;DR

我们在 Route2 demo2 里把「同 thread 多次 run 卡住」修复完成，并把 MCP chart tools（Option 1）按 startup async 初始化方式重新启用并跑通。

当前已验证：
- `POST /agent` 的 SSE 流能触发 `generate_bar_chart` 等 MCP 工具调用
- SSE 能返回 `TOOL_CALL_RESULT`（含 chart URL）
- run 能正常结束为 `RUN_FINISHED`（避免了模型重复调用图表工具导致的 `RUN_ERROR`）
- `ui_demo2` 前端能 `pnpm build` 成功

如果后续要继续：建议围绕「更通用的图表请求、工具参数校验、更鲁棒的 thread_id/configurable 处理、以及 end-to-end 的自动化测试」继续推进。

---

## 1. 背景与目标

Route2 demo2 的定位：
- FastAPI 自己实现 `POST /agent` SSE endpoint（不依赖 `add_langgraph_fastapi_endpoint`）
- 使用 `ag_ui_langgraph.LangGraphAgent` 将 LangGraph stream events 映射成 AG-UI events
- 使用 `AsyncSqliteSaver` 做 checkpointer，以支持 async `aget_state` 等能力

本阶段探索/目标：
1) 修复同一 thread 连续多次 run 的可重入性问题（历史上第 2 次 run 会卡住/报错）
2) 重新启用 MCP chart tools（`npx -y @antv/mcp-server-chart`）并验证：
   - 模型能发起 tool call
   - 后端能执行 MCP tool
   - SSE 能给出 tool 结果 URL
   - run 能正常 `RUN_FINISHED`

---

## 2. 已经做了什么（按问题线索）

### 2.1 同 thread 多次 run 的稳定性

该部分已完成（细节在本仓库已有实现与日志基础上推进），当前重点交接的是 MCP chart tools 的启用与稳定性。

### 2.2 MCP chart tools 重新启用（Option 1）

关键点：MCP tools 不能在 import-time 同步初始化（避免 `asyncio.run()` 等），而是要在 FastAPI startup 生命周期里 async 初始化，并注入 graph。

落地方式：
- `apps/agui_events_demo2/src/server.py` startup 中：
  - 创建/进入 `AsyncSqliteSaver`
  - async 加载 MCP tools（`_load_mcp_tools()`）
  - `build_graph(checkpointer=_checkpointer, mcp_tools=mcp_tools)`
  - 用 `LangGraphAgent(name="agent", graph=graph)` 暴露给 `/agent`

### 2.3 修复：图表工具偶发重复调用导致 RUN_ERROR

现象：
- 模型第一次 `generate_*_chart` 调用成功并返回 URL
- 但 graph 会继续回到 model 节点，模型有概率再次发起同名 tool call，且经常参数为空 `{}` 或 `{"data":""}`
- MCP server 会返回 `-32602` 参数校验错误，最终 run 以 `RUN_ERROR` 结束

修复策略（最小改动）：
- 图表类 MCP tool 一旦执行成功（ToolNode 产出 `ToolMessage` 且 name 属于 MCP tools），直接结束 graph（`END`），不给模型第二次机会。

实现位置：
- `apps/agui_events_demo2/src/agent_graph.py`
  - 增加 `should_continue_after_tools(state)`
  - 图边由原来的 `tools -> model` 改为 conditional：
    - 若最后消息是 `ToolMessage` 且 `name in mcp_names`：`END`
    - 否则：回到 `model`

---

## 3. 当前代码结构（接手者快速定位）

### 3.1 后端入口

- `apps/agui_events_demo2/src/server.py`
  - `@app.on_event("startup")`: 初始化 checkpointer + MCP tools + graph + agent
  - `POST /agent`: SSE 输出（`StreamingResponse`），核心是 `async for event in agent.run(input_data)`

### 3.2 LangGraph 构建

- `apps/agui_events_demo2/src/agent_graph.py`
  - `build_graph(checkpointer, mcp_tools=None)`
  - 节点：
    - `model`: LLM 产出 AIMessage（可能带 tool_calls）
    - `review`: 仅对 `sql_db_query` 做 interrupt 审批门控
    - `tools`: `ToolNode(tools)` 执行 tool calls，产出 `ToolMessage`
  - 路由（核心）：
    - `model -> review`（只要有 tool_calls 就进入 review；SQL 会被 gate，其它 tool calls 不处理）
    - `review -> tools` 或 `review -> model`
    - `tools -> END`（若 MCP tool 执行过）或 `tools -> model`

---

## 4. 如何运行与验证（命令级，复制即可）

### 4.1 启动/停止后端（启用 MCP）

在仓库根目录：

```bash
make -C apps/agui_events_demo2 backend-stop
make -C apps/agui_events_demo2 backend-start ENABLE_MCP_CHART=1
```

默认端口：`http://localhost:8123`

### 4.2 用 curl 触发图表工具（SSE）

```bash
curl -s --max-time 180 -N \
  -H 'Accept: text/event-stream' \
  -H 'Content-Type: application/json' \
  -X POST http://localhost:8123/agent \
  -d '{
    "threadId":"t_mcp_test",
    "runId":"r1",
    "parentRunId":null,
    "state":{},
    "messages":[{
      "id":"m1",
      "role":"user",
      "content":"Use generate_bar_chart with data [{\"category\":\"A\",\"value\":1},{\"category\":\"B\",\"value\":2}]. Only return the chart URL."
    }],
    "tools":[],
    "context":[],
    "forwardedProps":{}
  }'
```

期望 SSE 关键事件：
- `TOOL_CALL_START`（`toolCallName=generate_bar_chart`）
- `TOOL_CALL_RESULT`（content 内含 URL）
- `RUN_FINISHED`

（我们已验证一次成功返回 URL：
`https://mdn.alipayobjects.com/one_clip/afts/img/FY_fRYCjB18AAAAAQeAAAAgAoEACAQFr/original`
并且最终 `RUN_FINISHED`。）

### 4.3 构建前端

`Makefile` 没有单独 build target；直接在前端目录执行：

```bash
pnpm -C apps/agui_events_demo2/ui_demo2 build
```

期望：vite build 成功。

### 4.4 停止后端

```bash
make -C apps/agui_events_demo2 backend-stop
```

---

## 5. 已知问题与风险点

1) 模型对 tool 调用参数的鲁棒性
- 即使 system prompt 强制“只调用一次”，模型仍可能生成重复/空参数 tool call。
- 目前通过 graph 在 MCP tool 执行后直接 `END` 来规避二次调用。
- 风险：如果未来希望「工具执行后还要再让模型总结/解释」，需要更精细的策略（例如：
  - 先执行 tool
  - 将 tool 结果转成可控的 human message/ai message
  - 再让模型输出最终回答，但禁止再次 tool call）

2) checkpointer thread_id/configurable
- 历史上见过缺少 `configurable.thread_id` 会触发 checkpointer 报错。
- 当前 `POST /agent` 入参是 AG-UI 的 `RunAgentInput`，一般 UI 会传 `threadId`。
- 如果接手者看到 `Checkpointer requires ... thread_id`，优先检查 payload 是否正确传了 `threadId`。

3) RAW 事件 JSON safe
- 曾遇到 `sqlite3.Connection` 在事件序列化时 deepcopy/pickle 崩溃。
- Route2 当前在 `apps/agui_events_demo2/src/server.py` 做了 make_json_safe 的兼容补丁。
- 风险：这是 monkeypatch，未来升级 `ag_ui_langgraph` 可能需要重新验证。

---

## 6. 下一步建议（按优先级）

1) 补齐“图表请求非点名工具”的默认行为
- 目前对点名工具（例如 `generate_bar_chart`）路径已跑通。
- 对只说“画个图/可视化”的场景，模型可能选错工具或不给 data。
- 建议：
  - 引入更严格的数据准备步骤（先用 SQL 工具取数，再映射成 MCP 需要的数组）
  - 或在模型节点内对 `data` 做结构化提取/校验，必要时生成澄清问题。

2) end-to-end 自动化验证
- 目前验证主要靠手工 curl + 观察 SSE。
- 建议增加一个最小的脚本/测试（不引入新依赖的前提下）来：
  - 启动后端（或复用已启动）
  - 发起 SSE
  - 断言出现 TOOL_CALL_RESULT + RUN_FINISHED

3) 对 “工具执行后还要输出最终回答” 的体验优化
- 当前图表工具执行后 graph 直接 END，会导致没有额外 assistant 总结。
- 如果产品希望：返回 URL + 一句说明，可考虑：
  - tools 后新增一个 `finalize` 节点，仅在 tool 是 MCP 时运行一次
  - finalize 使用一个不会再 bind tools 的 llm，输出最终文本

---

## 7. 交接���单（接手者自检）

- [ ] `make -C apps/agui_events_demo2 backend-start ENABLE_MCP_CHART=1` 能启动
- [ ] curl SSE 能出现 `TOOL_CALL_RESULT`（包含 URL）并 `RUN_FINISHED`
- [ ] `pnpm -C apps/agui_events_demo2/ui_demo2 build` 通过
- [ ] 如调整 graph 路由，确保 SQL interrupt/resume 路径不回归（`review_node` 逻辑仍生效）

---

## 8. 关键文件索引

- `apps/agui_events_demo2/src/server.py`：FastAPI startup + `/agent` SSE
- `apps/agui_events_demo2/src/agent_graph.py`：LangGraph 构建、MCP tool 终止路由
- `apps/agui_events_demo2/ui_demo2/src/App.tsx`：前端 SSE 事件显示/调试（可用来观察 tool events）
- `docs/route2-agui-overview.md`：Route2 总览（如果接手者需要理解整体架构）
