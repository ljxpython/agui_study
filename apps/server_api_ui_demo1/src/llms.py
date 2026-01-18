import os

from dotenv import load_dotenv
from langchain_core.language_models.chat_models import BaseChatModel


def get_zhipu_model(model: str | None = None) -> BaseChatModel:
    load_dotenv()
    from langchain_openai.chat_models import ChatOpenAI

    resolved_model = model or os.getenv("ZHIPU_MODEL", "glm-4.7")
    base_url = os.getenv("ZHIPU_BASE_URL", "https://open.bigmodel.cn/api/paas/v4/").rstrip("/")

    # langchain-openai uses the OpenAI python client underneath.
    # Some codepaths still look for OPENAI_API_KEY, so we mirror ZHIPU_API_KEY.
    api_key = os.getenv("ZHIPU_API_KEY") or os.getenv("OPENAI_API_KEY")

    # langchain-openai routes auth via the OpenAI python client.
    # Ensure OPENAI_API_KEY is always present when we have a provider-specific key.
    if api_key:
        os.environ["OPENAI_API_KEY"] = api_key

    from pydantic import SecretStr

    return ChatOpenAI(
        model=resolved_model,
        api_key=SecretStr(api_key) if api_key else None,
        base_url=base_url,
    )


def get_model(provider: str | None = None, model: str | None = None) -> BaseChatModel:
    load_dotenv()
    resolved_provider = (provider or os.getenv("LLM_PROVIDER", "zhipu")).strip().lower()

    if resolved_provider in {"zhipu", "bigmodel", "glm"}:
        return get_zhipu_model(model)

    # Default to zhipu for this subproject.
    return get_zhipu_model(model)
