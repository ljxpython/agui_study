# Route2 交接文档（agui_events_demo2）

目标读者：接手该探索/实现的工程师（无需阅读本对话上下文）。

## 0. TL;DR

Route2 的核心是：FastAPI + LangGraph + `ag_ui_langgraph.LangGraphAgent`，对外提供 `POST /agent` SSE（AG-UI events 协议）。

本轮已经完成：
- 修复同一 `threadId` 连续多次 run 的可重入性问题（历史上第 2 次 run 会卡住/报错）
- 重新启用 MCP chart tools（Option 1），并验证 end-to-end 可用
- 修复 MCP 图表工具偶发重复调用导致 `RUN_ERROR`：工具执行后直接 `END`，保证 `RUN_FINISHED`
- `apps/agui_events_demo2/ui_demo2` 前端 `pnpm build` 通过

后续建议的继续方向：
- 更通用的“用户只说要图表/可视化”的数据准备与参数校验
- 把 curl 手工验证变成可重复的 E2E 自动化
- 如果产品需要“返回 URL + 一句总结”，增加 finalize 节点但禁止再次 tool call

---

## 1. 背景与目标

Route2 demo2 的定位：
- FastAPI 自己实现 `POST /agent` SSE endpoint（不依赖 `add_langgraph_fastapi_endpoint`）
- 使用 `ag_ui_langgraph.LangGraphAgent` 将 LangGraph stream events 映射成 AG-UI events
- 使用 `AsyncSqliteSaver` 作为 checkpointer，支持 async `aget_state` 等（`ag_ui_langgraph` run 流程会用到）

本阶段探索/目标：
1) 修复同一 thread 连续多次 run 的可重入性问题
2) 重新启用 MCP chart tools（`npx -y @antv/mcp-server-chart`）并验证：
   - 模型能发起 tool call
   - 后端能执行 MCP tool
   - SSE 能给出 tool 结果 URL
   - run 能正常 `RUN_FINISHED`

---

## 2. 已完成工作（可审计）

### 2.1 MCP chart tools：按 startup async 初始化重新启用

关键点：MCP tools 不能在 import-time 同步初始化（避免 `asyncio.run()`/事件循环冲突），必须在 FastAPI startup 生命周期内 async 初始化，并注入 graph。

落地位置：
- `apps/agui_events_demo2/src/server.py`
  - `@app.on_event("startup")`：
    - 创建/进入 `AsyncSqliteSaver`
    - async 加载 MCP tools（`_load_mcp_tools()`）
    - `build_graph(checkpointer=_checkpointer, mcp_tools=mcp_tools)`
    - `_agent = LangGraphAgent(name="agent", graph=graph)`

### 2.2 修复：图表工具偶发重复调用导致 RUN_ERROR

现象：
- 第一次 `generate_*_chart` 调用成功返回 URL
- 由于 graph 原本 `tools -> model` 无条件回环，模型有概率再次发起同名 tool call，且经常 args 为空 `{}`
- MCP server 校验失败（常见 `-32602`），run 最终变成 `RUN_ERROR`

最小修复策略：
- 只要 `ToolNode` 刚执行的是 MCP tool（ToolMessage 的 `name` 属于 MCP tools 列表），直接 `END`。

落地位置：
- `apps/agui_events_demo2/src/agent_graph.py`
  - 新增 `should_continue_after_tools(state)`
  - 将原来的 `builder.add_edge("tools", "model")` 改为 conditional edge：
    - MCP tool：`END`
    - 否则：回到 `model`

---

## 3. 当前架构与关键路径（接手者快速定位）

### 3.1 后端入口

- `apps/agui_events_demo2/src/server.py`
  - `POST /agent`：SSE 输出（`StreamingResponse`）
  - 核心循环：`async for event in agent.run(input_data)`，将事件编码输出

### 3.2 LangGraph 构建

