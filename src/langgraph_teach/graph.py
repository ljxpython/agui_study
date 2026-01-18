from __future__ import annotations

from typing import Annotated

from typing_extensions import TypedDict

from langgraph.graph import START, END, StateGraph
from langgraph.graph.message import add_messages


class ChatState(TypedDict):
    messages: Annotated[list, add_messages]


def echo_node(state: ChatState) -> dict:
    messages = state.get("messages", [])
    last = messages[-1] if messages else None

    if last is None:
        return {"messages": ["(no input)"]}

    return {"messages": [f"echo: {last}"]}


def build_graph():
    builder = StateGraph(ChatState)
    builder.add_node("echo", echo_node)
    builder.add_edge(START, "echo")
    builder.add_edge("echo", END)
    return builder.compile()


GRAPH = build_graph()
