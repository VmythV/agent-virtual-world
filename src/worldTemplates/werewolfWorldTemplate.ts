import type {
  AgentAction,
  ApplyActionResult,
  NewWorldEvent,
  Observation,
  WorldEvent,
  WorldState,
  WorldTemplate,
} from "../core/types.js";

export type WerewolfRole = "werewolf" | "villager" | "seer";
export type WerewolfPhase = "night" | "day-discuss" | "day-vote";

export interface WerewolfConfig {
  players: string[];
  werewolves: string[];
  seer?: string;
  /** Safety valve against a stalemate that somehow never trips the win condition. */
  maxRounds?: number;
}

export interface WerewolfState extends WorldState {
  players: string[];
  roles: Record<string, WerewolfRole>;
  alive: Record<string, boolean>;
  phase: WerewolfPhase;
  round: number;
  maxRounds: number;
  turnOrder: string[];
  turnIndex: number;
  nightKillVotes: Record<string, string>;
  dayVotes: Record<string, string>;
  winner?: "werewolves" | "villagers";
}

function alivePlayers(state: WerewolfState): string[] {
  return state.players.filter((p) => state.alive[p]);
}

function werewolfIds(state: WerewolfState): string[] {
  return state.players.filter((p) => state.roles[p] === "werewolf");
}

function nightTurnOrder(state: WerewolfState): string[] {
  const wolves = alivePlayers(state).filter((p) => state.roles[p] === "werewolf");
  const seer = state.players.find((p) => state.roles[p] === "seer" && state.alive[p]);
  return seer ? [...wolves, seer] : wolves;
}

