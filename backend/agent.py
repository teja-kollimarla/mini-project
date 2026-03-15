"""
Agent that uses OpenRouter (e.g. Llama 3.3 70B) with MCP tools for video RAG.
Runs the MCP server as a subprocess and executes tool calls in a loop.
"""
import os
import json
import asyncio
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

load_dotenv()

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=os.getenv("OPENROUTER_API_KEY"),
)

PROJECT_ROOT = Path(__file__).resolve().parent

server_params = StdioServerParameters(
    command="uv",
    args=["run", "server.py"],
    cwd=str(PROJECT_ROOT),
    env=os.environ.copy(),
)


def mcp_tools_to_openai(tools_result):
    """Convert MCP list_tools result to OpenAI tools format."""
    tools = getattr(tools_result, "tools", tools_result)
    if not isinstance(tools, list):
        tools = list(tools) if hasattr(tools, "__iter__") else []
    openai_tools = []
    for t in tools:
        name = getattr(t, "name", None)
        if name is None and isinstance(t, dict):
            name = t.get("name")
        desc = getattr(t, "description", None) or ""
        if isinstance(t, dict):
            desc = t.get("description") or ""
        schema = getattr(t, "inputSchema", None)
        if schema is None and isinstance(t, dict):
            schema = t.get("inputSchema")
        if schema is None:
            schema = {"type": "object", "properties": {}}
        openai_tools.append({
            "type": "function",
            "function": {
                "name": name,
                "description": desc,
                "parameters": schema,
            },
        })
    return openai_tools


def get_tool_result_text(call_tool_result):
    """Extract text from MCP CallToolResult (content list of ContentBlock)."""
    content = getattr(call_tool_result, "content", None) or []
    if not content:
        return str(call_tool_result)
    texts = []
    for block in content:
        if hasattr(block, "text"):
            texts.append(block.text)
        elif isinstance(block, dict) and "text" in block:
            texts.append(block["text"])
    return "\n".join(texts) if texts else str(call_tool_result)


async def run_agent(
    user_message: str,
    model: str = "meta-llama/llama-3.3-70b-instruct:free",
):
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            tools_result = await session.list_tools()
            openai_tools = mcp_tools_to_openai(tools_result)
            if not openai_tools:
                return "No tools available from MCP server."

            messages = [{"role": "user", "content": user_message}]
            max_rounds = 10

            for _ in range(max_rounds):
                response = client.chat.completions.create(
                    model=model,
                    messages=messages,
                    tools=openai_tools,
                )

                choice = response.choices[0]
                msg = choice.message
                tool_calls = getattr(msg, "tool_calls", None) or []

                if not tool_calls:
                    return (msg.content or "").strip() or "(No response)"

                messages.append({
                    "role": "assistant",
                    "content": msg.content or None,
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.function.name,
                                "arguments": tc.function.arguments,
                            },
                        }
                        for tc in tool_calls
                    ],
                })

                for tc in tool_calls:
                    name = tc.function.name
                    try:
                        arguments = (
                            json.loads(tc.function.arguments)
                            if isinstance(tc.function.arguments, str)
                            else (tc.function.arguments or {})
                        )
                    except json.JSONDecodeError:
                        arguments = {}
                    result = await session.call_tool(name, arguments)
                    text = get_tool_result_text(result)
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": text,
                    })

            return "Max tool-call rounds reached."


async def main():
    user_message = "Show the video segment explaining neural networks"
    print("User:", user_message)
    reply = await run_agent(user_message)
    print("Agent:", reply)


if __name__ == "__main__":
    asyncio.run(main())
