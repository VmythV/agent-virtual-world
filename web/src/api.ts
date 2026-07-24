import type { AgentConfig, StoredAgent, WorldSummary } from "./types";

async function handleJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => undefined);
  if (!res.ok) {
    const message = body && typeof body.error === "string" ? body.error : `request failed: ${res.status}`;
    throw new Error(message);
  }
  return body as T;
}

export async function fetchWorlds(): Promise<WorldSummary[]> {
  return handleJson(await fetch("/api/worlds"));
}

export async function listAgents(): Promise<StoredAgent[]> {
  return handleJson(await fetch("/api/agents"));
}

export async function createAgent(config: AgentConfig): Promise<StoredAgent> {
  return handleJson(
    await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    }),
  );
}

export async function updateAgent(id: string, config: AgentConfig): Promise<StoredAgent> {
  return handleJson(
    await fetch(`/api/agents/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    }),
  );
}

export async function deleteAgent(id: string): Promise<void> {
  const res = await fetch(`/api/agents/${id}`, { method: "DELETE" });
  if (res.ok || res.status === 204) return;
  const body = await res.json().catch(() => undefined);
  throw new Error((body && body.error) || `request failed: ${res.status}`);
}

export interface CreateWorldInput {
  template: string;
  agentIds: string[];
  config: Record<string, unknown>;
}

export async function createWorld(input: CreateWorldInput): Promise<WorldSummary> {
  return handleJson(
    await fetch("/api/worlds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}
