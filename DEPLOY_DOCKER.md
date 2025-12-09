# Docker 部署操作指南

适用于仓库根目录 `/Users/bytedance/PycharmProjects/test/langsmith_try/my-ag-ui-app`。后端 LangGraph API 暴露端口 `8123`，前端 Next.js 暴露端口 `3000`。

## 前置条件
- 已安装 Docker / Docker Compose。
- 已安装 `uv`、LangGraph CLI（Python 3.13 环境）。

## 准备环境变量
1. 复制示例：
   - `cp .env.example .env`
   - `cp agent/.env.example agent/.env`
2. 在 `.env` 和 `agent/.env` 中填写真实密钥（如 `LANGSMITH_API_KEY`、`DEEPSEEK_API_KEY`、`OPENAI_API_KEY` 等）。
3. 确认 `.env` 中的 `IMAGE_NAME` 与后端镜像 tag 一致（默认 `my-langgraph:latest`）。若使用外部 Postgres/Redis，更新 `DATABASE_URI`、`REDIS_URI`。

## 构建后端镜像（LangGraph API）
```bash
cd agent
# 可选：uv sync --frozen
uv run langgraph build -t my-langgraph:latest
# 构建完回到根目录
cd ..
```

## 启动前后端（Docker Compose）
```bash
docker compose up -d --build
```
- 服务说明：
  - `langgraph-api`：后端，端口映射 `8123:8000`。
  - `frontend`：前端，端口映射 `3000:3000`（内部通过 `LANGGRAPH_DEPLOYMENT_URL=http://langgraph-api:8000` 调后端）。
  - 内置 `langgraph-redis`、`langgraph-postgres`。

## 验证
- 后端健康检查：`curl http://0.0.0.0:8123/ok` 预期 `{"ok":true}`。
- 前端访问：浏览器打开 `http://0.0.0.0:3000`。

## 日志与运维
- 查看实时日志：
  - 后端：`docker compose logs -f langgraph-api`
  - 前端：`docker compose logs -f frontend`
- 停止：`docker compose down`
- 如需清空数据卷（会删除 Postgres 数据）：`docker compose down -v`（谨慎使用）。

## 常见调整
- 更改对外端口：修改 `docker-compose.yml` 中 `ports` 映射。
- 使用外部数据库/Redis：在 `.env` 中覆盖 `DATABASE_URI`、`REDIS_URI`，确保网络可达。

## 推送后端镜像到远端（示例：Docker Hub）
若需在服务器上直接拉取镜像，可先在本地推送：
```bash
docker login
docker tag my-langgraph:latest lijiaxin8187/my-langgraph:latest
docker push lijiaxin8187/my-langgraph:latest
```
推送后，在 `.env` 或 `docker-compose.yml` 将 `IMAGE_NAME` 替换为远端镜像名（如 `lijiaxin8187/my-langgraph:latest`），服务器上即可直接拉取运行。

## 其他人拿到镜像后的部署流程（仅需镜像，无需本地构建）
1. 在目标机器准备 `.env`/`agent/.env`（可直接复制本仓库的 `.env.example` 和 `agent/.env.example`，填入密钥）。  
2. 在 `docker-compose.yml` 或 `.env` 中设置 `IMAGE_NAME=lijiaxin8187/my-langgraph:latest`（或你提供的远端镜像名）。  
3. 拉起服务：
   ```bash
   docker compose pull langgraph-api       # 可选，预拉取后端镜像
   docker compose up -d --build            # 前端仍会本地构建，后端直接用远端镜像
   ```
   如不想构建前端，可预先发布前端镜像，并在 compose 中为 `frontend` 配置 `image`（或移除 build）。
4. 验证：  
   - 后端健康：`curl http://0.0.0.0:8123/ok`  
   - 前端访问：`http://0.0.0.0:3000`
