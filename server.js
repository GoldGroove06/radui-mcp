import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import * as cheerio from 'cheerio';

const server = new McpServer({
  name: "arsh-ui-docs",
  version: "1.0.0",
  capabilities: { tools: {} }
});

// --- CONFIG ---
const DOCS_BASE = "https://www.rad-ui.com/docs/components"; // live docs URL
const COMPONENTS_JSON = path.join(process.cwd(), "data", "components.json"); // JSON with component list

// ---------------------------
// Tool 1: list_components
// ---------------------------
server.tool(
  "list_components",
  "Get a complete list of all available components",
  {},
  async () => {
    const data = JSON.parse(fs.readFileSync(COMPONENTS_JSON, "utf8"));
    const components = data.items.map(item => item.title);
    return { content: [{ type: "text", text: JSON.stringify(components, null, 2) }] };
  }
);

// ---------------------------
// Helper function: parse props table
// ---------------------------
function parsePropsTable(html) {
  const $ = cheerio.load(html);
  const table = $("table").first();
  if (!table.length) return [];

  const rows = table.find("tr").toArray();

  // headers
  const headers = $(rows.shift())
    .find("th, td")
    .map((_, el) => $(el).text().trim())
    .get();

  // rows
  const props = rows.map(row => {
    const cells = $(row)
      .find("td")
      .map((_, el) => $(el).text().trim())
      .get();

    const obj = {};
    headers.forEach((h, i) => {
      obj[h || `col_${i}`] = cells[i] ?? "";
    });

    return obj;
  });

  return props;
}

// ---------------------------
// Tool 2: get_component_props
// ---------------------------
server.tool(
  "get_component_props",
  "Detailed props, types, and configuration options for any component",
  { name: z.string() },
  async ({ name }) => {
    console.log(`${DOCS_BASE}/${name}`)
    const res = await fetch(`${DOCS_BASE}/${name.toLowerCase()}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    const description = $("p").eq(2).text().trim();
    const props = parsePropsTable(html);
    console.log(props, description)
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ description, props }, null, 2)
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
    const res = await fetch(`${DOCS_BASE}/${name}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    const example = $("pre code").first().text().trim();

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ example }, null, 2)
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
