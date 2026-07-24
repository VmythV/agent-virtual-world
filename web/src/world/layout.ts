import type { WorldEvent } from "../types";

/**
 * Pure stage-layout logic — no Three.js/DOM imports, so it's unit-testable.
 * Each resolver derives avatar placements straight from the world.created
 * event's payload (and, for werewolf, roles.assigned), so the 3D view only
 * needs the event stream. resolveStageLayout dispatches by which keys are
 * present, keeping the whole thing event-driven.
 */

export type StageRole =
  | "pro"
  | "con"
  | "judge"
  | "other"
  | "werewolf"
  | "villager"
  | "seer"
  | "coordinator"
  | "expert"
  | "participant"
  | "observer"
  | "bidder"
  | "auctioneer";

export interface AgentPlacement {
  agentId: string;
  role: StageRole;
  position: [number, number, number];
}

/** Debate: pro/con face off on either side, judge upstage center. */
export function resolveDebateLayout(worldCreatedPayload: Record<string, unknown> | undefined): AgentPlacement[] {
  if (!worldCreatedPayload) return [];
  const sides = (worldCreatedPayload.sides as { pro?: string[]; con?: string[] } | undefined) ?? {};
  const judge = worldCreatedPayload.judge as string | undefined;
  const placements: AgentPlacement[] = [];

  (sides.pro ?? []).forEach((agentId, i) => {
    placements.push({ agentId, role: "pro", position: [-2.6, 0, -1 - i * 1.6] });
  });
  (sides.con ?? []).forEach((agentId, i) => {
    placements.push({ agentId, role: "con", position: [2.6, 0, -1 - i * 1.6] });
  });
  if (judge) {
    placements.push({ agentId: judge, role: "judge", position: [0, 0, -4.2] });
  }
  return placements;
}

/** Discussion: participants in a front semicircle, moderator upstage center. */
export function resolveDiscussionLayout(worldCreatedPayload: Record<string, unknown> | undefined): AgentPlacement[] {
  if (!worldCreatedPayload) return [];
  const participants = (worldCreatedPayload.participants as string[] | undefined) ?? [];
  const moderator = worldCreatedPayload.moderator as string | undefined;
  const placements: AgentPlacement[] = [];
  const radius = 3.2;

  participants.forEach((agentId, i) => {
    const spread = participants.length > 1 ? i / (participants.length - 1) - 0.5 : 0;
    const angle = spread * Math.PI * 0.8;
    placements.push({ agentId, role: "other", position: [Math.sin(angle) * radius, 0, -1.5 - Math.cos(angle) * radius * 0.5] });
  });
  if (moderator) {
    placements.push({ agentId: moderator, role: "judge", position: [0, 0, -4.6] });
  }
  return placements;
}

/** Problem-solving: coordinator upstage center, experts in a front row. */
export function resolveProblemLayout(worldCreatedPayload: Record<string, unknown> | undefined): AgentPlacement[] {
  if (!worldCreatedPayload) return [];
  const coordinator = worldCreatedPayload.coordinator as string | undefined;
  const experts = (worldCreatedPayload.experts as string[] | undefined) ?? [];
  const placements: AgentPlacement[] = [];

  experts.forEach((agentId, i) => {
    const spread = experts.length > 1 ? i / (experts.length - 1) - 0.5 : 0;
    placements.push({ agentId, role: "expert", position: [spread * 5, 0, -0.5] });
  });
  if (coordinator) {
    placements.push({ agentId: coordinator, role: "coordinator", position: [0, 0, -4.4] });
  }
  return placements;
}

/** Human-lab: participants in an indigo semicircle, observer upstage center. */
export function resolveHumanLabLayout(worldCreatedPayload: Record<string, unknown> | undefined): AgentPlacement[] {
  if (!worldCreatedPayload) return [];
  const participants = (worldCreatedPayload.participants as string[] | undefined) ?? [];
  const observer = worldCreatedPayload.observer as string | undefined;
  const placements: AgentPlacement[] = [];
  const radius = 3.2;

  participants.forEach((agentId, i) => {
    const spread = participants.length > 1 ? i / (participants.length - 1) - 0.5 : 0;
    const angle = spread * Math.PI * 0.8;
    placements.push({ agentId, role: "participant", position: [Math.sin(angle) * radius, 0, -1.5 - Math.cos(angle) * radius * 0.5] });
  });
  if (observer) {
    placements.push({ agentId: observer, role: "observer", position: [0, 0, -4.6] });
  }
  return placements;
}

/**
 * Werewolf: everyone stands in a circle (no "sides"). Colored by role for
 * the god view — role.assigned is per-player-private, but the public
 * roles.assigned event is still in the unfiltered log the frontend reads.
 */
export function resolveWerewolfLayout(
  worldCreatedPayload: Record<string, unknown> | undefined,
  rolesAssignedPayload: Record<string, unknown> | undefined,
): AgentPlacement[] {
  if (!worldCreatedPayload) return [];
  const players = (worldCreatedPayload.players as string[] | undefined) ?? [];
  const roles = (rolesAssignedPayload?.roles as Record<string, StageRole> | undefined) ?? {};
  const radius = 3.6;

  return players.map((agentId, i) => {
    const angle = (i / players.length) * Math.PI * 2;
    return { agentId, role: roles[agentId] ?? "other", position: [Math.sin(angle) * radius, 0, -2 - Math.cos(angle) * radius * 0.5] };
  });
}

/** Auction: bidders in a front row facing the auctioneer upstage center. */
export function resolveAuctionLayout(worldCreatedPayload: Record<string, unknown> | undefined): AgentPlacement[] {
  if (!worldCreatedPayload) return [];
  const bidders = (worldCreatedPayload.bidders as string[] | undefined) ?? [];
  const auctioneer = worldCreatedPayload.auctioneer as string | undefined;
  const placements: AgentPlacement[] = [];

  bidders.forEach((agentId, i) => {
    const spread = bidders.length > 1 ? i / (bidders.length - 1) - 0.5 : 0;
    placements.push({ agentId, role: "bidder", position: [spread * 5, 0, -0.5] });
  });
  if (auctioneer) {
    placements.push({ agentId: auctioneer, role: "auctioneer", position: [0, 0, -4.4] });
  }
  return placements;
}

/** Dispatches to the right layout by which keys are present — no template name needed. */
export function resolveStageLayout(history: WorldEvent[]): AgentPlacement[] {
  const created = history.find((e) => e.type === "world.created");
  if (!created) return [];
  if ("sides" in created.payload) return resolveDebateLayout(created.payload);
  // human-lab also has "participants", so check its distinctive "scenario" first.
  if ("scenario" in created.payload) return resolveHumanLabLayout(created.payload);
  if ("participants" in created.payload) return resolveDiscussionLayout(created.payload);
  if ("experts" in created.payload) return resolveProblemLayout(created.payload);
  if ("bidders" in created.payload) return resolveAuctionLayout(created.payload);
  if ("players" in created.payload) {
    const rolesEvent = history.find((e) => e.type === "roles.assigned");
    return resolveWerewolfLayout(created.payload, rolesEvent?.payload);
  }
  return [];
}
