# Route 1 Troubleshooting（server_api_ui_demo1）

目标：把 Route 1（LangGraph Server API + ui_demo1）落地过程中遇到的问题与解决方式固化下来，避免后续探索项目重复踩坑。

适用范围：`apps/server_api_ui_demo1`，其它 `apps/<project>` 可复用相同模式。

## 1) 端口占用：启动时报 [Errno 48] address already in use

现象：
- 后端启动日志出现：
  - `ERROR: [Errno 48] error while attempting to bind on address ('0.0.0.0', 2024): [errno 48] address already in use`
- 或前端端口（3000/3010）被其它 next 进程占用，导致 `make start` 只起后端。

原因：
- 同一个端口已经有进程监听（常见于上次启动未正确 stop，或其它项目也在用同一端口）。

解决：
- 统一通过 Makefile 管理进程：
  - `make stop` / `make restart`
- Makefile 默认会用 `lsof` 查找冲突进程，并在“安全匹配命令行”时自动停止冲突进程。

## 2) 前端没启动：Next.js 参数传递错误

现象：
- `ui_demo1.log` 出现：
  - `Invalid project directory provided .../ui_demo1/-p`

原因：
- 使用了错误的参数形式：`pnpm dev -- -p 3000`
- Next 15 将 `-p` 当成目录参数。

解决：
- 改为：`pnpm dev --port <port>`

## 3) 本机没有 ripgrep（rg）

现象：
- `zsh: command not found: rg`

解决：
- 安装：`make install-rg`
- 或直接使用 Makefile 内置过滤：
  - `make backend-grep PATTERN='MCP-Server-Chart|tool'`

## 4) MCP 图表“没用”：模型说自己不是 MCP

现象：
- 对话里模型声称“我用的是 function calling，不是 MCP”，并且 UI 没图表。

原因：
- 后端是否加载 MCP tools 取决于配置。
- 如果没启用（或启动失败），模型自然不会调用 MCP tool。

解决：
- 在子项目 `.env` 中启用：
  - `ENABLE_MCP_CHART=1`
- 用日志验证 MCP server 是否启动：
  - `make backend-grep PATTERN='MCP-Server-Chart'`

## 5) 图表能显示但没有下载入口

现象：
- 图表预览可见，但无法下载。

原因：
- ui_demo1 原始逻辑只做图片预览，不提供下载入口。
- 并且对跨域 URL，浏览器可能忽略 `<a download>`。

解决：
- 在 `tool-calls-new.tsx` 的图片预览上增加“打开/下载”。
- “下载”优先走 `fetch(url)->blob->ObjectURL`，如果被 CORS 阻止则回退为新标签打开。

## 6) 点击下载变成“最大化预览”

现象：
- 点击下载按钮会触发图片最大化预览。

原因：
- 预览的点击处理绑定在外层容器上，按钮点击触发冒泡。

解决：
- 将“最大化预览”绑定到图片本身（img onClick），外层不再处理 onClick。
- 下载/打开按钮阻止默认行为并 stopPropagation。

## 7) 下载工具（download_text_file）不显示下载选项

现象：
- 后端返回 `data:text/csv;base64,...` 这类字符串，但 UI 没有下载按钮。

原因：
- UI 只识别 `data:image/*` 用于图片预览，不识别非图片 data URL。

解决：
- 在 `tool-calls-new.tsx` 中解析非图片 data URL，并渲染 `<a href=... download=...>`。

