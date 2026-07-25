import type {
  AgentAction,
  ApplyActionResult,
  NewWorldEvent,
  Observation,
  WorldEvent,
  WorldState,
  WorldTemplate,
} from "../core/types.js";

export interface ResearchConfig {
  question: string;
  researchers: string[];
  lead: string;
  rounds?: number;
}

type Phase = "research" | "synthesis";

export interface ResearchState extends WorldState {
  question: string;
  researchers: string[];
  lead: string;
  rounds: number;
  round: number;
  phase: Phase;
  turnIndex: number;
}

/**
 * Research world: several researcher agents investigate a question over a few
 * rounds — ideally using real tools (search/read/run), which is why this is
 * the first template meant to run CLI agents with tools ENABLED (the
 * claude-code preset's allowTools) rather than the default least-privilege
 * `--tools ""`. A lead then synthesizes their findings into an answer. The
 * template itself is plain turn-based; the new capability is the tool access.
 */
export const researchWorldTemplate: WorldTemplate<ResearchState> = {
  id: "research",
  scheduling: "turn-based",

  createInitialState(config: Record<string, unknown>) {
    const cfg = config as unknown as ResearchConfig;
    const state: ResearchState = {
      worldId: "",
      template: "research",
      finished: false,
      question: cfg.question,
      researchers: cfg.researchers,
      lead: cfg.lead,
      rounds: cfg.rounds ?? 1,
      round: 1,
      phase: "research",
      turnIndex: 0,
    };
    const events: NewWorldEvent[] = [
      { type: "world.created", payload: { question: cfg.question, researchers: cfg.researchers, lead: cfg.lead }, highlight: true },
      { type: "round.start", payload: { round: 1, totalRounds: cfg.rounds ?? 1 }, highlight: true },
    ];
    return { state, events };
  },

  nextActor(state: ResearchState) {
    if (state.finished) return undefined;
    if (state.phase === "research") return state.researchers[state.turnIndex];
    return state.lead;
  },

  buildObservation(agentId: string, state: ResearchState, history: WorldEvent[]): Observation {
    if (state.phase === "synthesis" && agentId === state.lead) {
      return {
        worldId: state.worldId,
        agentId,
        visibleState: { role: "lead", question: state.question, expectedActionType: "synthesize", responseShape: "text" },
        history,
      };
    }
    return {
      worldId: state.worldId,
      agentId,
      visibleState: {
        role: "researcher",
        question: state.question,
        round: state.round,
        totalRounds: state.rounds,
        expectedActionType: "investigate",
        responseShape: "text",
      },
      history,
    };
  },

  applyAction(agentId: string, action: AgentAction, state: ResearchState): ApplyActionResult {
    const text = typeof action.payload.text === "string" ? action.payload.text : "";

    if (state.phase === "research") {
      const events: NewWorldEvent[] = [{ type: "research.finding", actorId: agentId, payload: { text, round: state.round } }];
      state.turnIndex += 1;
      if (state.turnIndex >= state.researchers.length) {
        state.turnIndex = 0;
        if (state.round >= state.rounds) {
          state.phase = "synthesis";
          events.push({ type: "phase.start", payload: { phase: "synthesis" }, highlight: true });
        } else {
          state.round += 1;
          events.push({ type: "round.start", payload: { round: state.round, totalRounds: state.rounds }, highlight: true });
        }
      }
      return { events };
    }

    // synthesis
    state.finished = true;
    return { events: [{ type: "research.answer", actorId: agentId, payload: { text }, highlight: true }] };
  },

  isFinished(state: ResearchState) {
    return state.finished;
  },
};
