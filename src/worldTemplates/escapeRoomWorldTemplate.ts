import type {
  AgentAction,
  ApplyActionResult,
  NewWorldEvent,
  Observation,
  WorldEvent,
  WorldState,
  WorldTemplate,
} from "../core/types.js";

export interface EscapeRoomConfig {
  puzzle: string;
  solution: string;
  /** agentId -> the clue only that member can see until they share it. */
  clues: Record<string, string>;
  solver: string;
  rounds?: number;
}

type Phase = "investigate" | "solve";

export interface EscapeRoomState extends WorldState {
  puzzle: string;
  solution: string;
  members: string[];
  solver: string;
  clues: Record<string, string>;
  phase: Phase;
  round: number;
  rounds: number;
  turnIndex: number;
}

/**
 * Cooperative asymmetric-information puzzle (escape room): each member
 * privately holds a different clue (clue.assigned, visibleTo them), and no
 * one can solve it alone. They take turns sharing/reasoning over a few
 * rounds, then the solver submits an answer checked against the solution —
 * escape on success. The strongest use of the visibleTo hidden-info system
 * in a cooperative (not adversarial) setting; the god sees every clue.
 */
export const escapeRoomWorldTemplate: WorldTemplate<EscapeRoomState> = {
  id: "escape-room",
  scheduling: "turn-based",

  createInitialState(config: Record<string, unknown>) {
    const cfg = config as unknown as EscapeRoomConfig;
    const members = Object.keys(cfg.clues);
    const state: EscapeRoomState = {
      worldId: "",
      template: "escape-room",
      finished: false,
      puzzle: cfg.puzzle,
      solution: cfg.solution,
      members,
      solver: cfg.solver,
      clues: cfg.clues,
      phase: "investigate",
      round: 1,
      rounds: cfg.rounds ?? 1,
      turnIndex: 0,
    };

    const events: NewWorldEvent[] = [
      { type: "world.created", payload: { puzzle: cfg.puzzle, members, solver: cfg.solver }, highlight: true },
    ];
    for (const m of members) {
      events.push({ type: "clue.assigned", actorId: m, payload: { clue: cfg.clues[m] }, visibleTo: [m] });
    }
    events.push({ type: "phase.start", payload: { phase: "investigate", round: 1 }, highlight: true });
    return { state, events };
  },

  nextActor(state: EscapeRoomState) {
    if (state.finished) return undefined;
    if (state.phase === "investigate") return state.members[state.turnIndex];
    return state.solver;
  },

  buildObservation(agentId: string, state: EscapeRoomState, history: WorldEvent[]): Observation {
    if (state.phase === "solve" && agentId === state.solver) {
      return {
        worldId: state.worldId,
        agentId,
        visibleState: { role: "solver", puzzle: state.puzzle, expectedActionType: "solve", responseShape: "text" },
        history,
      };
    }
    return {
      worldId: state.worldId,
      agentId,
      visibleState: {
        role: agentId === state.solver ? "solver" : "member",
        puzzle: state.puzzle,
        yourClue: state.clues[agentId],
        round: state.round,
        totalRounds: state.rounds,
        expectedActionType: "share",
        responseShape: "text",
      },
      history,
    };
  },

  applyAction(agentId: string, action: AgentAction, state: EscapeRoomState): ApplyActionResult {
    const text = typeof action.payload.text === "string" ? action.payload.text : "";

    if (state.phase === "investigate") {
      const events: NewWorldEvent[] = [{ type: "clue.shared", actorId: agentId, payload: { text } }];
      state.turnIndex += 1;
      if (state.turnIndex >= state.members.length) {
        state.turnIndex = 0;
        if (state.round >= state.rounds) {
          state.phase = "solve";
          events.push({ type: "phase.start", payload: { phase: "solve" }, highlight: true });
        } else {
          state.round += 1;
          events.push({ type: "phase.start", payload: { phase: "investigate", round: state.round }, highlight: true });
        }
      }
      return { events };
    }

    // solve phase
    const success = text.toLowerCase().includes(state.solution.toLowerCase());
    state.finished = true;
    return {
      events: [
        { type: "escape.result", payload: { success, answer: text, solution: state.solution }, highlight: true },
        {
          type: "world.verdict",
          payload: { text: success ? `逃脱成功！答案是「${state.solution}」。` : `逃脱失败，正确答案是「${state.solution}」。`, success },
          highlight: true,
        },
      ],
    };
  },

  isFinished(state: EscapeRoomState) {
    return state.finished;
  },
};
