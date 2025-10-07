#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Initialize our server
const server = new McpServer({
  name: "mcp-echo",
  version: "1.0.0",
  capabilities: {
    tools: {}
  }
});


// Tool definition for echoing text.
server.tool(
  "echo",
  "Echoes any message passed to it.",
  {
    message: z.string().describe("The message to echo")
  },
  async ({ message }) => ({
    content: [{ type: "text", text: `Tool echo: ${message}` }]
  })
);

// Start our server in Stdio transport mode.
const transport = new StdioServerTransport();
await server.connect(transport);