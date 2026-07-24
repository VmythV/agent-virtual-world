import type {
  AgentAction,
  ApplyActionResult,
  NewWorldEvent,
  Observation,
  WorldEvent,
  WorldState,
  WorldTemplate,
} from "../core/types.js";

export type DebateSide = "pro" | "con" | "judge";

export interface DebateConfig {
  topic: string;
  rounds: number;
  sides: {
    pro: string[];
    con: string[];
  };
  judge?: string;
}

export interface DebateState extends WorldState {
  topic: string;
  rounds: number;
  currentRound: number;
  sides: { pro: string[]; con: string[] };
  judge?: string;
  turnOrder: string[];
  turnIndex: number;
  verdictGiven: boolean;
}

function interleave(pro: string[], con: string[]): string[] {
  const order: string[] = [];
  const max = Math.max(pro.length, con.length);
  for (let i = 0; i < max; i += 1) {
    if (pro[i]) order.push(pro[i]);
    if (con[i]) order.push(con[i]);
  }
  return order;
}

function sideOf(agentId: string, state: DebateState): DebateSide | undefined {
  if (state.sides.pro.includes(agentId)) return "pro";
  if (state.sides.con.includes(agentId)) return "con";
  if (state.judge === agentId) return "judge";
  return undefined;
}

export const debateWorldTemplate: WorldTemplate<DebateState> = {
  id: "debate",
  scheduling: "turn-based",

  createInitialState(config: Record<string, unknown>) {
    const cfg = config as unknown as DebateConfig;
    const state: DebateState = {
      worldId: "",
      template: "debate",
      finished: false,
      topic: cfg.topic,
      rounds: cfg.rounds,
      currentRound: 1,
      sides: cfg.sides,
      judge: cfg.judge,
      turnOrder: interleave(cfg.sides.pro, cfg.sides.con),
      turnIndex: 0,
      verdictGiven: false,
    };

    const events: NewWorldEvent[] = [
      {
        type: "world.created",
        payload: { topic: cfg.topic, rounds: cfg.rounds, sides: cfg.sides, judge: cfg.judge },
        highlight: true,
      },
      {
        type: "round.start",
        payload: { round: 1, totalRounds: cfg.rounds },
        highlight: true,
      },
    ];

    return { state, events };
  },

  nextActor(state: DebateState) {
    if (state.finished) return undefined;
    if (state.turnIndex < state.turnOrder.length) {
      return state.turnOrder[state.turnIndex];
    }
    if (state.judge && !state.verdictGiven) {
      return state.judge;
    }
    return undefined;
  },

  buildObservation(agentId: string, state: DebateState, history: WorldEvent[]): Observation {
    const side = sideOf(agentId, state);
    return {
      worldId: state.worldId,
      agentId,
      visibleState: {
        topic: state.topic,
        round: state.currentRound,
        totalRounds: state.rounds,
        side,
        expectedActionType: side === "judge" ? "verdict" : "speak",
      },
      history,
    };
  },

  applyAction(agentId: string, action: AgentAction, state: DebateState): ApplyActionResult {
    const side = sideOf(agentId, state);

    if (side === "judge") {
      state.verdictGiven = true;
      state.finished = true;
      return {
        events: [
          {
            type: "world.verdict",
            actorId: agentId,
            payload: { text: action.payload.text },
            highlight: true,
          },
        ],
      };
    }

    const events: NewWorldEvent[] = [
      {
        type: "agent.speak",
        actorId: agentId,
        payload: { text: action.payload.text, side, round: state.currentRound },
      },
    ];

    state.turnIndex += 1;

    if (state.turnIndex >= state.turnOrder.length) {
      if (state.currentRound >= state.rounds) {
        if (!state.judge) {
          state.finished = true;
          events.push({ type: "world.finished", payload: {}, highlight: true });
        }
        // else: leave state as-is, nextActor() will now route to the judge.
      } else {
        state.currentRound += 1;
        state.turnIndex = 0;
        state.turnOrder = interleave(state.sides.pro, state.sides.con);
        events.push({
          type: "round.start",
          payload: { round: state.currentRound, totalRounds: state.rounds },
          highlight: true,
        });
      }
    }

    return { events };
  },

  isFinished(state: DebateState) {
    return state.finished;
  },
};
