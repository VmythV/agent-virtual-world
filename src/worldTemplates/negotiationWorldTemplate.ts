import type {
  AgentAction,
  ApplyActionResult,
  NewWorldEvent,
  Observation,
  WorldEvent,
  WorldState,
  WorldTemplate,
} from "../core/types.js";

export interface NegotiationConfig {
  prize: string;
  players: string[];
  rounds?: number;
}

type Phase = "alliance" | "vote";

export interface NegotiationState extends WorldState {
  prize: string;
  players: string[];
  rounds: number;
  round: number;
  phase: Phase;
  picks: Record<string, string>;
  votes: Record<string, string>;
  /** undirected mutual pacts as "a|b" keys */
  pacts: Set<string>;
}

function pactKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

function tally(votes: Record<string, string>): { winner: string | null; counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  for (const v of Object.values(votes)) counts[v] = (counts[v] ?? 0) + 1;
  let winner: string | null = null;
  let max = 0;
  for (const v of Object.values(votes)) {
    if (counts[v] > max) {
      max = counts[v];
      winner = v;
    }
  }
  return { winner, counts };
}

/**
 * Coalition game: over several rounds every player simultaneously and
 * privately picks one other player to ally with (a `pact.offer` visible only
 * to that pair — directed agent-to-agent signalling, done purely with the
 * existing choice action + event visibility, no new engine capability).
 * Mutual picks become pacts. Finally everyone votes for who should take the
 * prize; allies tend to vote together, so coalitions decide the winner. The
 * verdict reveals the whole alliance graph.
 */
export const negotiationWorldTemplate: WorldTemplate<NegotiationState> = {
  id: "negotiation",
  scheduling: "turn-based",

  createInitialState(config: Record<string, unknown>) {
    const cfg = config as unknown as NegotiationConfig;
    const state: NegotiationState = {
      worldId: "",
      template: "negotiation",
      finished: false,
      prize: cfg.prize,
      players: cfg.players,
      rounds: cfg.rounds ?? 2,
      round: 1,
      phase: "alliance",
      picks: {},
      votes: {},
      pacts: new Set(),
    };
    const events: NewWorldEvent[] = [
      { type: "world.created", payload: { prize: cfg.prize, players: cfg.players }, highlight: true },
      { type: "phase.start", payload: { phase: "alliance", round: 1 }, highlight: true },
    ];
    return { state, events };
  },

  nextActor(state: NegotiationState) {
    return state.players[0];
  },

  nextActors(state: NegotiationState) {
    if (state.finished) return undefined;
    // Everyone acts at once and privately, so no one sees others' picks/votes this step.
    return state.players;
  },

  visibilityForActor(actorId: string) {
    return [actorId];
  },

  buildObservation(agentId: string, state: NegotiationState, history: WorldEvent[]): Observation {
    const others = state.players.filter((p) => p !== agentId);
    const myPacts = [...state.pacts].filter((k) => k.split("|").includes(agentId));
    if (state.phase === "alliance") {
      return {
        worldId: state.worldId,
        agentId,
        visibleState: {
          role: "player",
          prize: state.prize,
          round: state.round,
          totalRounds: state.rounds,
          yourPacts: myPacts,
          expectedActionType: "propose",
          responseShape: "choice",
          choices: others,
        },
        history,
      };
    }
    return {
      worldId: state.worldId,
      agentId,
      visibleState: {
        role: "player",
        prize: state.prize,
        yourPacts: myPacts,
        expectedActionType: "vote",
        responseShape: "choice",
        choices: state.players, // may vote for self or an ally
      },
      history,
    };
  },

  applyAction(agentId: string, action: AgentAction, state: NegotiationState): ApplyActionResult {
    const target = typeof action.payload.target === "string" ? action.payload.target : "";

    if (state.phase === "alliance") {
      const valid = state.players.filter((p) => p !== agentId);
      const pick = valid.includes(target) ? target : valid[0];
      state.picks[agentId] = pick;
      const events: NewWorldEvent[] = [
        { type: "pact.offer", actorId: agentId, payload: { to: pick }, visibleTo: [agentId, pick] },
      ];

      if (Object.keys(state.picks).length >= state.players.length) {
        // Resolve mutual picks into pacts.
        for (const a of state.players) {
          const b = state.picks[a];
          if (b && state.picks[b] === a) {
            const key = pactKey(a, b);
            if (!state.pacts.has(key)) {
              state.pacts.add(key);
              events.push({ type: "pact.formed", payload: { between: key.split("|") }, visibleTo: key.split("|") });
            }
          }
        }
        state.picks = {};
        if (state.round >= state.rounds) {
          state.phase = "vote";
          events.push({ type: "phase.start", payload: { phase: "vote" }, highlight: true });
        } else {
          state.round += 1;
          events.push({ type: "phase.start", payload: { phase: "alliance", round: state.round }, highlight: true });
        }
      }
      return { events };
    }

    // vote phase
    const vote = state.players.includes(target) ? target : agentId;
    state.votes[agentId] = vote;
    const events: NewWorldEvent[] = [{ type: "vote.cast", actorId: agentId, payload: { for: vote }, visibleTo: [agentId] }];

    if (Object.keys(state.votes).length >= state.players.length) {
      const { winner, counts } = tally(state.votes);
      state.finished = true;
      events.push({
        type: "world.verdict",
        payload: { winner, counts, pacts: [...state.pacts].map((k) => k.split("|")), votes: { ...state.votes } },
        highlight: true,
      });
    }
    return { events };
  },

  isFinished(state: NegotiationState) {
    return state.finished;
  },
};
