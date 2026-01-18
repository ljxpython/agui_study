SHELL := /bin/bash

# Allow `make -C apps/server_api_ui_demo1 ...`
ROOT_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))

-include $(ROOT_DIR)/.env
export

PORT ?= 2024
API_URL ?= http://localhost:$(PORT)
ASSISTANT_ID ?= agent

# Default to stopping conflicting processes on ports (safe: only if command matches this project).
FORCE_STOP ?= 1

BACKEND_PY ?= $(ROOT_DIR)/.venv/bin/python
BACKEND_PID ?= $(ROOT_DIR)/server.pid
BACKEND_LOG ?= $(ROOT_DIR)/server.log

FRONTEND_DIR ?= $(ROOT_DIR)/ui_demo1
FRONTEND_PID ?= $(ROOT_DIR)/ui_demo1.pid
FRONTEND_LOG ?= $(ROOT_DIR)/ui_demo1.log
FRONTEND_PORT ?= 3010

BACKEND_PORT := $(PORT)

NEXT_PUBLIC_API_URL ?= $(API_URL)
NEXT_PUBLIC_ASSISTANT_ID ?= $(ASSISTANT_ID)

.PHONY: help
help:
	@echo "Usage: make <target> [VAR=val...]"
	@echo ""
	@echo "Common targets:"
	@echo "  start            Start backend + frontend"
	@echo "  stop             Stop backend + frontend"
	@echo "  restart          Restart backend + frontend"
	@echo "  status           Show backend + frontend status"
	@echo "  logs             Show last 200 lines (backend+frontend)"
	@echo "  tail             tail -f logs (backend+frontend)"
	@echo ""
	@echo "Backend targets:"
	@echo "  backend-start    Start backend only"
	@echo "  backend-stop     Stop backend only"
	@echo "  backend-status   Backend status"
	@echo "  backend-logs     Show backend logs"
	@echo "  backend-tail     tail -f backend logs"
	@echo "  backend-grep     Grep backend logs (PATTERN=...)"
	@echo ""
	@echo "Frontend targets:"
	@echo "  frontend-start   Start frontend only"
	@echo "  frontend-stop    Stop frontend only"
	@echo "  frontend-status  Frontend status"
	@echo "  frontend-logs    Show frontend logs"
	@echo "  frontend-tail    tail -f frontend logs"
	@echo ""
	@echo "Tools:"
	@echo "  install-rg       Install ripgrep (rg) via Homebrew (macOS)"
	@echo ""
	@echo "Variables:"
	@echo "  PORT=2024                Backend port"
	@echo "  FRONTEND_PORT=3010       Frontend port"
	@echo "  FORCE_STOP=1             Auto-stop conflicting processes on ports (safe mode, default)"
	@echo "  PATTERN='...'            For backend-grep"

.PHONY: start stop restart status logs tail
start: backend-start frontend-start
stop: frontend-stop backend-stop
restart: stop start
status: backend-status frontend-status
logs: backend-logs frontend-logs

tail:
	@bash -lc 'set -euo pipefail; touch "$(BACKEND_LOG)" "$(FRONTEND_LOG)"; \
	echo "==> backend: $(BACKEND_LOG)"; tail -f "$(BACKEND_LOG)" & \
	echo "==> frontend: $(FRONTEND_LOG)"; tail -f "$(FRONTEND_LOG)" & \
	wait'

