"""
图表工具模块 - 改进版本

提供智能检测、重复防护和参数验证
"""

from typing import Literal, Dict, Any
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.graph import START, END, StateGraph
from langgraph.graph.message import add_messages


# ==================== 智能图表意图检测 ====================

_chart_keywords = {
    'line': ['折线图', '线图', '曲线图', '趋势图'],
    'bar': ['柱状图', '条形图', '直方图', '条图'],
    'pie': ['饼图', '饼图', '比例图', '占比图'],
    'scatter': ['散点图', '散布图', '相关图'],
    'histogram': ['直方图', '分布图', '统计图'],
}


def detect_chart_intent(user_text: str) -> Dict[str, Any]:
    """
    检测用户是否需要图表可视化

    Returns:
        {
            "wants_chart": bool,  # 是否需要图表
            "chart_type": str | None,  # 图表类型
            "confidence": float,  # 置信度 0.0-1.0
            "reason": str,  # 原因
        }
    """
    text_lower = user_text.lower()

    for chart_type, keywords in _chart_keywords.items():
        if any(kw in text_lower for kw in keywords):
            return {
                "wants_chart": True,
                "chart_type": chart_type,
                "confidence": 0.8,
                "reason": f"检测到关键词: {keywords[0]}",
            }

    return {
        "wants_chart": False,
        "chart_type": None,
        "confidence": 0.0,
        "reason": "未检测到图表相关关键词",
    }


# ==================== 图表工具状态机（简单状态机） ====================

_chart_status = {
    "IDLE": "idle",           # 空闲，未被调用
    "EXECUTING": "executing",  # 正在执行
    "COMPLETED": "completed", # 已完成
}


# ==================== 图表工具状态 ====================

_chart_tool_status = {"last_call": None, "status": _chart_status["IDLE"]}


def check_duplicate_prevention(state: Dict) -> bool:
    """
    检查是否应该防止重复调用

    Args:
        state: 当前对话状态

    Returns:
        bool: 是否应该阻止重复调用
    """
    messages = state.get("messages", [])
    last_message = messages[-1] if messages else None

    if not last_message:
        return False

    # 检查最后一条消息是否有图表工具调用
    tool_calls = getattr(last_message, "tool_calls", None)
    if not tool_calls:
        return False

    # 检查是否有图表工具调用
    for tc in tool_calls:
        if tc.get("name") in ["wants_chart", "chart_tool"]:
            return True

    return False


def validate_chart_params(
    user_text: str,
    state: Dict,
    user_text_lc: str = None
) -> Dict[str, Any]:
    """
    验证图表参数

    Returns:
        {
            "valid": bool,  # 参数是否有效
            "error": str | None,  # 错误信息
            "suggested_query": str | None,  # 建议的 SQL 查询
        }
    """
    messages = state.get("messages", [])
    last_message = messages[-1] if messages else None

    if not last_message:
        return {
            "valid": False,
            "error": "未找到对话历史",
            "suggested_query": None,
        }

    last_user_msg = last_message.content if isinstance(last_message, HumanMessage) else ""
    user_text_lc = user_text.lower() if user_text_lc else ""

    # 提取最近的表名（简化版，实际应该从数据库 schema 读取）
    table_names = ['artists', 'albums', 'tracks', 'employees', 'invoices', 'customers']

    # 单表查询模式匹配
    query_patterns = [
        (r'artists?.*\btracks', 'artists 表'),
        (r'albums?.*\btracks', 'albums 表'),
        (r'employees?.*\btracks', 'employees 表'),
        (r'invoices?.*\btracks', 'tracks 表'),
        (r'invoices?.*\btracks', 'voices 表'),
        (r'invoices?.*\btracks', 'voices 表'),
        (r'invoices?.*\borders', 'borders 表'),
        (r'borders?.*\borders', 'borders 表'),
        (r'customers?.*\borders', 'customers 表'),
        (r'customers?.*\borders', 'borders 表'),
    ]

    for pattern, desc in query_patterns:
        if re.search(pattern, last_user_msg, re.IGNORECASE):
            return {
                "valid": False,
                "error": f"无法理解查询意图",
                "suggested_query": None,
            }

    # 解析用户输入
    import re

    # 简单意图识别
    if re.search(r'artists?\s*(?:)?\s+(?:,?)?\s*\)', last_user_msg):
        return {
            "valid": True,
            "error": None,
            "suggested_query": "SELECT * FROM artists LIMIT 5",
        }
    elif re.search(r'albums?\s*(?:)?\s+(?:,?)?\s*\)', last_user_msg):
        return {
            "valid": True,
            "error": None,
            "suggested_query": "SELECT * FROM albums LIMIT 5",
        }
    elif re.search(r'tracks?\s*(?:)?\s+(?:,?)?\s*\)', last_user_msg):
        return {
            "valid": True,
            "error": None,
            "suggested_query": "SELECT * FROM tracks LIMIT 10",
        }

    return {
        "valid": False,
        "error": "参数识别失败",
        "suggested_query": None,
    }


