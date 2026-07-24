import type {
  AgentAction,
  ApplyActionResult,
  NewWorldEvent,
  Observation,
  WorldEvent,
  WorldState,
  WorldTemplate,
} from "../core/types.js";

export interface CourtroomConfig {
  caseTitle: string;
  prosecutor: string;
  defense: string;
  judge: string;
  /** agentId -> the secret fact only that witness knows until they testify. */
  witnesses?: Record<string, string>;
  rounds?: number;
}

type Phase = "testimony" | "argument" | "verdict";

export interface CourtroomState extends WorldState {
  caseTitle: string;
  prosecutor: string;
  defense: string;
  judge: string;
  witnesses: string[];
  knowledge: Record<string, string>;
  phase: Phase;
  witnessIndex: number;
  argIndex: number;
  rounds: number;
  finishedFlag: boolean;
}

/**
 * Courtroom: witnesses first testify (each revealing a fact only they knew —
 * a per-agent private assignment, like a werewolf role, that becomes public
 * once spoken), then prosecutor and defense argue in alternating rounds, and
 * the judge delivers a verdict. Reuses the turn-based engine + hidden-info
 * protocol + a final verdict; no new engine capability needed.
 */
export const courtroomWorldTemplate: WorldTemplate<CourtroomState> = {
  id: "courtroom",
  scheduling: "turn-based",

  createInitialState(config: Record<string, unknown>) {
    const cfg = config as unknown as CourtroomConfig;
    const knowledge = cfg.witnesses ?? {};
    const witnesses = Object.keys(knowledge);
    const state: CourtroomState = {
      worldId: "",
      template: "courtroom",
      finished: false,
      caseTitle: cfg.caseTitle,
      prosecutor: cfg.prosecutor,
      defense: cfg.defense,
      judge: cfg.judge,
      witnesses,
      knowledge,
      phase: witnesses.length > 0 ? "testimony" : "argument",
      witnessIndex: 0,
      argIndex: 0,
      rounds: cfg.rounds ?? 2,
      finishedFlag: false,
    };

    const events: NewWorldEvent[] = [
      {
        type: "world.created",
        payload: { caseTitle: cfg.caseTitle, prosecutor: cfg.prosecutor, defense: cfg.defense, judge: cfg.judge, witnesses },
        highlight: true,
      },
    ];
    // Each witness privately knows a fact until they take the stand.
    for (const w of witnesses) {
      events.push({ type: "knowledge.assigned", actorId: w, payload: { knows: knowledge[w] }, visibleTo: [w] });
    }
    events.push({ type: "phase.start", payload: { phase: state.phase }, highlight: true });

    return { state, events };
  },

  nextActor(state: CourtroomState) {
    if (state.finished) return undefined;
    if (state.phase === "testimony") return state.witnesses[state.witnessIndex];
    if (state.phase === "argument") return state.argIndex % 2 === 0 ? state.prosecutor : state.defense;
    return state.judge;
  },

  buildObservation(agentId: string, state: CourtroomState, history: WorldEvent[]): Observation {
    if (state.phase === "testimony" && agentId === state.witnesses[state.witnessIndex]) {
      return {
        worldId: state.worldId,
        agentId,
        visibleState: {
          role: "witness",
          caseTitle: state.caseTitle,
          youKnow: state.knowledge[agentId],
          expectedActionType: "testify",
          responseShape: "text",
        },
        history,
      };
    }
    if (state.phase === "verdict") {
      return {
        worldId: state.worldId,
        agentId,
        visibleState: { role: "judge", caseTitle: state.caseTitle, expectedActionType: "verdict", responseShape: "text" },
        history,
      };
    }
    const side = agentId === state.prosecutor ? "prosecution" : "defense";
    return {
      worldId: state.worldId,
      agentId,
      visibleState: {
        role: side,
        caseTitle: state.caseTitle,
        round: Math.floor(state.argIndex / 2) + 1,
        totalRounds: state.rounds,
        expectedActionType: "argue",
        responseShape: "text",
      },
      history,
    };
  },

  applyAction(agentId: string, action: AgentAction, state: CourtroomState): ApplyActionResult {
    const text = typeof action.payload.text === "string" ? action.payload.text : "";

    if (state.phase === "testimony") {
      state.witnessIndex += 1;
      const events: NewWorldEvent[] = [{ type: "testimony", actorId: agentId, payload: { text }, highlight: true }];
      if (state.witnessIndex >= state.witnesses.length) {
        state.phase = "argument";
        events.push({ type: "phase.start", payload: { phase: "argument" }, highlight: true });
      }
      return { events };
    }

    if (state.phase === "argument") {
      const side = agentId === state.prosecutor ? "prosecution" : "defense";
      state.argIndex += 1;
      const events: NewWorldEvent[] = [{ type: "agent.speak", actorId: agentId, payload: { text, side } }];
      if (state.argIndex >= state.rounds * 2) {
        state.phase = "verdict";
        events.push({ type: "phase.start", payload: { phase: "verdict" }, highlight: true });
      }
      return { events };
    }

    // verdict
    state.finished = true;
    return { events: [{ type: "world.verdict", actorId: agentId, payload: { text }, highlight: true }] };
  },

  isFinished(state: CourtroomState) {
    return state.finished;
  },
};