.PHONY: backend-start backend-stop backend-status backend-logs backend-tail
backend-start:
	@if [[ ! -x "$(BACKEND_PY)" ]]; then \
		echo "missing venv python: $(BACKEND_PY)"; \
		echo "run: uv sync"; \
		exit 1; \
	fi
	@existing="$$(lsof -n -iTCP:$(BACKEND_PORT) -sTCP:LISTEN -t 2>/dev/null || true)"; \
	if [[ -n "$$existing" ]]; then \
		if [[ "$(FORCE_STOP)" == "1" ]]; then \
			cmdline="$$(ps -p "$$existing" -o command= 2>/dev/null || true)"; \
			case "$$cmdline" in \
				*"$(ROOT_DIR)/start_server.py"*) \
					echo "stopping existing backend on port $(BACKEND_PORT) (pid=$$existing)"; \
					kill "$$existing" 2>/dev/null || true; \
					for _ in {1..30}; do if kill -0 "$$existing" 2>/dev/null; then sleep 0.2; else break; fi; done; \
					;; \
				*) \
					echo "port $(BACKEND_PORT) already in use (pid=$$existing)"; \
					echo "refuse to stop unknown process: $$cmdline"; \
					exit 1; \
			esac; \
		else \
			echo "port $(BACKEND_PORT) already in use (pid=$$existing)"; \
			echo "run: make backend-stop  (or FORCE_STOP=1 backend-start)"; \
			exit 1; \
		fi; \
	fi
	@nohup bash -lc 'cd "$(ROOT_DIR)" && exec "$(BACKEND_PY)" "$(ROOT_DIR)/start_server.py"' >>"$(BACKEND_LOG)" 2>&1 & echo $$! >"$(BACKEND_PID)"
	@pid="$$(cat "$(BACKEND_PID)" 2>/dev/null || true)"; \
	if [[ -z "$$pid" ]]; then echo "backend failed to write pid file: $(BACKEND_PID)"; exit 1; fi
	@for _ in {1..30}; do \
		code="$$(curl -s -o /dev/null -w "%{http_code}" "$(API_URL)/info" || true)"; \
		if [[ "$$code" == "200" ]]; then break; fi; \
		sleep 0.5; \
	done; \
	code="$$(curl -s -o /dev/null -w "%{http_code}" "$(API_URL)/info" || true)"; \
	if [[ "$$code" != "200" ]]; then \
		echo "backend started but /info not ready (http=$$code). check logs: $(BACKEND_LOG)"; \
		exit 1; \
	fi
	@echo "backend started (pid=$$(cat "$(BACKEND_PID)"), url=$(API_URL))"

backend-stop:
	@pid=""; \
	if [[ -f "$(BACKEND_PID)" ]]; then pid="$$(cat "$(BACKEND_PID)" 2>/dev/null || true)"; fi; \
	if [[ -n "$$pid" ]] && ! kill -0 "$$pid" 2>/dev/null; then pid=""; fi; \
	if [[ -z "$$pid" ]]; then pid="$$(lsof -n -iTCP:$(PORT) -sTCP:LISTEN -t 2>/dev/null || true)"; fi; \
	if [[ -z "$$pid" ]]; then rm -f "$(BACKEND_PID)"; echo "backend not running"; exit 0; fi; \
	kill "$$pid" 2>/dev/null || true; \
	for _ in {1..30}; do if kill -0 "$$pid" 2>/dev/null; then sleep 0.2; else break; fi; done; \
	if kill -0 "$$pid" 2>/dev/null; then kill -9 "$$pid" 2>/dev/null || true; fi; \
	rm -f "$(BACKEND_PID)"; \
	echo "backend stopped (pid=$$pid)"

backend-status:
	@pid=""; \
	if [[ -f "$(BACKEND_PID)" ]]; then pid="$$(cat "$(BACKEND_PID)" 2>/dev/null || true)"; fi; \
	if [[ -n "$$pid" ]] && kill -0 "$$pid" 2>/dev/null; then echo "backend running (pid=$$pid, port=$(PORT))"; exit 0; fi; \
	pid="$$(lsof -n -iTCP:$(PORT) -sTCP:LISTEN -t 2>/dev/null || true)"; \
	if [[ -n "$$pid" ]]; then echo "backend running (pid=$$pid, port=$(PORT))"; else echo "backend stopped (port=$(PORT))"; fi

backend-logs:
	@touch "$(BACKEND_LOG)"
	@echo "==> backend: $(BACKEND_LOG)"
	@tail -n 200 "$(BACKEND_LOG)"

.PHONY: backend-grep
backend-grep:
	@touch "$(BACKEND_LOG)"
	@pattern="$(PATTERN)"; \
	if [[ -z "$$pattern" ]]; then echo "usage: make backend-grep PATTERN=..."; exit 1; fi
	@python3 -c 'import re, pathlib; rx=re.compile(r"$(PATTERN)"); lines=pathlib.Path("$(BACKEND_LOG)").read_text(errors="ignore").splitlines(); [print(f"{i}:{l}") for i,l in enumerate(lines,1) if rx.search(l)]'

backend-tail:
	@touch "$(BACKEND_LOG)"
	@tail -f "$(BACKEND_LOG)"

