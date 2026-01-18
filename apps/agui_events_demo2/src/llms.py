import os

from langchain_openai import ChatOpenAI
from pydantic import SecretStr


def _require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required env var: {name}")
    return value


def get_llm() -> ChatOpenAI:
    provider = os.getenv("LLM_PROVIDER", "zhipu").strip().lower()
    if provider != "zhipu":
        raise RuntimeError(f"Unsupported LLM_PROVIDER: {provider}")

    base_url = _require_env("ZHIPU_BASE_URL")
    model = _require_env("ZHIPU_MODEL")

    api_key = os.getenv("ZHIPU_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("Missing required env var: ZHIPU_API_KEY or OPENAI_API_KEY")

    if not os.getenv("OPENAI_API_KEY"):
        os.environ["OPENAI_API_KEY"] = api_key

    return ChatOpenAI(model=model, api_key=SecretStr(api_key), base_url=base_url)
