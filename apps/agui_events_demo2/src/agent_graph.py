import base64
import os
from typing import Any

from dotenv import load_dotenv
from langchain_community.agent_toolkits import SQLDatabaseToolkit
from langchain_community.utilities import SQLDatabase
from langchain_core.tools import tool

from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from langgraph.types import interrupt
from typing_extensions import Annotated, TypedDict

from llms import get_llm

load_dotenv()


def _get_db() -> SQLDatabase:
    db_path = os.getenv("CHINOOK_DB_PATH", "./data/Chinook.db")
    return SQLDatabase.from_uri(f"sqlite:///{db_path}")


@tool(description="将文本内容编码为 data URL，便于前端下载")
def download_text_file(filename: str, content: str, mime_type: str = "text/plain") -> str:
    b64 = base64.b64encode(content.encode("utf-8")).decode("ascii")
    return f"data:{mime_type};base64,{b64}"


class State(TypedDict):
    messages: Annotated[list, add_messages]


def build_graph(*, checkpointer: Any, mcp_tools: list[Any] | None = None) -> Any:
    db = _get_db()
    llm = get_llm()

    toolkit = SQLDatabaseToolkit(db=db, llm=llm)
    sql_tools = {t.name: t for t in toolkit.get_tools()}

    tools = list(sql_tools.values()) + list(mcp_tools or [])
    if os.getenv("ENABLE_DOWNLOAD_TOOL", "0") == "1":
        tools.append(download_text_file)

    model = llm.bind_tools(tools)
    tool_node = ToolNode(tools)

    mcp_names: set[str] = set()
    for t in list(mcp_tools or []):
        n = getattr(t, "name", None)
        if isinstance(n, str) and n:
            mcp_names.add(n)

    def _as_message_list(messages: Any) -> list:
        if messages is None:
            return []
        return messages if isinstance(messages, list) else [messages]

    def model_node(state: State) -> dict:
        import json
        import re

        from langchain_core.messages import AIMessage, SystemMessage

        def _get_last_user_text(messages: list[Any]) -> str:
            for m in reversed(messages):
                if getattr(m, "type", None) == "human":
                    return str(getattr(m, "content", "") or "")
            return ""

        user_text = _get_last_user_text(_as_message_list(state.get("messages"))).strip()
        user_text_lc = user_text.lower()

        forced_tool: str | None = None
        for name in sorted(mcp_names, key=len, reverse=True):
            if name and name in user_text:
                forced_tool = name
                break

        data_arg: list[dict[str, Any]] | None = None
        if forced_tool and "data" in user_text_lc:
            m = re.search(r"\bdata\b\s*(?:=|:)\s*(\[.*\])", user_text, flags=re.IGNORECASE | re.DOTALL)
            if m:
                try:
                    candidate = json.loads(m.group(1))
                    if isinstance(candidate, list):
                        data_arg = candidate
                except Exception:
                    data_arg = None

        wants_chart = bool(mcp_names) and (
            ("图表" in user_text)
            or ("可视化" in user_text)
            or ("chart" in user_text_lc)
            or ("visual" in user_text_lc)
            or ("plot" in user_text_lc)
            or ("bar chart" in user_text_lc)
            or ("chart tool" in user_text_lc)
        )

        system_lines = [
            "你是一个以 SQL 分析为主的智能体，同时具备工具调用能力。",
            "必须遵守：",
            "- 严禁执行 DML/DDL：INSERT/UPDATE/DELETE/DROP/ALTER/CREATE 等。",
            "- 先列出表(sql_db_list_tables)，再查相关表结构(sql_db_schema)，再写 SQL。",
            "- 执行前先用 sql_db_query_checker 检查 query。",
            "- 默认最多返回 10 行；只查相关列，不要 SELECT *。",
            "",
            "当用户明确要求‘下载/导出’时：生成 CSV，并调用 download_text_file 返回 data URL。",
        ]
        if mcp_names:
            system_lines.append(
                "当用户明确要求‘图表/可视化’时：优先调用 MCP chart 工具生成图表；返回的图表 URL 可直接输出。"
            )
            if forced_tool:
                system_lines.append(
                    "当用户点名具体的 generate_*_chart 工具时：只允许调用该工具一次；严禁重复调用或再次调用同名工具。"
                )
                if data_arg is not None:
                    system_lines.append(f"本次工具调用参数 data 必须是：{json.dumps(data_arg, ensure_ascii=True)}")
            system_lines.append(f"可用图表工具：{', '.join(sorted(mcp_names))}")

        convo = [SystemMessage(content="\n".join(system_lines))] + _as_message_list(state.get("messages"))

        runner = model
        if mcp_names and (forced_tool or wants_chart):
            desired = forced_tool or "required"
            try:
                runner = llm.bind_tools(list(mcp_tools or []), tool_choice=desired)
            except Exception:
                runner = llm.bind_tools(list(mcp_tools or []))

        ai = runner.invoke(convo)

        if isinstance(ai, AIMessage) and mcp_names and wants_chart and not getattr(ai, "tool_calls", None):
            ai2 = llm.bind_tools(list(mcp_tools or [])).invoke(convo)
            if isinstance(ai2, AIMessage) and getattr(ai2, "tool_calls", None):
                return {"messages": [ai2]}

        if isinstance(ai, AIMessage) and forced_tool and getattr(ai, "tool_calls", None):
            tc = ai.tool_calls[0]
            if tc.get("name") == forced_tool and data_arg is not None:
                tc_args = tc.get("args")
                if not (isinstance(tc_args, dict) and isinstance(tc_args.get("data"), list)):
                    fixed = dict(tc)
                    fixed["args"] = {"data": data_arg}
                    return {"messages": [AIMessage(content="", tool_calls=[fixed])]}

        return {"messages": [ai]}

    def review_node(state: State) -> dict:
        from langchain_core.messages import AIMessage, HumanMessage
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

    def should_review(state: State) -> str:
        from langchain_core.messages import AIMessage

        msgs = _as_message_list(state.get("messages"))
        last = msgs[-1] if msgs else None
        if isinstance(last, AIMessage) and getattr(last, "tool_calls", None):
            return "review"
        return END

    def should_run_tools(state: State) -> str:
        from langchain_core.messages import AIMessage

        msgs = _as_message_list(state.get("messages"))
        last = msgs[-1] if msgs else None
        if isinstance(last, AIMessage) and getattr(last, "tool_calls", None):
            return "tools"
        return "model"

    def should_continue_after_tools(state: State) -> str:
        try:
            from langchain_core.messages import ToolMessage
        except Exception:
            ToolMessage = None  # type: ignore

        msgs = _as_message_list(state.get("messages"))
        last = msgs[-1] if msgs else None

        if ToolMessage is not None and isinstance(last, ToolMessage):
            tool_name = getattr(last, "name", None)
            if isinstance(tool_name, str) and tool_name in mcp_names:
                return END

        return "model"

    builder = StateGraph(State)
    builder.add_node("model", model_node)
    builder.add_node("review", review_node)
    builder.add_node("tools", tool_node)

    builder.add_edge(START, "model")
    builder.add_conditional_edges("model", should_review, {"review": "review", END: END})
    builder.add_conditional_edges("review", should_run_tools, {"tools": "tools", "model": "model"})
    builder.add_conditional_edges("tools", should_continue_after_tools, {"model": "model", END: END})

    return builder.compile(checkpointer=checkpointer)