.PHONY: frontend-start frontend-stop frontend-status frontend-logs frontend-tail
frontend-start:
	@if ! command -v pnpm >/dev/null 2>&1; then echo "pnpm not found"; exit 1; fi
	@if [[ ! -d "$(FRONTEND_DIR)" ]]; then echo "missing frontend dir: $(FRONTEND_DIR)"; exit 1; fi
	@pid=""; \
	if [[ -f "$(FRONTEND_PID)" ]]; then pid="$$(cat "$(FRONTEND_PID)" 2>/dev/null || true)"; fi; \
	if [[ -n "$$pid" ]] && ! kill -0 "$$pid" 2>/dev/null; then pid=""; fi; \
	if [[ -n "$$pid" ]]; then echo "frontend already running (pid=$$pid)"; exit 0; fi
	@existing="$$(lsof -n -iTCP:$(FRONTEND_PORT) -sTCP:LISTEN -t 2>/dev/null || true)"; \
	if [[ -n "$$existing" ]]; then \
		if [[ "$(FORCE_STOP)" == "1" ]]; then \
			cmdline="$$(ps -p "$$existing" -o command= 2>/dev/null || true)"; \
			case "$$cmdline" in \
				*"next-server"*|*"next dev"*|*"$(FRONTEND_DIR)"*) \
					echo "stopping existing frontend on port $(FRONTEND_PORT) (pid=$$existing)"; \
					kill "$$existing" 2>/dev/null || true; \
					for _ in {1..30}; do if kill -0 "$$existing" 2>/dev/null; then sleep 0.2; else break; fi; done; \
					;; \
				*) \
					echo "port $(FRONTEND_PORT) already in use (pid=$$existing)"; \
					echo "refuse to stop unknown process: $$cmdline"; \
					exit 1; \
			esac; \
		else \
			echo "port $(FRONTEND_PORT) already in use (pid=$$existing)"; \
			echo "run: make frontend-stop  (or FORCE_STOP=1 frontend-start)"; \
			exit 1; \
		fi; \
	fi
	@nohup bash -lc 'cd "$(FRONTEND_DIR)" && NEXT_PUBLIC_API_URL="$(NEXT_PUBLIC_API_URL)" NEXT_PUBLIC_ASSISTANT_ID="$(NEXT_PUBLIC_ASSISTANT_ID)" pnpm dev --port $(FRONTEND_PORT)' >>"$(FRONTEND_LOG)" 2>&1 & echo $$! >"$(FRONTEND_PID)"
	@pid="$$(cat "$(FRONTEND_PID)" 2>/dev/null || true)"; \
	if [[ -z "$$pid" ]]; then echo "frontend failed to write pid file: $(FRONTEND_PID)"; exit 1; fi
	@for _ in {1..30}; do \
		code="$$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$(FRONTEND_PORT)" || true)"; \
		if [[ "$$code" == "200" || "$$code" == "307" ]]; then break; fi; \
		sleep 0.5; \
	done
	@echo "frontend started (pid=$$(cat "$(FRONTEND_PID)"), port=$(FRONTEND_PORT))"

frontend-stop:
	@pid=""; \
	if [[ -f "$(FRONTEND_PID)" ]]; then pid="$$(cat "$(FRONTEND_PID)" 2>/dev/null || true)"; fi; \
	if [[ -n "$$pid" ]] && kill -0 "$$pid" 2>/dev/null; then kill "$$pid" 2>/dev/null || true; fi; \
	for _ in {1..30}; do if [[ -n "$$pid" ]] && kill -0 "$$pid" 2>/dev/null; then sleep 0.2; else break; fi; done; \
	if [[ -n "$$pid" ]] && kill -0 "$$pid" 2>/dev/null; then kill -9 "$$pid" 2>/dev/null || true; fi; \
	rm -f "$(FRONTEND_PID)"; \
	echo "frontend stopped"

frontend-status:
	@pid=""; \
	if [[ -f "$(FRONTEND_PID)" ]]; then pid="$$(cat "$(FRONTEND_PID)" 2>/dev/null || true)"; fi; \
	if [[ -n "$$pid" ]] && kill -0 "$$pid" 2>/dev/null; then echo "frontend running (pid=$$pid, port=$(FRONTEND_PORT))"; else echo "frontend stopped"; fi

frontend-logs:
	@touch "$(FRONTEND_LOG)"
	@echo "==> frontend: $(FRONTEND_LOG)"
	@tail -n 200 "$(FRONTEND_LOG)"

frontend-tail:
	@touch "$(FRONTEND_LOG)"
	@tail -f "$(FRONTEND_LOG)"

.PHONY: install-rg
install-rg:
	@if command -v rg >/dev/null 2>&1; then echo "rg already installed"; exit 0; fi
	@if ! command -v brew >/dev/null 2>&1; then \
		echo "Homebrew not found. Install Homebrew first, then run: make install-rg"; \
		exit 1; \
	fi
	@brew install ripgrep
