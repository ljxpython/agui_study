AG-UI Events Demo (Route 2)

Dev:
  pnpm install
  pnpm dev

Backend:
  FastAPI endpoint is expected at http://localhost:8123/ (POST /, SSE).

Env:
  Copy .env.example -> .env (optional)

Notes:
  - UI uses fetch(POST) + custom SSE parser (EventSource can't POST).
  - threadId is stored in localStorage under agui:demo2:threadId.
