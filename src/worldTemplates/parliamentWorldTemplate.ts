import type {
  AgentAction,
  ApplyActionResult,
  NewWorldEvent,
  Observation,
  WorldEvent,
  WorldState,
  WorldTemplate,
} from "../core/types.js";

export interface ParliamentConfig {
  bill: string;
  members: string[];
  /** Optional private leaning per member ("yes"/"no"/free text), only that member sees it. */
  stances?: Record<string, string>;
  speaker?: string;
  rounds?: number;
}

type Phase = "caucus" | "vote";

export interface ParliamentState extends WorldState {
  bill: string;
  members: string[];
  stances: Record<string, string>;
  speaker?: string;
  rounds: number;
  round: number;
  phase: Phase;
  picks: Record<string, string>;
  votes: Record<string, string>;
  /** mutual bloc pairs as "a|b" keys */
  blocs: Set<string>;
}

const VOTE_CHOICES = ["yes", "no", "abstain"];

function blocKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

/**
 * Parliament — a reskin of the negotiation coalition game, re-themed as a
 * legislature. Over several caucus rounds each member privately whips one
 * other member (a `whip.offer` visible only to that pair); mutual picks form
 * voting blocs. Then everyone votes yes/no/abstain on the bill and it passes
 * on a simple majority of cast (non-abstain) votes. Members may hold a private
 * stance only they can see (reusing the same visibleTo hidden-info mechanism
 * as human-lab). No new engine capability — pure reskin.
 */
export const parliamentWorldTemplate: WorldTemplate<ParliamentState> = {
  id: "parliament",
  scheduling: "turn-based",

  createInitialState(config: Record<string, unknown>) {
    const cfg = config as unknown as ParliamentConfig;
    const stances = cfg.stances ?? {};
    const state: ParliamentState = {
      worldId: "",
      template: "parliament",
      finished: false,
      bill: cfg.bill,
      members: cfg.members,
      stances,
      speaker: cfg.speaker,
      rounds: cfg.rounds ?? 2,
      round: 1,
      phase: "caucus",
      picks: {},
      votes: {},
      blocs: new Set(),
    };
    const events: NewWorldEvent[] = [
      { type: "world.created", payload: { bill: cfg.bill, members: cfg.members, speaker: cfg.speaker }, highlight: true },
    ];
    // Each member's leaning is whispered only to them (god still sees it in the raw log).
    for (const [id, stance] of Object.entries(stances)) {
      if (stance.trim()) events.push({ type: "stance.assigned", actorId: id, payload: { stance: stance.trim() }, visibleTo: [id] });
    }
    events.push({ type: "phase.start", payload: { phase: "caucus", round: 1 }, highlight: true });
    return { state, events };
  },

  nextActor(state: ParliamentState) {
    return state.members[0];
  },

  nextActors(state: ParliamentState) {
    if (state.finished) return undefined;
    // Everyone acts at once and privately (sealed caucus / secret ballot).
    return state.members;
  },

  visibilityForActor(actorId: string) {
    return [actorId];
  },

  buildObservation(agentId: string, state: ParliamentState, history: WorldEvent[]): Observation {
    const others = state.members.filter((p) => p !== agentId);
    const myBlocs = [...state.blocs].filter((k) => k.split("|").includes(agentId));
    const stance = state.stances[agentId];
    if (state.phase === "caucus") {
      return {
        worldId: state.worldId,
        agentId,
        visibleState: {
          role: "legislator",
          bill: state.bill,
          yourStance: stance,
          round: state.round,
          totalRounds: state.rounds,
          yourBlocs: myBlocs,
          expectedActionType: "whip",
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
        role: "legislator",
        bill: state.bill,
        yourStance: stance,
        yourBlocs: myBlocs,
        expectedActionType: "vote",
        responseShape: "choice",
        choices: VOTE_CHOICES,
      },
      history,
    };
  },

  applyAction(agentId: string, action: AgentAction, state: ParliamentState): ApplyActionResult {
    const target = typeof action.payload.target === "string" ? action.payload.target : "";

    if (state.phase === "caucus") {
      const valid = state.members.filter((p) => p !== agentId);
      const pick = valid.includes(target) ? target : valid[0];
      state.picks[agentId] = pick;
      const events: NewWorldEvent[] = [
        { type: "whip.offer", actorId: agentId, payload: { to: pick }, visibleTo: [agentId, pick] },
      ];

      if (Object.keys(state.picks).length >= state.members.length) {
        for (const a of state.members) {
          const b = state.picks[a];
          if (b && state.picks[b] === a) {
            const key = blocKey(a, b);
            if (!state.blocs.has(key)) {
              state.blocs.add(key);
              events.push({ type: "bloc.formed", payload: { between: key.split("|") }, visibleTo: key.split("|") });
            }
          }
        }
        state.picks = {};
        if (state.round >= state.rounds) {
          state.phase = "vote";
          events.push({ type: "phase.start", payload: { phase: "vote" }, highlight: true });
        } else {
          state.round += 1;
          events.push({ type: "phase.start", payload: { phase: "caucus", round: state.round }, highlight: true });
        }
      }
      return { events };
    }

    // vote phase
    const vote = VOTE_CHOICES.includes(target) ? target : "abstain";
    state.votes[agentId] = vote;
    const events: NewWorldEvent[] = [{ type: "vote.cast", actorId: agentId, payload: { choice: vote }, visibleTo: [agentId] }];

    if (Object.keys(state.votes).length >= state.members.length) {
      const yes = Object.values(state.votes).filter((v) => v === "yes").length;
      const no = Object.values(state.votes).filter((v) => v === "no").length;
      const abstain = Object.values(state.votes).filter((v) => v === "abstain").length;
      const passed = yes > no;
      state.finished = true;
      events.push({
        type: "world.verdict",
        payload: {
          bill: state.bill,
          passed,
          tally: { yes, no, abstain },
          blocs: [...state.blocs].map((k) => k.split("|")),
          votes: { ...state.votes },
        },
        highlight: true,
      });
    }
    return { events };
  },

  isFinished(state: ParliamentState) {
    return state.finished;
  },
};
