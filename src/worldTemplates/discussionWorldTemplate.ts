import type {
  AgentAction,
  ApplyActionResult,
  NewWorldEvent,
  Observation,
  WorldEvent,
  WorldState,
  WorldTemplate,
} from "../core/types.js";

export interface DiscussionConfig {
  topic: string;
  rounds: number;
  participants: string[];
  moderator?: string;
}

export interface DiscussionState extends WorldState {
  topic: string;
  rounds: number;
  currentRound: number;
  participants: string[];
  moderator?: string;
  turnOrder: string[];
  turnIndex: number;
  summaryGiven: boolean;
}

/**
 * Same skeleton as debateWorldTemplate (turn-based, rounds, optional
 * closing role) but without adversarial sides: everyone speaks in the same
 * order each round, and the optional moderator gives a closing summary
 * instead of a win/lose verdict. Confirms the debate template's shape
 * generalizes rather than being debate-specific.
 */
export const discussionWorldTemplate: WorldTemplate<DiscussionState> = {
  id: "discussion",
  scheduling: "turn-based",

  createInitialState(config: Record<string, unknown>) {
    const cfg = config as unknown as DiscussionConfig;
    const state: DiscussionState = {
      worldId: "",
      template: "discussion",
      finished: false,
      topic: cfg.topic,
      rounds: cfg.rounds,
      currentRound: 1,
      participants: cfg.participants,
      moderator: cfg.moderator,
      turnOrder: [...cfg.participants],
      turnIndex: 0,
      summaryGiven: false,
    };

    const events: NewWorldEvent[] = [
      {
        type: "world.created",
        payload: { topic: cfg.topic, rounds: cfg.rounds, participants: cfg.participants, moderator: cfg.moderator },
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

  nextActor(state: DiscussionState) {
    if (state.finished) return undefined;
    if (state.turnIndex < state.turnOrder.length) {
      return state.turnOrder[state.turnIndex];
    }
    if (state.moderator && !state.summaryGiven) {
      return state.moderator;
    }
    return undefined;
  },

  buildObservation(agentId: string, state: DiscussionState, history: WorldEvent[]): Observation {
    const isModerator = agentId === state.moderator;
    return {
      worldId: state.worldId,
      agentId,
      visibleState: {
        topic: state.topic,
        round: state.currentRound,
        totalRounds: state.rounds,
        role: isModerator ? "moderator" : "participant",
        expectedActionType: isModerator ? "summarize" : "speak",
      },
      history,
    };
  },

  applyAction(agentId: string, action: AgentAction, state: DiscussionState): ApplyActionResult {
    if (agentId === state.moderator) {
      state.summaryGiven = true;
      state.finished = true;
      return {
        events: [
          {
            type: "discussion.summary",
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
        payload: { text: action.payload.text, round: state.currentRound },
      },
    ];

    state.turnIndex += 1;

    if (state.turnIndex >= state.turnOrder.length) {
      if (state.currentRound >= state.rounds) {
        if (!state.moderator) {
          state.finished = true;
          events.push({ type: "world.finished", payload: {}, highlight: true });
        }
        // else: leave state as-is, nextActor() will now route to the moderator.
      } else {
        state.currentRound += 1;
        state.turnIndex = 0;
        events.push({
          type: "round.start",
          payload: { round: state.currentRound, totalRounds: state.rounds },
          highlight: true,
        });
      }
    }

    return { events };
  },

  isFinished(state: DiscussionState) {
    return state.finished;
  },
};
