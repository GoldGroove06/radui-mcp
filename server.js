#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fetch from "node-fetch";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const server = new McpServer({
  name: "arsh-ui-docs",
  version: "1.1.1",
  capabilities: { tools: {} }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REMOTE_MCP_JSON_URL = "https://goldgroove06.github.io/radui-mcp/mcp.json";
const LOCAL_MCP_JSON_PATH = process.env.MCP_JSON_PATH
  ? path.resolve(process.cwd(), process.env.MCP_JSON_PATH)
  : path.join(__dirname, "mcp.json");

let mcpIndexCache = null;
let mcpIndexPromise = null;

function normalizeName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function tokenize(value) {
  return String(value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 1);
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function scoreText(text, tokens) {
  const lower = String(text ?? "").toLowerCase();
  let score = 0;
  for (const token of tokens) {
    score += countOccurrences(lower, token);
  }
  return score;
}

function clipSnippet(text, tokens, maxLength = 900) {
  const source = String(text ?? "");
  if (!source) return "";

  const lower = source.toLowerCase();
  let startIndex = 0;
  for (const token of tokens) {
    const idx = lower.indexOf(token);
    if (idx !== -1) {
      startIndex = Math.max(0, idx - Math.floor(maxLength / 3));
      break;
    }
  }

  const endIndex = Math.min(source.length, startIndex + maxLength);
  let snippet = source.slice(startIndex, endIndex).replace(/\s+/g, " ").trim();

  if (startIndex > 0) snippet = `...${snippet}`;
  if (endIndex < source.length) snippet = `${snippet}...`;

  return snippet;
}

function asComponentRecords(index) {
  if (Array.isArray(index?.components)) return index.components;
  if (Array.isArray(index)) return index;
  if (index && typeof index === "object" && typeof index.component === "string") return [index];
  return [];
}

function findComponentRecord(records, name) {
  const target = normalizeName(name);
  return records.find((record) => {
    const recordName = normalizeName(record.component);
    return recordName === target;
  });
}

async function loadIndexFromRemote(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function loadIndexFromLocal(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function loadMcpIndex() {
  if (mcpIndexCache) return mcpIndexCache;
  if (mcpIndexPromise) return mcpIndexPromise;

  mcpIndexPromise = (async () => {
    const errors = [];

    if (REMOTE_MCP_JSON_URL) {
      try {
        const remote = await loadIndexFromRemote(REMOTE_MCP_JSON_URL);
        mcpIndexCache = remote;
        return remote;
      } catch (error) {
        errors.push(`Remote (${REMOTE_MCP_JSON_URL}): ${error.message}`);
      }
    }

    try {
      const local = await loadIndexFromLocal(LOCAL_MCP_JSON_PATH);
      mcpIndexCache = local;
      return local;
    } catch (error) {
      errors.push(`Local (${LOCAL_MCP_JSON_PATH}): ${error.message}`);
    }

    throw new Error(`Unable to load mcp.json. ${errors.join(" | ")}`);
  })();

  try {
    return await mcpIndexPromise;
  } finally {
    mcpIndexPromise = null;
  }
}

server.tool(
  "get_installation_guide",
  "Get installation steps for the @radui/ui library",
  {},
  async () => {
    const index = await loadMcpIndex();
    return { content: [{ type: "text", text: JSON.stringify(index?.installation ?? null, null, 2) }] };
  }
);

server.tool(
  "list_components",
  "Get a complete list of all available components",
  {},
  async () => {
    const index = await loadMcpIndex();
    const records = asComponentRecords(index);
    const list = records.map((record) => record.component).filter(Boolean).sort((a, b) => a.localeCompare(b));

    return { content: [{ type: "text", text: JSON.stringify({ list }, null, 2) }] };
  }
);

server.tool(
  "get_component_props",
  "Detailed props, types, and configuration options for any component",
  { name: z.string() },
  async ({ name }) => {
    const index = await loadMcpIndex();
    const records = asComponentRecords(index);
    const record = findComponentRecord(records, name);

    if (!record) {
      throw new Error(`Component \"${name}\" not found. Use list_components first.`);
    }

    const props = record.exports?.api_documentation ?? null;
    return { content: [{ type: "text", text: JSON.stringify({ component: record.component, props }, null, 2) }] };
  }
);

server.tool(
  "get_component_example",
  "Retrieve code examples and usage patterns",
  { name: z.string() },
  async ({ name }) => {
    const index = await loadMcpIndex();
    const records = asComponentRecords(index);
    const record = findComponentRecord(records, name);

    if (!record) {
      throw new Error(`Component \"${name}\" not found. Use list_components first.`);
    }

    const example = record.exports?.code ?? record.exports?.default ?? null;
    const anatomy = record.exports?.anatomy ?? null;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ component: record.component, example, anatomy }, null, 2)
        }
      ]
    };
  }
);

server.tool(
  "search_docs",
  "Manual keyword search over mcp.json data",
  { query: z.string(), component: z.string().optional() },
  async ({ query, component }) => {
    const index = await loadMcpIndex();
    const records = asComponentRecords(index);
    const tokens = tokenize(query);

    const scopedRecords = component
      ? [findComponentRecord(records, component)].filter(Boolean)
      : records;

    if (!scopedRecords.length) {
      throw new Error(component ? `Component \"${component}\" not found.` : "No components available in mcp.json");
    }

    const matches = scopedRecords
      .map((record) => {
        const serialized = JSON.stringify(record.exports ?? {});
        const score = scoreText(serialized, tokens);

        return {
          component: record.component,
          score,
          snippet: clipSnippet(serialized, tokens)
        };
      })
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score);

    const installationSerialized = JSON.stringify(index?.installation ?? {});
    const installationScore = scoreText(installationSerialized, tokens);
    if (installationScore > 0) {
      matches.unshift({
        component: "installation",
        score: installationScore,
        snippet: clipSnippet(installationSerialized, tokens)
      });
    }

    return { content: [{ type: "text", text: JSON.stringify({ query, matches: matches.slice(0, 20) }, null, 2) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.log(
  `MCP server running using ${REMOTE_MCP_JSON_URL ? `remote mcp.json (${REMOTE_MCP_JSON_URL})` : `local mcp.json (${LOCAL_MCP_JSON_PATH})`}.`
);
