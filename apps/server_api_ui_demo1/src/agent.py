import asyncio
import base64
import os
from typing import Any

from dotenv import load_dotenv
from langchain_community.agent_toolkits import SQLDatabaseToolkit
from langchain_community.utilities import SQLDatabase
from langchain_core.tools import tool

from llms import get_model

load_dotenv()


def _get_db() -> SQLDatabase:
    db_path = os.getenv("CHINOOK_DB_PATH", "./data/Chinook.db")
    return SQLDatabase.from_uri(f"sqlite:///{db_path}")


@tool(description="将文本内容编码为 data URL，便于前端下载")
def download_text_file(filename: str, content: str, mime_type: str = "text/plain") -> str:
    b64 = base64.b64encode(content.encode("utf-8")).decode("ascii")
    return f"data:{mime_type};base64,{b64}"


def _maybe_load_mcp_tools() -> list[Any]:
    if os.getenv("ENABLE_MCP_CHART", "0") != "1":
        return []

    from langchain_mcp_adapters.client import MultiServerMCPClient

    client = MultiServerMCPClient(
        {
            "mcp-server-chart": {
                "command": "npx",
                "args": ["-y", "@antv/mcp-server-chart"],
                "transport": "stdio",
            }
        }
    )

    return asyncio.run(client.get_tools())


def build_agent():
    has_llm_key = bool(os.getenv("ZHIPU_API_KEY") or os.getenv("OPENAI_API_KEY"))
    if not has_llm_key:
        raise RuntimeError(
            "未检测到 ZHIPU_API_KEY/OPENAI_API_KEY。请从仓库根目录复制 .env 到本子项目并重启服务。"
        )

    from langchain_core.messages import AIMessage, HumanMessage
    from langgraph.graph import END, START, StateGraph
    from langgraph.graph.message import add_messages
    from langgraph.prebuilt import ToolNode
    from langgraph.types import interrupt
    from typing_extensions import Annotated, TypedDict

    db = _get_db()
    llm = get_model(provider=os.getenv("LLM_PROVIDER", "zhipu"), model=os.getenv("LLM_MODEL"))

    toolkit = SQLDatabaseToolkit(db=db, llm=llm)
    sql_tools = {t.name: t for t in toolkit.get_tools()}

    mcp_tools = _maybe_load_mcp_tools() if os.getenv("ENABLE_MCP_CHART", "0") == "1" else []
    tools = list(sql_tools.values()) + mcp_tools + [download_text_file]

    model = llm.bind_tools(tools)
    tool_node = ToolNode(tools)

    class State(TypedDict):
        messages: Annotated[list, add_messages]

    def _as_message_list(messages: Any) -> list:
        if messages is None:
            return []
        return messages if isinstance(messages, list) else [messages]

    def model_node(state: State) -> dict:
        system = (
            "你是一个专为与 SQL 数据库交互而设计的智能体。\n"
            "必须遵守：\n"
            "- 严禁执行 DML/DDL：INSERT/UPDATE/DELETE/DROP/ALTER/CREATE 等。\n"
            "- 先列出表(sql_db_list_tables)，再查相关表结构(sql_db_schema)，再写 SQL。\n"
            "- 执行前先用 sql_db_query_checker 检查 query。\n"
            "- 默认最多返回 10 行；只查相关列，不要 SELECT *。\n"
            "\n"
            "当用户明确要求‘下载/导出’时：生成 CSV，并调用 download_text_file 返回 data URL。\n"
        )
        convo = [HumanMessage(content=system)] + _as_message_list(state.get("messages"))
        ai = model.invoke(convo)
        return {"messages": [ai]}

    def review_node(state: State) -> dict:
        from langgraph.graph.message import RemoveMessage

        msgs = _as_message_list(state.get("messages"))
        last = msgs[-1] if msgs else None
        if not isinstance(last, AIMessage) or not getattr(last, "tool_calls", None):
            return {}

        gated = [tc for tc in last.tool_calls if tc.get("name") == "sql_db_query"]
        if not gated:
            return {}

        tc = gated[0]
        interrupt_value = {
            "action_request": {"action": tc.get("name"), "args": tc.get("args")},
            "config": {
                "allow_respond": True,
                "allow_accept": True,
                "allow_edit": True,
                "allow_ignore": True,
            },
            "description": "执行 SQL 查询前需要确认（可 Accept/Edit/Ignore/Response）。",
        }

        response = interrupt(interrupt_value)

        responses: list[dict[str, Any]]
        if isinstance(response, list):
            responses = [r for r in response if isinstance(r, dict)]
        elif isinstance(response, dict):
            responses = [response]
        else:
            responses = []

        if not responses:
            return {"messages": [HumanMessage(content="未收到有效的审批响应，请重新提交。")]}

        r0 = responses[0]
        r_type = r0.get("type")
        r_args = r0.get("args")

        if r_type == "ignore":
            return {"messages": [HumanMessage(content="用户选择忽略本次 SQL 执行，请重新规划。")]}

        if r_type == "response" and isinstance(r_args, str) and r_args.strip():
            return {"messages": [HumanMessage(content=r_args)]}

        updated_name = tc.get("name")
        updated_args = tc.get("args")

        if r_type == "edit" and isinstance(r_args, dict):
            updated_name = r_args.get("action", updated_name)
            updated_args = r_args.get("args", updated_args)

        if r_type == "accept" and isinstance(r_args, dict):
            updated_name = r_args.get("action", updated_name)
            updated_args = r_args.get("args", updated_args)

        new_tool_calls: list[dict[str, Any]] = []
        for existing in last.tool_calls:
            if existing.get("id") == tc.get("id"):
                new_tool_calls.append(
                    {
                        "id": existing.get("id"),
                        "name": updated_name,
                        "args": updated_args,
                        "type": existing.get("type", "tool_call"),
                    }
                )
            else:
                new_tool_calls.append(dict(existing))

        remove_id = last.id
        if not remove_id:
            return {"messages": [AIMessage(content="", tool_calls=new_tool_calls)]}

        return {
            "messages": [
                RemoveMessage(id=remove_id),
                AIMessage(content="", tool_calls=new_tool_calls),
            ]
        }

    def should_continue(state: State) -> str:
        msgs = _as_message_list(state.get("messages"))
        last = msgs[-1] if msgs else None
        if isinstance(last, AIMessage) and getattr(last, "tool_calls", None):
            return "review"
        return END

    def should_run_tools(state: State) -> str:
        msgs = _as_message_list(state.get("messages"))
        last = msgs[-1] if msgs else None
        if isinstance(last, AIMessage) and getattr(last, "tool_calls", None):
            return "tools"
        return "model"

    builder = StateGraph(State)
    builder.add_node("model", model_node)
    builder.add_node("review", review_node)
    builder.add_node("tools", tool_node)

    builder.add_edge(START, "model")
    builder.add_conditional_edges("model", should_continue, {"review": "review", END: END})
    builder.add_conditional_edges("review", should_run_tools, {"tools": "tools", "model": "model"})
    builder.add_edge("tools", "model")

    return builder.compile()


agent = build_agent()
