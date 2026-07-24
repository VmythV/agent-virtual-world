/**
 * Mirrors src/core/types.ts and src/core/worldStore.ts on the backend.
 * No shared package yet (MVP scope) — keep these in sync by hand.
 */

export interface WorldEvent {
  id: string;
  worldId: string;
  sequence: number;
  timestamp: string;
  type: string;
  actorId?: string;
  payload: Record<string, unknown>;
  highlight?: boolean;
  /** Present when this event was hidden from some/all agents' own Observation — the frontend always receives the full unfiltered log regardless (god view). */
  visibleTo?: string[];
}

export type WorldStatus = "running" | "finished" | "failed" | "stopped";

export interface WorldSummary {
  id: string;
  template: string;
  status: WorldStatus;
  agentIds: string[];
  createdAt: string;
  finishedAt?: string;
  error?: string;
}

export type WsMessage = { type: "history"; events: WorldEvent[] } | { type: "event"; event: WorldEvent };

/** Generic avatar state machine shared by every world template's 3D stage (docs/architecture.md §3.1). */
export type AvatarState = "idle" | "thinking" | "speaking";

export interface AgentVisualState {
  state: AvatarState;
  text?: string;
  dead?: boolean;
}

/** Mirrors src/core/agentConfig.ts. */
export type CliInvocationConfig =
  | { preset: "claude-code"; systemPrompt?: string; model?: string; maxBudgetUsd?: number; extraArgs?: string[] }
  | { preset: "custom"; command: string; args?: string[] };

export type AgentConfig =
  | { agentId: string; adapter: "api"; systemPrompt: string; model?: string }
  | { agentId: string; adapter: "mock"; responses: string[] }
  | { agentId: string; adapter: "cli"; cli: CliInvocationConfig };

/** Mirrors src/core/agentStore.ts. */
export interface StoredAgent {
  config: AgentConfig;
  createdAt: string;
  updatedAt: string;
}
