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
}

export type WorldStatus = "running" | "finished" | "failed";

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
}
