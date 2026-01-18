import os

from dotenv import load_dotenv
from langchain_core.language_models.chat_models import BaseChatModel
from pydantic import SecretStr


def get_default_model() -> BaseChatModel:
    load_dotenv()
    from langchain_deepseek.chat_models import ChatDeepSeek

    return ChatDeepSeek(model="deepseek-chat")


def get_doubao_model() -> BaseChatModel:
    load_dotenv()
    from langchain_openai.chat_models import ChatOpenAI

    api_key = os.getenv("DOUBAO_API_KEY")
    return ChatOpenAI(
        model="doubao-seed-1-6-251015",
        api_key=SecretStr(api_key) if api_key else None,
        base_url="https://ark.cn-beijing.volces.com/api/v3",
    )


def get_chatgpt_model(model: str | None = None) -> BaseChatModel:
    """通过 OpenAI-compatible 中转初始化 ChatGPT（gpt-5 系列建议走 Responses API）。"""
    load_dotenv()
    from langchain_openai.chat_models import ChatOpenAI

    resolved_model = model or os.getenv("OPENAI_MODEL", "gpt-5-codex")
    base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")

    # 这个中转的 gpt-5-codex 需要走 /openai/v1/responses（并且要求 stream=true）。
    # 项目里常见配置是 /api/v1，这里自动转换到 /openai/v1。
    if base_url.endswith("/api/v1"):
        base_url = base_url[: -len("/api/v1")] + "/openai/v1"

    # 关键点：你的中转对 gpt-5/codex 不支持 Chat Completions 的 `messages`，
    # 必须走 Responses API（/responses）。这里直接强制开启，避免再踩坑。
    use_responses_api = True

    api_key = os.getenv("OPENAI_API_KEY")

    return ChatOpenAI(
        model=resolved_model,
        api_key=SecretStr(api_key) if api_key else None,
        base_url=base_url,
        use_responses_api=use_responses_api,
    )


def get_zhipu_model(model: str | None = None) -> BaseChatModel:
    load_dotenv()
    from langchain_openai.chat_models import ChatOpenAI

    resolved_model = model or os.getenv("ZHIPU_MODEL", "glm-4.7")
    base_url = os.getenv("ZHIPU_BASE_URL", "https://open.bigmodel.cn/api/paas/v4/").rstrip("/")
    api_key = os.getenv("ZHIPU_API_KEY")

    return ChatOpenAI(
        model=resolved_model,
        api_key=SecretStr(api_key) if api_key else None,
        base_url=base_url,
    )


def get_model(provider: str | None = None, model: str | None = None) -> BaseChatModel:
    load_dotenv()
    resolved_provider = (provider or os.getenv("LLM_PROVIDER", "chatgpt")).strip().lower()

    if resolved_provider in {"zhipu", "bigmodel", "glm"}:
        return get_zhipu_model(model)

    if resolved_provider in {"doubao"}:
        return get_doubao_model()

    if resolved_provider in {"deepseek", "default"}:
        return get_default_model()

    return get_chatgpt_model(model)

# doubao_llm = get_doubao_model()
# response = doubao_llm.invoke("你好")
# print(response)

# chatgpt_llm = get_chatgpt_model("gpt-5.2")
# response = chatgpt_llm.invoke("你好")
# print(response)

if __name__ == "__main__":
    prompt = os.getenv(
        "LLM_TEST_PROMPT",
        "请列出当前最热的十门编程语言，并按热度排名（1-10）。"
        "对每门语言分别用 3-5 句话说明优点、缺点、典型使用场景。",
    )
    provider = os.getenv("LLM_PROVIDER", "chatgpt")
    model = os.getenv("LLM_MODEL")

    print("Q:", prompt)
    print("[provider]", provider)
    print("[model]", model or "(default)")
    print("A:", end=" ", flush=True)

    llm = get_model(provider=provider, model=model)
    full_text = ""
    for chunk in llm.stream(prompt):
        c = getattr(chunk, "content", "")
        if isinstance(c, list):
            c = "".join(
                (p.get("text", "") if isinstance(p, dict) else (getattr(p, "text", "") or ""))
                for p in c
            )
        c = c if isinstance(c, str) else ("" if c is None else str(c))
        if c:
            full_text += c
            print(c, end="", flush=True)

    print("\n\n[full_text]\n" + full_text)
