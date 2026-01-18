#!/usr/bin/env python3

import json
import os
import sys
from pathlib import Path


def _load_graphs() -> dict[str, str]:
    config_path = Path(__file__).parent / "graph.json"
    if not config_path.exists():
        return {"agent": "./src/agent.py:agent"}

    with config_path.open("r", encoding="utf-8") as f:
        config = json.load(f)
    graphs = config.get("graphs")
    return graphs if isinstance(graphs, dict) else {"agent": "./src/agent.py:agent"}


def _setup_environment() -> None:
    # Ensure ./src is importable
    src_path = Path(__file__).parent / "src"
    sys.path.insert(0, str(src_path))

    # Load .env
    env_file = Path(__file__).parent / ".env"
    if env_file.exists():
        from dotenv import load_dotenv

        load_dotenv(env_file)

    graphs = _load_graphs()

    # Minimal in-memory runtime for exploration (history works within process).
    os.environ.update(
        {
            "DATABASE_URI": ":memory:",
            "REDIS_URI": "fake",
            "MIGRATIONS_PATH": "__inmem",
            "LANGGRAPH_RUNTIME_EDITION": "inmem",
            "LANGSMITH_LANGGRAPH_API_VARIANT": "local_dev",
            "LANGGRAPH_API_URL": os.getenv("LANGGRAPH_API_URL", "http://localhost:2024"),
            "LANGGRAPH_ALLOW_BLOCKING": "true",
            "ALLOW_PRIVATE_NETWORK": "true",
            "LANGSERVE_GRAPHS": json.dumps(graphs),
        }
    )


def main() -> None:
    _setup_environment()

    import uvicorn

    uvicorn.run(
        "langgraph_api.server:app",
        host="0.0.0.0",
        port=2024,
        reload=False,
        access_log=False,
    )


if __name__ == "__main__":
    main()
