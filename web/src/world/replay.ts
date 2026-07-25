import type { AgentVisualState, WorldEvent } from "../types";
import { resolveStageLayout, type AgentPlacement } from "./layout";

/**
 * Pure view-derivation logic — no Three.js/DOM imports, so it's
 * unit-testable. This is what makes replay "free": reconstructView folds
 * the event stream up to a cursor into the same shape live rendering uses.
 */

export interface TankSize {
  w: number;
  h: number;
  d: number;
}

export interface FishSnapshot {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  behavior: string;
}

export interface AquariumView {
  tank: TankSize;
  fish: FishSnapshot[];
  tick: number;
}

export interface CreatureSnapshot {
  id: string;
  type: "predator" | "prey";
  x: number;
  z: number;
  energy: number;
}

export interface EcosystemView {
  field: number;
  creatures: CreatureSnapshot[];
  tick: number;
  counts: { predators: number; prey: number };
}

export interface ShownView {
  aquarium?: AquariumView;
  ecosystem?: EcosystemView;
  placements: AgentPlacement[];
  agentStates: Record<string, AgentVisualState>;
  roundLabel?: string;
}

/** The aquarium's tank + the latest fish snapshot in `history` (undefined for non-aquarium worlds). */
export function aquariumFromHistory(history: WorldEvent[]): AquariumView | undefined {
  const created = history.find((e) => e.type === "world.created");
  if (!created || !("fish" in created.payload) || !("tank" in created.payload)) return undefined;
  const tank = created.payload.tank as TankSize;
  const lastTick = [...history].reverse().find((e) => e.type === "world.tick");
  const fish = (lastTick?.payload.fish as FishSnapshot[] | undefined) ?? [];
  const tick = (lastTick?.payload.tick as number | undefined) ?? 0;
  return { tank, fish, tick };
}

/** The ecosystem field + the latest creature snapshot in `history` (undefined for non-ecosystem worlds). */
export function ecosystemFromHistory(history: WorldEvent[]): EcosystemView | undefined {
  const created = history.find((e) => e.type === "world.created");
  if (!created || !("predators" in created.payload) || !("field" in created.payload)) return undefined;
  const field = created.payload.field as number;
  const lastTick = [...history].reverse().find((e) => e.type === "world.tick");
  const creatures = (lastTick?.payload.creatures as CreatureSnapshot[] | undefined) ?? [];
  const tick = (lastTick?.payload.tick as number | undefined) ?? 0;
  const counts = (lastTick?.payload.counts as { predators: number; prey: number } | undefined) ?? { predators: 0, prey: 0 };
  return { field, creatures, tick, counts };
}

/** Who's already been eliminated as of this history slice (werewolf). */
export function collectDeadAgentIds(history: WorldEvent[]): Set<string> {
  const dead = new Set<string>();
  for (const event of history) {
    if (event.type === "night.result" || event.type === "vote.result") {
      const victimId = (event.payload.victim ?? event.payload.eliminated) as string | null | undefined;
      if (victimId) dead.add(victimId);
    }
  }
  return dead;
}

const PHASE_LABELS: Record<string, string> = {
  night: "🌙 夜晚",
  "day-discuss": "☀️ 白天·讨论",
  "day-vote": "☀️ 白天·投票",
  testimony: "⚖️ 证人作证",
  argument: "⚖️ 控辩辩论",
  verdict: "⚖️ 宣判",
  alliance: "🤝 结盟",
  vote: "🗳️ 投票",
  investigate: "🔍 收集线索",
  solve: "🔓 解谜",
  synthesis: "🧩 汇总结论",
};

export function formatRoundLabel(event: WorldEvent): string {
  if (event.type === "phase.start") {
    const phase = event.payload.phase as string;
    const label = PHASE_LABELS[phase] ?? phase;
    return event.payload.round !== undefined ? `${label} · 第 ${event.payload.round} 轮` : label;
  }
  const total = event.payload.totalRounds;
  return `第 ${event.payload.round}${total ? ` / ${total}` : ""} 轮`;
}

/**
 * Folds events[0..cursor] into the same view shape live rendering uses —
 * aquarium tick snapshot, or stage placements/dead-agents/round-label with
 * the cursor event's actor frozen mid-thinking/speaking. Works for every
 * template because they all reduce to an event stream.
 */
export function reconstructView(events: WorldEvent[], cursor: number): ShownView {
  const upto = events.slice(0, cursor + 1);

  const aquarium = aquariumFromHistory(upto);
  const ecosystem = ecosystemFromHistory(upto);
  const placements = resolveStageLayout(upto);
  const dead = collectDeadAgentIds(upto);

  const agentStates: Record<string, AgentVisualState> = Object.fromEntries(
    placements.map((p) => [p.agentId, { state: "idle" as const, dead: dead.has(p.agentId) }]),
  );

  // Freeze the actor of the cursor event in its thinking/speaking pose so the
  // paused frame reads like that moment rather than an all-idle stage.
  const last = upto[upto.length - 1];
  if (last?.actorId && agentStates[last.actorId] && !dead.has(last.actorId)) {
    const text = typeof last.payload.text === "string" ? last.payload.text : undefined;
    if (last.type === "turn.started") agentStates[last.actorId] = { state: "thinking", dead: false };
    else if (text) agentStates[last.actorId] = { state: "speaking", text, dead: false };
  }

  const lastRound = [...upto].reverse().find((e) => e.type === "round.start" || e.type === "phase.start");
  const roundLabel = lastRound ? formatRoundLabel(lastRound) : undefined;

  return { aquarium, ecosystem, placements, agentStates, roundLabel };
}
