#!/usr/bin/env python3
"""通过 MCP `execute_code` 取 ASECLI 几何 payload（供 V6 等价性对比使用）。

刻意复用 ASECLI 自己的片段与客户端，保证「MCP 侧」与 ASECLI 实际行为一致：
片段来自 `asecli.bridge.graph_geometry.GEOMETRY_SNIPPET`，请求形态与
`call_execute_code` 相同（action=execute + safety_checks=False）。

用法：python mcp-geometry-payload.py <mcp_url> <asset_path>
输出：stdout 为 payload 原始文本；失败时退出码非 0 且 stderr 给出原因。
"""
from __future__ import annotations

import json
import sys

from asecli.bridge.graph_geometry import GEOMETRY_SNIPPET
from asecli.bridge.mcp_client import McpClient, McpError, tool_text


def main() -> int:
    if len(sys.argv) < 3:
        sys.stderr.write("usage: mcp-geometry-payload.py <mcp_url> <asset_path>\n")
        return 2
    mcp_url, asset_path = sys.argv[1], sys.argv[2]

    code = GEOMETRY_SNIPPET.format(asset_path=json.dumps(asset_path))
    client = McpClient(mcp_url, allow_remote=False)
    try:
        client.connect()
        # 与 ASECLI 的 call_execute_code 保持同一请求形态。
        result = client.call_tool("execute_code", {
            "action": "execute",
            "code": code,
            "safety_checks": False,
        })
        text = tool_text(result, None)
    except McpError as error:
        sys.stderr.write(f"MCP call failed: {error}\n")
        return 1

    # 解包 execute_code 的 envelope；marker 解析留给调用方（与 ASECLI 一致）。
    try:
        envelope = json.loads(text)
    except json.JSONDecodeError:
        sys.stdout.write(text)
        return 0
    if isinstance(envelope, dict):
        if envelope.get("success") is False:
            sys.stderr.write(f"execute_code reported failure: {envelope.get('message')}\n")
            return 1
        data = envelope.get("data")
        if isinstance(data, dict):
            payload = data.get("result")
            if isinstance(payload, str) and payload.strip():
                sys.stdout.write(payload)
                return 0
    sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
