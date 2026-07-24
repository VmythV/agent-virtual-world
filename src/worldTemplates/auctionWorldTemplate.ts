import type {
  AgentAction,
  ApplyActionResult,
  NewWorldEvent,
  Observation,
  WorldEvent,
  WorldState,
  WorldTemplate,
} from "../core/types.js";

export interface AuctionConfig {
  /** Items auctioned one per round, in order. */
  items: string[];
  /** Each bidder's private per-item valuation (same valuation reused for every item). */
  valuations: Record<string, number>;
  auctioneer?: string;
}

interface WonRecord {
  item: string;
  winner: string | null;
  price: number;
}

export interface AuctionState extends WorldState {
  items: string[];
  valuations: Record<string, number>;
  bidders: string[];
  auctioneer?: string;
  round: number; // index into items
  phase: "bidding" | "closing";
  bids: Record<string, number>;
  history: WonRecord[];
}

function highestBid(bids: Record<string, number>): { winner: string | null; price: number; second: number } {
  let winner: string | null = null;
  let price = -1;
  let second = 0;
  for (const [bidder, amount] of Object.entries(bids)) {
    if (amount > price) {
      second = price > 0 ? price : second;
      price = amount;
      winner = bidder;
    } else if (amount > second) {
      second = amount;
    }
  }
  return { winner: price > 0 ? winner : null, price: Math.max(0, price), second: Math.max(0, second) };
}

/**
 * Sealed-bid auction: for each item every bidder submits a private numeric
 * bid at the same time, then the highest bidder wins (first-price — they pay
 * their bid). Exercises the numeric action shape (responseShape "number"),
 * simultaneous hidden actions (nextActors batch + per-bid visibleTo so no
 * bidder sees another's sealed bid), and private information (each bidder
 * only knows their own valuation). The auctioneer/god sees everything.
 */
export const auctionWorldTemplate: WorldTemplate<AuctionState> = {
  id: "auction",
  scheduling: "turn-based",

  createInitialState(config: Record<string, unknown>) {
    const cfg = config as unknown as AuctionConfig;
    const bidders = Object.keys(cfg.valuations);
    const state: AuctionState = {
      worldId: "",
      template: "auction",
      finished: false,
      items: cfg.items,
      valuations: cfg.valuations,
      bidders,
      auctioneer: cfg.auctioneer,
      round: 0,
      phase: "bidding",
      bids: {},
      history: [],
    };

    const events: NewWorldEvent[] = [
      { type: "world.created", payload: { items: cfg.items, bidders, auctioneer: cfg.auctioneer }, highlight: true },
    ];
    // Each bidder's valuation is private to them (and to the god via the raw log).
    for (const b of bidders) {
      events.push({ type: "valuation.assigned", actorId: b, payload: { valuation: cfg.valuations[b] }, visibleTo: [b] });
    }
    events.push({ type: "item.up", payload: { item: cfg.items[0], round: 1, totalItems: cfg.items.length }, highlight: true });

    return { state, events };
  },

  nextActor(state: AuctionState) {
    return state.auctioneer; // only used if a batch isn't returned; auctioneer is a no-op here
  },

  nextActors(state: AuctionState) {
    if (state.finished || state.phase !== "bidding") return undefined;
    // All bidders submit sealed bids simultaneously.
    return state.bidders;
  },

  visibilityForActor(actorId: string) {
    // A bidder's "it's your turn to bid" is private so the sealed bids stay hidden.
    return [actorId];
  },

  buildObservation(agentId: string, state: AuctionState, history: WorldEvent[]): Observation {
    return {
      worldId: state.worldId,
      agentId,
      visibleState: {
        role: "bidder",
        currentItem: state.items[state.round],
        round: state.round + 1,
        totalItems: state.items.length,
        yourValuation: state.valuations[agentId],
        pastResults: state.history,
        expectedActionType: "bid",
        responseShape: "number",
      },
      history,
    };
  },

  applyAction(agentId: string, action: AgentAction, state: AuctionState): ApplyActionResult {
    const raw = typeof action.payload.amount === "number" ? action.payload.amount : 0;
    // A rational bidder never bids above their valuation; clamp for sanity.
    const bid = Math.max(0, Math.min(raw, state.valuations[agentId] ?? raw));
    state.bids[agentId] = bid;

    const events: NewWorldEvent[] = [
      { type: "bid.placed", actorId: agentId, payload: { item: state.items[state.round], amount: bid }, visibleTo: [agentId] },
    ];

    if (Object.keys(state.bids).length >= state.bidders.length) {
      const { winner, price } = highestBid(state.bids);
      state.history.push({ item: state.items[state.round], winner, price });
      events.push({
        type: "auction.result",
        payload: { item: state.items[state.round], winner, price, bids: { ...state.bids } },
        highlight: true,
      });

      state.bids = {};
      state.round += 1;
      if (state.round >= state.items.length) {
        state.finished = true;
        events.push({ type: "world.finished", payload: { results: state.history }, highlight: true });
      } else {
        events.push({
          type: "item.up",
          payload: { item: state.items[state.round], round: state.round + 1, totalItems: state.items.length },
          highlight: true,
        });
      }
    }

    return { events };
  },

  isFinished(state: AuctionState) {
    return state.finished;
  },
};