- `apps/agui_events_demo2/src/agent_graph.py`
  - `build_graph(checkpointer, mcp_tools=None)`
  - 节点：
    - `model`：LLM 产生 AIMessage（可能包含 `tool_calls`）
    - `review`：只对 `sql_db_query` 做 interrupt 审批门控（Accept/Edit/Ignore/Response）
    - `tools`：`ToolNode(tools)` 执行 tool calls，产出 `ToolMessage`
  - 路由：
    - `START -> model`
    - `model -> review`（只要有 tool_calls 都会进 review；SQL 会被 gate，非 SQL tool call 不会被 review_node 改写）
    - `review -> tools` 或 `review -> model`
    - `tools -> END`（MCP tool）或 `tools -> model`

---

## 4. 如何运行与验证（命令级，复制即可）

### 4.1 启动/停止后端（启用 MCP）

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

已验证可返回 URL 示例：
- `https://mdn.alipayobjects.com/one_clip/afts/img/FY_fRYCjB18AAAAAQeAAAAgAoEACAQFr/original`

### 4.3 构建前端

```bash
pnpm -C apps/agui_events_demo2/ui_demo2 build
```

### 4.4 停止后端

```bash
make -C apps/agui_events_demo2 backend-stop
```

---

## 5. 已知问题与风险点

1) 模型 tool 参数不稳
- prompt 约束不足以完全避免重复/空参数 tool call。
- 当前用 graph 路由硬约束（MCP tool 执行后直接 END）规避。
- 如果未来要“工具后再总结”，需要单独的 finalize 节点并禁用 tools。

2) checkpointer thread_id/configurable
- 曾出现缺少 `configurable.thread_id` 导致 checkpointer 报错。
- 正常情况下 UI 会传 `threadId`；若遇到报错先检查请求体。

3) RAW 事件 JSON safe（历史坑）
- 曾遇到 `sqlite3.Connection` 在事件序列化时 deepcopy/pickle 崩溃。
- 当前 Route2 在 `apps/agui_events_demo2/src/server.py` 做了 make_json_safe 兼容补丁（未来升级依赖需回归验证）。

---

## 6. 下一步建议（建议接手者按优先级推进）

1) 非点名图表请求的“取数 + 组织 data”流程
- 现在点名工具 + 给 data 的路径已跑通。
- 只说“画个图/可视化”的需求，需要：先 SQL 取数、整理成 `[{...}]` 再调用 MCP tool。

2) 增加可重复的 E2E 验证
- 把 curl 手工验证变成脚本/测试：断言 `TOOL_CALL_RESULT` + `RUN_FINISHED`。

3) 产品体验：图表 URL + 一句总结
- 目前 MCP tool 后直接 END，会没有 assistant 最终总结。
- 可考虑 tools 后加 `finalize` 节点（不 bind tools 的 llm）输出说明，并保证不会再次触发 tool call。

---

## 7. 接手者自检清单

- [ ] `make -C apps/agui_events_demo2 backend-start ENABLE_MCP_CHART=1` 能启动
- [ ] curl SSE 能出现 `TOOL_CALL_RESULT`（包含 URL）并 `RUN_FINISHED`
- [ ] `pnpm -C apps/agui_events_demo2/ui_demo2 build` 通过
- [ ] SQL interrupt/resume 路径不回归（`review_node` 仍只 gate `sql_db_query`）

---

## 8. 关键文件索引

- `apps/agui_events_demo2/src/server.py`：FastAPI startup + `/agent` SSE
- `apps/agui_events_demo2/src/agent_graph.py`：LangGraph 构建、tools 后终止路由
- `apps/agui_events_demo2/ui_demo2/src/App.tsx`：前端 SSE 事件显示（便于观察 tool events）
- `docs/route2-agui-overview.md`：Route2 总览
- `docs/route2-agui-architecture.md`：Route2 架构说明
- `docs/route2-agui-troubleshooting.md`：Route2 常见问题排查
