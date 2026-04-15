#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { beeClient } from "./bee-client.js";

const server = new McpServer(
  { name: "bee-ts", version: "0.1.0" },
  {
    instructions:
      "Tools to access Bee — the user's wearable AI. Bee captures conversations and extracts facts, " +
      "todos, journals, and daily summaries. Start with bee_now to understand current context. " +
      "Use bee_facts_list for personal context about the user. Use bee_search for specific topics.",
  },
);

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(err: unknown) {
  return {
    isError: true,
    content: [{
      type: "text" as const,
      text: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    }],
  };
}

server.registerTool(
  "bee_me",
  { description: "Get the owner's profile (name, timezone, id).", inputSchema: {} },
  async () => { try { return textResult(await beeClient.me()); } catch (e) { return errorResult(e); } },
);

server.registerTool(
  "bee_now",
  {
    description: "Recent conversations from the last N hours with summaries. Use FIRST to understand current context.",
    inputSchema: {
      hours_back: z.number().min(1).max(24).default(10),
      limit: z.number().min(1).max(100).default(50),
    },
  },
  async ({ hours_back, limit }) => {
    try { return textResult(await beeClient.now(hours_back, limit)); }
    catch (e) { return errorResult(e); }
  },
);

server.registerTool(
  "bee_facts_list",
  {
    description: "List facts Bee has learned about the owner (preferences, relationships, work, personal details).",
    inputSchema: {
      limit: z.number().min(1).max(200).default(50),
      cursor: z.string().optional(),
    },
  },
  async ({ limit, cursor }) => {
    try { return textResult(await beeClient.listFacts(limit, cursor)); }
    catch (e) { return errorResult(e); }
  },
);

server.registerTool(
  "bee_fact_get",
  { description: "Get a specific fact by ID.", inputSchema: { id: z.string() } },
  async ({ id }) => {
    try { return textResult(await beeClient.getFact(id)); }
    catch (e) { return errorResult(e); }
  },
);

server.registerTool(
  "bee_conversations_list",
  {
    description: "List conversation summaries. Use conversations_get for full transcripts.",
    inputSchema: {
      limit: z.number().min(1).max(100).default(20),
      cursor: z.string().optional(),
    },
  },
  async ({ limit, cursor }) => {
    try { return textResult(await beeClient.listConversations(limit, cursor)); }
    catch (e) { return errorResult(e); }
  },
);

server.registerTool(
  "bee_conversation_get",
  {
    description: "Get a specific conversation with full utterances (source of truth).",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    try { return textResult(await beeClient.getConversation(id)); }
    catch (e) { return errorResult(e); }
  },
);

server.registerTool(
  "bee_todos_list",
  {
    description: "List todos extracted from conversations.",
    inputSchema: {
      limit: z.number().min(1).max(200).default(50),
      cursor: z.string().optional(),
    },
  },
  async ({ limit, cursor }) => {
    try { return textResult(await beeClient.listTodos(limit, cursor)); }
    catch (e) { return errorResult(e); }
  },
);

server.registerTool(
  "bee_daily",
  {
    description: "List daily summaries Bee has generated.",
    inputSchema: {
      limit: z.number().min(1).max(50).default(10),
      cursor: z.string().optional(),
    },
  },
  async ({ limit, cursor }) => {
    try { return textResult(await beeClient.listDaily(limit, cursor)); }
    catch (e) { return errorResult(e); }
  },
);

server.registerTool(
  "bee_search",
  {
    description: "Search Bee conversations by text. BM25 keyword search by default; pass neural=true for semantic search.",
    inputSchema: {
      query: z.string().min(1),
      limit: z.number().min(1).max(50).default(20),
      neural: z.boolean().default(false),
    },
  },
  async ({ query, limit, neural }) => {
    try { return textResult(await beeClient.searchConversations(query, limit, neural)); }
    catch (e) { return errorResult(e); }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[bee-ts] running on stdio");
}

main().catch((err) => {
  console.error("[bee-ts] fatal:", err);
  process.exit(1);
});
