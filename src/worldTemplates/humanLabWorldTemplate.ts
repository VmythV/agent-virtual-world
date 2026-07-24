import type {
  AgentAction,
  ApplyActionResult,
  NewWorldEvent,
  Observation,
  WorldEvent,
  WorldState,
  WorldTemplate,
} from "../core/types.js";

export interface HumanLabConfig {
  scenario: string;
  rounds: number;
  /** agentId -> the personality/role secretly assigned to that "person". */
  personas: Record<string, string>;
  observer?: string;
}

export interface HumanLabState extends WorldState {
  scenario: string;
  rounds: number;
  currentRound: number;
  participants: string[];
  personas: Record<string, string>;
  observer?: string;
  turnOrder: string[];
  turnIndex: number;
  summaryGiven: boolean;
}

/**
 * Human-experiment lab: each agent is a "person" secretly assigned a
 * personality, dropped into a scenario, and observed as they interact over
 * rounds. Composes the two earlier protocol extensions — the discussion
 * round structure plus werewolf-style per-agent private assignment: each
 * person knows only their own persona (persona.assigned, visibleTo them),
 * while the human "god" sees every persona (personas.assigned, visibleTo []
 * but still in the unfiltered log). An optional observer analyzes the
 * emergent dynamics at the end.
 */
export const humanLabWorldTemplate: WorldTemplate<HumanLabState> = {
  id: "human-lab",
  scheduling: "turn-based",

  createInitialState(config: Record<string, unknown>) {
    const cfg = config as unknown as HumanLabConfig;
    const participants = Object.keys(cfg.personas);
    const state: HumanLabState = {
      worldId: "",
      template: "human-lab",
      finished: false,
      scenario: cfg.scenario,
      rounds: cfg.rounds,
      currentRound: 1,
      participants,
      personas: cfg.personas,
      observer: cfg.observer,
      turnOrder: [...participants],
      turnIndex: 0,
      summaryGiven: false,
    };

    const events: NewWorldEvent[] = [
      {
        type: "world.created",
        payload: { scenario: cfg.scenario, participants, observer: cfg.observer, rounds: cfg.rounds },
        highlight: true,
      },
      // Full reveal for the god view only.
      { type: "personas.assigned", payload: { personas: cfg.personas }, visibleTo: [], highlight: true },
    ];
    for (const p of participants) {
      events.push({ type: "persona.assigned", actorId: p, payload: { persona: cfg.personas[p] }, visibleTo: [p] });
    }
    events.push({ type: "round.start", payload: { round: 1, totalRounds: cfg.rounds }, highlight: true });

    return { state, events };
  },

  nextActor(state: HumanLabState) {
    if (state.finished) return undefined;
    if (state.turnIndex < state.turnOrder.length) return state.turnOrder[state.turnIndex];
    if (state.observer && !state.summaryGiven) return state.observer;
    return undefined;
  },

  buildObservation(agentId: string, state: HumanLabState, history: WorldEvent[]): Observation {
    if (agentId === state.observer) {
      return {
        worldId: state.worldId,
        agentId,
        visibleState: {
          role: "observer",
          scenario: state.scenario,
          expectedActionType: "analyze",
          responseShape: "text",
        },
        history,
      };
    }

    return {
      worldId: state.worldId,
      agentId,
      visibleState: {
        role: "participant",
        scenario: state.scenario,
        round: state.currentRound,
        totalRounds: state.rounds,
        yourPersona: state.personas[agentId],
        expectedActionType: "speak",
        responseShape: "text",
      },
      history,
    };
  },

  applyAction(agentId: string, action: AgentAction, state: HumanLabState): ApplyActionResult {
    if (agentId === state.observer) {
      state.summaryGiven = true;
      state.finished = true;
      return {
        events: [{ type: "experiment.summary", actorId: agentId, payload: { text: action.payload.text }, highlight: true }],
      };
    }

    const text = typeof action.payload.text === "string" ? action.payload.text : "";
    const events: NewWorldEvent[] = [
      { type: "agent.speak", actorId: agentId, payload: { text, round: state.currentRound } },
    ];

    state.turnIndex += 1;
    if (state.turnIndex >= state.turnOrder.length) {
      if (state.currentRound >= state.rounds) {
        if (!state.observer) {
          state.finished = true;
          events.push({ type: "world.finished", payload: {}, highlight: true });
        }
      } else {
        state.currentRound += 1;
        state.turnIndex = 0;
        events.push({ type: "round.start", payload: { round: state.currentRound, totalRounds: state.rounds }, highlight: true });
      }
    }

    return { events };
  },

  isFinished(state: HumanLabState) {
    return state.finished;
  },
};