def chart_tool_node(state: State) -> Dict:
    """
    改进的图表工具节点

    Features:
    1. 智能意图检测（基于关键词）
    2. 重复防护（状态机）
    3. 参数验证（SQL 查询模式）

    Args:
        state: 当前对话状态

    Returns:
        dict: 下一步决策或图表调用结果
    """
    messages = state.get("messages", [])
    last_message = messages[-1] if messages else None

    if not messages:
        return {
            "messages": [HumanMessage(content="请先提供一些上下文或直接提问。")],
        }

    # 1. 智能意图检测
    chart_intent = detect_chart_intent(last_message.content if isinstance(last_message, HumanMessage) else "")
    chart_status = _chart_tool_status["status"]

    # 2. 检查重复调用
    should_block = check_duplicate_prevention(state)

    if chart_status == _chart_status["EXECUTING"]:
        return {
            "messages": [
                AIMessage(
                    content=f"图表工具正在执行中，请稍候...（当前状态：{chart_status}）"
                )
            ],
        }

    if should_block and chart_intent["wants_chart"]:
        return {
            "messages": [
                AIMessage(
                    content=f"检测到重复的图表调用。每个图表请求只允许调用一次。当前状态：{chart_status}"
                )
            ],
        }

    # 3. 参数验证
    if chart_intent["wants_chart"]:
        validation = validate_chart_params(last_message.content, state)

        if not validation["valid"]:
            return {
                "messages": [
                    AIMessage(content=validation["error"])
                ],
            }

    # 4. 更新状态机
    _chart_tool_status["last_call"] = last_message.id if isinstance(last_message, AIMessage) else None

    # 返回提示消息
    response_type = "help"  # 帮助信息，不是图表请求
    return {
        "messages": [
                AIMessage(
                    content=f"检测到需要图表（{chart_intent['chart_type'] or '未知'}）。说明：我可以帮你生成图表，但需要你提供更多上下文。\n\n可用图表类型：{', '.join(list(_chart_keywords.keys()))}\n\n提供具体要求：\n- 数据来源：哪张表？\n- 图表类型：{chart_intent['chart_type']}\n- 特定要求（颜色、尺寸、标题等）"
                ),
            ],
    }


def get_chart_status() -> Dict[str, str]:
    """
    获取当前图表工具状态（供 debug 和日志）

    Returns:
        {
            "status": str,  # 当前状态
            "last_call": str | None,  # 最后调用 ID
        }
    """
    return {
        "status": _chart_tool_status["status"],
        "last_call": _chart_tool_status["last_call"],
    }


# ==================== LangGraph 节点定义 ====================

def chart_tool_node(state: State) -> Dict:
    """
    图表工具 LangGraph 节点

    Returns:
        dict: 节点定义
    """
    messages = state.get("messages", [])
    last_message = messages[-1] if messages else None

    chart_tool = chart_tool_node.__get__wrapped__(state)
    return {
        "messages": messages + [chart_tool],
    }
    }


# ==================== 导出 ====================

__all__ = [
    detect_chart_intent,
    check_duplicate_prevention,
    validate_chart_params,
    get_chart_status,
    chart_tool_node,
]
