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

/** Sends a "god" instruction to one agent (or all agents when agentId is omitted). */
export async function sendInstruction(worldId: string, text: string, agentId?: string): Promise<void> {
  await handleJson(
    await fetch(`/api/worlds/${worldId}/instructions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, text }),
    }),
  );
}

export async function stopWorld(worldId: string): Promise<void> {
  await handleJson(await fetch(`/api/worlds/${worldId}/stop`, { method: "POST" }));
}

export async function deleteWorld(worldId: string): Promise<void> {
  const res = await fetch(`/api/worlds/${worldId}`, { method: "DELETE" });
  if (res.ok || res.status === 204) return;
  const body = await res.json().catch(() => undefined);
  throw new Error((body && body.error) || `request failed: ${res.status}`);
}

/** Submits a human-played seat's decision, unblocking its turn. */
export async function submitDecision(worldId: string, agentId: string, response: string): Promise<void> {
  await handleJson(
    await fetch(`/api/worlds/${worldId}/decisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, response }),
    }),
  );
}
