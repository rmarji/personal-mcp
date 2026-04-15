import { Agent, fetch as undiciFetch } from "undici";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const BEE_API_BASE =
  process.env.BEE_API_BASE ?? "https://app-api-developer.ce.bee.amazon.dev";
const BEE_TOKEN = process.env.BEE_API_TOKEN ?? "";

// Load the private Bee CA cert — required because Bee's API uses a private CA
// (not public Let's Encrypt) and Node won't trust it out of the box.
const CA_PATH = process.env.BEE_CA_PATH ?? resolve(__dirname, "../bee-ca.pem");
let caCert: string | null = null;
try {
  caCert = readFileSync(CA_PATH, "utf8");
} catch {
  console.error(`[bee-client] WARNING: CA cert not found at ${CA_PATH}`);
}

const dispatcher = new Agent({
  connect: caCert ? { ca: caCert } : undefined,
  headersTimeout: 30_000,
  bodyTimeout: 30_000,
});

async function beeFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!BEE_TOKEN) throw new Error("BEE_API_TOKEN is not set");
  const url = new URL(path, BEE_API_BASE);
  const res = await undiciFetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${BEE_TOKEN}`,
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
    // @ts-expect-error — undici adds this on Response init
    dispatcher,
  });
  return res as unknown as Response;
}

async function beeGet<T>(
  path: string,
  query?: Record<string, string | number | undefined>,
): Promise<T> {
  const url = new URL(path, BEE_API_BASE);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  const res = await beeFetch(url.pathname + url.search);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Bee API ${res.status} ${res.statusText} for ${path}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

async function beePost<T>(path: string, body: unknown): Promise<T> {
  const res = await beeFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bee API ${res.status} for ${path}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export interface BeeMe {
  id: number;
  first_name: string;
  last_name: string;
  timezone: string;
}

export interface BeeFact {
  id: number | string;
  text: string;
  confirmed?: boolean;
  created_at?: number | string;
  tags?: string[];
}

export interface BeeConversation {
  id: number | string;
  start_time: number | string;
  end_time?: number | string;
  summary?: string;
  utterances?: Array<{ speaker?: string; text: string; timestamp?: string }>;
}

export interface BeeTodo {
  id: number | string;
  text: string;
  completed?: boolean;
  alarm_at?: string | null;
  created_at?: number | string;
}

export const beeClient = {
  async me(): Promise<BeeMe> {
    return beeGet<BeeMe>("/v1/me");
  },

  async listFacts(limit = 100, cursor?: string) {
    return beeGet<{ facts: BeeFact[]; cursor?: string }>("/v1/facts", { limit, cursor });
  },

  async getFact(id: string | number) {
    return beeGet<BeeFact>(`/v1/facts/${id}`);
  },

  async listConversations(limit = 20, cursor?: string) {
    return beeGet<{ conversations: BeeConversation[]; cursor?: string }>(
      "/v1/conversations",
      { limit, cursor },
    );
  },

  async getConversation(id: string | number) {
    return beeGet<BeeConversation>(`/v1/conversations/${id}`);
  },

  async listTodos(limit = 50, cursor?: string) {
    return beeGet<{ todos: BeeTodo[]; cursor?: string }>("/v1/todos", { limit, cursor });
  },

  async listDaily(limit = 10, cursor?: string) {
    return beeGet<{ daily_summaries: unknown[]; cursor?: string }>("/v1/daily", { limit, cursor });
  },

  async listJournals(limit = 20, cursor?: string) {
    return beeGet<{ journals: unknown[]; cursor?: string }>("/v1/journals", { limit, cursor });
  },

  async now(hoursBack = 10, limit = 50) {
    const { conversations } = await this.listConversations(limit);
    const cutoffMs = Date.now() - hoursBack * 60 * 60 * 1000;
    const recent = (conversations ?? []).filter((c) => {
      const ts = typeof c.start_time === "number" ? c.start_time : Date.parse(String(c.start_time));
      return Number.isFinite(ts) && ts >= cutoffMs;
    });
    return { conversations: recent };
  },

  async searchConversations(query: string, limit = 20, neural = false) {
    const path = neural ? "/v1/search/conversations/neural" : "/v1/search/conversations";
    return beePost<{ results: unknown[] }>(path, { query, limit });
  },
};
