# server-api-ui-demo1 (Route 1)

目标：在本目录内探索“官方路线 1（LangGraph Server / Agent Server API）”，并让 `ui_demo1` 以不改协议的方式直连。

本探索线的基准用例：Chinook SQLite 上的 SQL 助手（只读查询），并在执行 `sql_db_query` 之前触发一次 Human-in-the-loop 的审批中断（ui_demo1 Agent Inbox）。

## 1. 目录说明

- `langgraph.json` / `graph.json`: graph_id -> `./src/agent.py:agent` 的映射
- `start_server.py`: 启动 LangGraph Server（inmem runtime）
- `src/agent.py`: 基准 agent（SQL + download_text_file + interrupt/approve）
- `src/llms.py`: 智谱（glm-4.7）OpenAI-compatible 封装
- `data/Chinook.db`: 基准数据库
- `ui_demo1/`: 前端 UI（从仓库根目录复制进来）

## 2. 环境变量

后端：复制本目录的 `.env.example` 为 `.env` 并填写 `ZHIPU_API_KEY`。

说明：`src/llms.py` 会将 `ZHIPU_API_KEY` 镜像到 `OPENAI_API_KEY`，以兼容 `langchain-openai` 某些路径仍读取 `OPENAI_API_KEY` 的情况。

前端：参考 `ui_demo1/.env.example`，最少需要：

- `NEXT_PUBLIC_API_URL=http://localhost:2024`
- `NEXT_PUBLIC_ASSISTANT_ID=agent`

## 3. 启动（后端/前端）

在本子项目目录 `apps/server_api_ui_demo1` 内使用 Makefile 管理。

- 命令说明：`make help`
- 常见问题排查：`docs/route1-troubleshooting.md`

```bash
# 安装后端依赖
uv sync

# 查看命令
make help

# 启动后端 + 前端
make start

# 仅启动后端
make backend-start

# 仅启动前端
make frontend-start

# 查看状态
make status

# 查看日志
make logs

# 实时 tail
make tail

# 停止（前端+后端）
make stop

# 常用：单独停止
make backend-stop
make frontend-stop
```

## 4. 验证（curl）

### 4.1 触发中断（执行 sql_db_query 前审批）

```bash
THREAD_ID=$(curl -s -X POST http://localhost:2024/threads \
  -H 'Content-Type: application/json' \
  -d '{}' | python3 -c 'import sys, json; print(json.load(sys.stdin)["thread_id"])')

echo "thread=$THREAD_ID"

# 触发一次 run（SSE），stream_mode 必须包含 updates 才能看到 __interrupt__
curl -N -s -X POST "http://localhost:2024/threads/$THREAD_ID/runs/stream" \
  -H 'Content-Type: application/json' \
  -d '{
    "assistant_id": "agent",
    "input": {"messages": [{"role": "user", "content": "查询 Track 表里时长最长的 5 首歌，返回 Name 和 Milliseconds。"}]},
    "stream_mode": ["updates"],
    "stream_resumable": true
  }'

# 此时线程应处于 interrupted
curl -s "http://localhost:2024/threads/$THREAD_ID" | python3 -c 'import sys, json; t=json.load(sys.stdin); print("status=", t.get("status")); print("interrupts=", bool(t.get("interrupts")));'
```

### 4.2 resume: accept（继续执行工具并产出 SQL 结果）

```bash
curl -N -s -X POST "http://localhost:2024/threads/$THREAD_ID/runs/stream" \
  -H 'Content-Type: application/json' \
  -d '{
    "assistant_id": "agent",
    "input": {},
    "command": {"resume": [{"type": "accept", "args": null}]},
    "stream_mode": ["updates"],
    "stream_resumable": true
  }'

# 验证 messages 里出现 sql_db_query 的 tool message
curl -s "http://localhost:2024/threads/$THREAD_ID" | python3 -c 'import sys, json; t=json.load(sys.stdin); msgs=(t.get("values") or {}).get("messages") or []; print("has_sql_db_query_tool=", any(m.get("type")=="tool" and m.get("name")=="sql_db_query" for m in msgs));'
```

### 4.3 threads/history

```bash
curl -s "http://localhost:2024/threads/$THREAD_ID/history" | python3 -c 'import sys, json; h=json.load(sys.stdin); last=h[-1] if isinstance(h, list) and h else {}; msgs=(last.get("values") or {}).get("messages") or []; print("history_has_sql_db_query_tool=", any(m.get("type")=="tool" and m.get("name")=="sql_db_query" for m in msgs));'
```

## 5. 启动（前端 ui_demo1）

```bash
cd ui_demo1
pnpm install
pnpm dev
```

打开页面后，确保右上角 Settings 里 `API URL` 指向 `http://localhost:2024`，`Assistant ID` 为 `agent`。

## 6. 仍需你手测项（UI 侧）

- `ui_demo1` 是否能显示 Agent Inbox 中断卡片（Accept/Edit/Ignore/Response）
- Accept：能否继续执行并渲染 SQL 工具结果
- Edit：修改 query 后能否按新的 args 执行并返回结果
- Ignore：能否跳过本次执行并让模型重新规划
- Response：输入自然语言反馈后，模型是否能依据反馈重新规划

