#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fetch from "node-fetch";

const server = new McpServer({
  name: "arsh-ui-docs",
  version: "1.0.5",
  capabilities: { tools: {} }
});

// --- CONFIG ---
const API_BASE = "https://radui-mcp-gump.vercel.app/api/mcp"; // live docs URL

// ---------------------------
// Tool 1: list_components
// ---------------------------
server.tool(
  "list_components",
  "Get a complete list of all available components",
  {},
  async () => {
    const res = await fetch(`${API_BASE}/component/list`);
    if (!res.ok) {
      throw new Error(`Failed to fetch components list: ${res.status} ${res.statusText}`);
    }
    const { list } = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(list, null, 2) }] };
  }
);

// ---------------------------
// Tool 2: get_component_props
// ---------------------------
server.tool(
  "get_component_props",
  "Detailed props, types, and configuration options for any component",
  { name: z.string() },
  async ({ name }) => {
    const res = await fetch(`${API_BASE}/component/prop/${name.toLowerCase()}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch component props: ${res.status} ${res.statusText}`);
    }
    const { props } = await res.json();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ props }, null, 2)
        }
      ]
    };
  }
);

// ---------------------------
// Tool 3: get_component_example
// ---------------------------
server.tool(
  "get_component_example",
  "Retrieve code examples and usage patterns",
  { name: z.string() },
  async ({ name }) => {
    const res = await fetch(`${API_BASE}/component/example/${name.toLowerCase()}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch component example: ${res.status} ${res.statusText}`);
    }
    const { example, anatomy } = await res.json();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ example, anatomy }, null, 2)
        }
      ]
    };
  }
);

// ---------------------------
// Start server
// ---------------------------
const transport = new StdioServerTransport();
await server.connect(transport);
console.log("MCP server running...");
