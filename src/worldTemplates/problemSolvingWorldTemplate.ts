import type {
  AgentAction,
  ApplyActionResult,
  NewWorldEvent,
  Observation,
  WorldEvent,
  WorldState,
  WorldTemplate,
} from "../core/types.js";

export interface ProblemSolvingConfig {
  problem: string;
  coordinator: string;
  experts: string[];
  maxConsultations?: number;
}

interface Consultation {
  expert: string;
  text: string;
}

type Phase = "routing" | "expert" | "answering";

export interface ProblemSolvingState extends WorldState {
  problem: string;
  coordinator: string;
  experts: string[];
  phase: Phase;
  currentExpert?: string;
  consultations: Consultation[];
  maxConsultations: number;
}

const FINALIZE = "FINALIZE";

/**
 * Tool-orchestration world (the "problem-solving" example): unlike the
 * spatial/peer templates, agents here are specialist tools coordinated by
 * a manager. The coordinator repeatedly routes to an expert (a choice
 * action) or decides to FINALIZE, then synthesizes a final answer. This is
 * where the original "world manager directs execution" idea lives — and it
 * composes with the god channel: a god instruction to the coordinator is a
 * high-level task it then delegates.
 */
export const problemSolvingWorldTemplate: WorldTemplate<ProblemSolvingState> = {
  id: "problem-solving",
  scheduling: "turn-based",

  createInitialState(config: Record<string, unknown>) {
    const cfg = config as unknown as ProblemSolvingConfig;
    const state: ProblemSolvingState = {
      worldId: "",
      template: "problem-solving",
      finished: false,
      problem: cfg.problem,
      coordinator: cfg.coordinator,
      experts: cfg.experts,
      phase: "routing",
      consultations: [],
      maxConsultations: cfg.maxConsultations ?? 8,
    };

    const events: NewWorldEvent[] = [
      {
        type: "world.created",
        payload: { problem: cfg.problem, coordinator: cfg.coordinator, experts: cfg.experts },
        highlight: true,
      },
    ];
    return { state, events };
  },

  nextActor(state: ProblemSolvingState) {
    if (state.finished) return undefined;
    if (state.phase === "expert") return state.currentExpert;
    return state.coordinator; // routing + answering are both the coordinator
  },

  buildObservation(agentId: string, state: ProblemSolvingState, history: WorldEvent[]): Observation {
    if (state.phase === "expert" && agentId === state.currentExpert) {
      return {
        worldId: state.worldId,
        agentId,
        visibleState: {
          role: "expert",
          problem: state.problem,
          priorConsultations: state.consultations,
          expectedActionType: "contribute",
          responseShape: "text",
        },
        history,
      };
    }

    if (state.phase === "answering") {
      return {
        worldId: state.worldId,
        agentId,
        visibleState: {
          role: "coordinator",
          problem: state.problem,
          consultations: state.consultations,
          expectedActionType: "answer",
          responseShape: "text",
        },
        history,
      };
    }

    // routing
    return {
      worldId: state.worldId,
      agentId,
      visibleState: {
        role: "coordinator",
        problem: state.problem,
        consultations: state.consultations,
        expectedActionType: "route",
        responseShape: "choice",
        choices: [...state.experts, FINALIZE],
      },
      history,
    };
  },

  applyAction(agentId: string, action: AgentAction, state: ProblemSolvingState): ApplyActionResult {
    if (state.phase === "expert" && agentId === state.currentExpert) {
      const text = typeof action.payload.text === "string" ? action.payload.text : "";
      state.consultations.push({ expert: agentId, text });
      state.phase = "routing";
      const finished = state.currentExpert;
      state.currentExpert = undefined;
      return { events: [{ type: "expert.contribution", actorId: finished, payload: { text } }] };
    }

    if (state.phase === "answering") {
      const text = typeof action.payload.text === "string" ? action.payload.text : "";
      state.finished = true;
      return { events: [{ type: "world.answer", actorId: agentId, payload: { text }, highlight: true }] };
    }

    // routing
    const target = typeof action.payload.target === "string" ? action.payload.target : FINALIZE;
    const forceFinalize = state.consultations.length >= state.maxConsultations;

    if (target === FINALIZE || forceFinalize || !state.experts.includes(target)) {
      state.phase = "answering";
      return {
        events: [
          {
            type: "coordinator.route",
            actorId: agentId,
            payload: { target: FINALIZE, text: "已收集足够信息，开始汇总最终解答。" },
          },
        ],
      };
    }

    state.currentExpert = target;
    state.phase = "expert";
    return {
      events: [
        {
          type: "coordinator.route",
          actorId: agentId,
          payload: { target, text: `请「${target}」来处理这道题的相关部分。` },
        },
      ],
    };
  },

  isFinished(state: ProblemSolvingState) {
    return state.finished;
  },
};