/** Majority target among the given votes; ties broken by submission order. */
function tally(votes: Record<string, string>): string | undefined {
  const counts = new Map<string, number>();
  for (const target of Object.values(votes)) {
    counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  let winner: string | undefined;
  let max = 0;
  for (const target of Object.values(votes)) {
    const count = counts.get(target) ?? 0;
    if (count > max) {
      max = count;
      winner = target;
    }
  }
  return winner;
}

function checkWinner(state: WerewolfState): "werewolves" | "villagers" | undefined {
  const wolves = alivePlayers(state).filter((p) => state.roles[p] === "werewolf").length;
  const others = alivePlayers(state).filter((p) => state.roles[p] !== "werewolf").length;
  if (wolves === 0) return "villagers";
  if (wolves >= others) return "werewolves";
  return undefined;
}

function resolveTarget(candidate: unknown, validChoices: string[]): string {
  if (typeof candidate === "string" && validChoices.includes(candidate)) return candidate;
  return validChoices[0];
}

export const werewolfWorldTemplate: WorldTemplate<WerewolfState> = {
  id: "werewolf",
  scheduling: "turn-based",

  createInitialState(config: Record<string, unknown>) {
    const cfg = config as unknown as WerewolfConfig;
    const roles: Record<string, WerewolfRole> = {};
    for (const p of cfg.players) roles[p] = "villager";
    for (const w of cfg.werewolves) roles[w] = "werewolf";
    if (cfg.seer) roles[cfg.seer] = "seer";

    const alive: Record<string, boolean> = {};
    for (const p of cfg.players) alive[p] = true;

    const state: WerewolfState = {
      worldId: "",
      template: "werewolf",
      finished: false,
      players: cfg.players,
      roles,
      alive,
      phase: "night",
      round: 1,
      maxRounds: cfg.maxRounds ?? 10,
      turnOrder: [],
      turnIndex: 0,
      nightKillVotes: {},
      dayVotes: {},
    };
    state.turnOrder = nightTurnOrder(state);

    const events: NewWorldEvent[] = [
      { type: "world.created", payload: { players: cfg.players }, highlight: true },
      // Full reveal for the human observer (REST/WS never filter by visibleTo);
      // visibleTo: [] hides it from every agent's own Observation.
      { type: "roles.assigned", payload: { roles }, visibleTo: [], highlight: true },
    ];
    for (const p of cfg.players) {
      const role = roles[p];
      events.push({
        type: "role.assigned",
        actorId: p,
        payload: role === "werewolf" ? { role, fellowWerewolves: cfg.werewolves.filter((w) => w !== p) } : { role },
        visibleTo: [p],
      });
    }
    events.push({ type: "phase.start", payload: { phase: "night", round: 1 }, highlight: true });

    return { state, events };
  },

  nextActor(state: WerewolfState) {
    if (state.winner) return undefined;
    return state.turnOrder[state.turnIndex];
  },

  nextActors(state: WerewolfState) {
    if (state.winner) return undefined;
    // Night actions and day-vote ballots are simultaneous + hidden: everyone
    // acts at once without seeing each other's choice this phase. (This also
    // fixes the sequential-reveal leak where a later voter could see earlier
    // votes.) Day discussion stays sequential so speakers hear prior points.
    if (state.phase === "night" || state.phase === "day-vote") {
      return state.turnOrder.slice(state.turnIndex);
    }
    return undefined;
  },

  visibilityForActor(actorId: string, state: WerewolfState) {
    if (state.phase !== "night") return undefined;
    const role = state.roles[actorId];
    if (role === "seer") return [actorId];
    if (role === "werewolf") return werewolfIds(state);
    return undefined;
  },

  buildObservation(agentId: string, state: WerewolfState, history: WorldEvent[]): Observation {
    const role = state.roles[agentId];
    const alive = alivePlayers(state);
    let expectedActionType = "speak";
    let responseShape: "text" | "choice" = "text";
    let choices: string[] | undefined;

    if (state.phase === "night" && role === "werewolf") {
      expectedActionType = "kill";
      responseShape = "choice";
      choices = alive.filter((p) => p !== agentId && state.roles[p] !== "werewolf");
    } else if (state.phase === "night" && role === "seer") {
      expectedActionType = "inspect";
      responseShape = "choice";
      choices = alive.filter((p) => p !== agentId);
    } else if (state.phase === "day-vote") {
      expectedActionType = "vote";
      responseShape = "choice";
      choices = alive.filter((p) => p !== agentId);
    }

    return {
      worldId: state.worldId,
      agentId,
      visibleState: {
        phase: state.phase,
        round: state.round,
        yourRole: role,
        alivePlayers: alive,
        expectedActionType,
        responseShape,
        choices,
      },
      history,
    };
  },

  applyAction(agentId: string, action: AgentAction, state: WerewolfState): ApplyActionResult {
    const role = state.roles[agentId];
    const events: NewWorldEvent[] = [];

    if (state.phase === "night") {
      if (role === "werewolf") {
        const choices = alivePlayers(state).filter((p) => p !== agentId && state.roles[p] !== "werewolf");
        const target = resolveTarget(action.payload.target, choices);
        state.nightKillVotes[agentId] = target;
        events.push({
          type: "night.action",
          actorId: agentId,
          payload: { kind: "kill", target },
          visibleTo: werewolfIds(state),
        });
      } else if (role === "seer") {
        const choices = alivePlayers(state).filter((p) => p !== agentId);
        const target = resolveTarget(action.payload.target, choices);
        events.push({
          type: "seer.result",
          actorId: agentId,
          payload: { target, role: state.roles[target] },
          visibleTo: [agentId],
        });
      }

      state.turnIndex += 1;
      if (state.turnIndex >= state.turnOrder.length) {
        const victim = tally(state.nightKillVotes);
        state.nightKillVotes = {};
        if (victim) {
          state.alive[victim] = false;
          events.push({ type: "night.result", payload: { victim }, highlight: true });
        } else {
          events.push({ type: "night.result", payload: { victim: null }, highlight: true });
        }

        const winner = checkWinner(state);
        if (winner) {
          finalize(state, winner, events);
        } else {
          state.phase = "day-discuss";
          state.turnOrder = alivePlayers(state);
          state.turnIndex = 0;
          events.push({ type: "phase.start", payload: { phase: "day-discuss", round: state.round }, highlight: true });
        }
      }
      return { events };
    }

    if (state.phase === "day-discuss") {
      const text = typeof action.payload.text === "string" ? action.payload.text : "";
      events.push({ type: "agent.speak", actorId: agentId, payload: { text, round: state.round } });

      state.turnIndex += 1;
      if (state.turnIndex >= state.turnOrder.length) {
        state.phase = "day-vote";
        state.turnOrder = alivePlayers(state);
        state.turnIndex = 0;
        events.push({ type: "phase.start", payload: { phase: "day-vote", round: state.round }, highlight: true });
      }
      return { events };
    }

    // day-vote
    const choices = alivePlayers(state).filter((p) => p !== agentId);
    const target = resolveTarget(action.payload.target, choices);
    state.dayVotes[agentId] = target;
    events.push({ type: "vote.cast", actorId: agentId, payload: { target } });

    state.turnIndex += 1;
    if (state.turnIndex >= state.turnOrder.length) {
      const eliminated = tally(state.dayVotes);
      const finalTally: Record<string, number> = {};
      for (const t of Object.values(state.dayVotes)) finalTally[t] = (finalTally[t] ?? 0) + 1;
      state.dayVotes = {};
      if (eliminated) {
        state.alive[eliminated] = false;
      }
      events.push({ type: "vote.result", payload: { eliminated: eliminated ?? null, tally: finalTally }, highlight: true });

      const winner = checkWinner(state);
      if (winner) {
        finalize(state, winner, events);
      } else if (state.round >= state.maxRounds) {
        finalize(state, "villagers", events, "达到最大轮次上限，游戏强制结束。");
      } else {
        state.round += 1;
        state.phase = "night";
        state.turnOrder = nightTurnOrder(state);
        state.turnIndex = 0;
        events.push({ type: "phase.start", payload: { phase: "night", round: state.round }, highlight: true });
      }
    }
    return { events };
  },

  isFinished(state: WerewolfState) {
    return state.finished;
  },
};

function finalize(
  state: WerewolfState,
  winner: "werewolves" | "villagers",
  events: NewWorldEvent[],
  note?: string,
): void {
  state.winner = winner;
  state.finished = true;
  const text = note ?? (winner === "werewolves" ? "狼人阵营获胜：狼人数量已不少于其他玩家。" : "村民阵营获胜：所有狼人都已出局。");
  events.push({ type: "world.verdict", payload: { text, winner }, highlight: true });
}
