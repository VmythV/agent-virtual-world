import type {
  AgentAction,
  ApplyActionResult,
  NewWorldEvent,
  Observation,
  WorldEvent,
  WorldState,
  WorldTemplate,
} from "../core/types.js";

export interface PredictionMarketConfig {
  event: string;
  /** The truth the market is trying to price; YES contracts settle at 100 if true, else 0. Hidden from traders until resolution. */
  outcome: boolean;
  /** Traders who buy YES contracts (bet it happens); `belief` is their private probability 0..1. */
  buyers: Record<string, { cash: number; belief: number }>;
  /** Traders holding YES contracts they may sell; `belief` is their private probability 0..1. */
  sellers: Record<string, { shares: number; belief: number }>;
  rounds?: number;
}

interface Trader {
  id: string;
  type: "buyer" | "seller";
  cash: number;
  shares: number;
  belief: number; // private probability 0..1
}

export interface PredictionMarketState extends WorldState {
  event: string;
  outcome: boolean;
  traders: Trader[];
  rounds: number;
  round: number;
  orders: Record<string, number>;
  lastPrice: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const PAYOUT = 100; // a YES contract pays 100 if the event happens, 0 otherwise

function snapshot(state: PredictionMarketState): NewWorldEvent {
  return {
    type: "market.tick",
    payload: {
      round: state.round,
      // The clearing price of a YES contract is the market's implied probability.
      impliedProbability: round2(state.lastPrice / PAYOUT),
      clearingPrice: state.lastPrice,
      traders: state.traders.map((t) => ({ id: t.id, type: t.type, cash: round2(t.cash), shares: t.shares })),
    },
  };
}

/**
 * Prediction market — a reskin of the double-auction `market`, trading YES
 * contracts on a binary future event. Each round buyers bid and sellers ask a
 * price in 0..100 (the numeric action shape); matches clear at the midpoint
 * and the clearing price is read as the market's implied probability. Every
 * trader knows only their own private belief. When the rounds end the event
 * resolves — YES contracts settle at 100 if it happened, else 0 — and final
 * wealth reveals who priced the future best. No new engine capability.
 */
export const predictionMarketWorldTemplate: WorldTemplate<PredictionMarketState> = {
  id: "prediction-market",
  scheduling: "turn-based",

  createInitialState(config: Record<string, unknown>) {
    const cfg = config as unknown as PredictionMarketConfig;
    const traders: Trader[] = [
      ...Object.entries(cfg.buyers).map(([id, b]) => ({ id, type: "buyer" as const, cash: b.cash, shares: 0, belief: b.belief })),
      ...Object.entries(cfg.sellers).map(([id, s]) => ({ id, type: "seller" as const, cash: 0, shares: s.shares, belief: s.belief })),
    ];
    const state: PredictionMarketState = {
      worldId: "",
      template: "prediction-market",
      finished: false,
      event: cfg.event,
      outcome: cfg.outcome,
      traders,
      rounds: cfg.rounds ?? 4,
      round: 1,
      orders: {},
      lastPrice: PAYOUT / 2, // start at 50% implied probability
    };

    const events: NewWorldEvent[] = [
      {
        type: "world.created",
        // `event` is this template's distinctive key; `outcome` stays god-only.
        payload: { event: cfg.event, buyers: Object.keys(cfg.buyers), sellers: Object.keys(cfg.sellers) },
        highlight: true,
      },
      // The true outcome is visible only to the god (visibleTo: []), never to any trader.
      { type: "outcome.sealed", payload: { outcome: cfg.outcome }, visibleTo: [] },
    ];
    for (const t of traders) {
      events.push({
        type: "trader.assigned",
        actorId: t.id,
        payload: t.type === "buyer" ? { type: "buyer", belief: t.belief, cash: t.cash } : { type: "seller", belief: t.belief, shares: t.shares },
        visibleTo: [t.id],
      });
    }
    events.push({ type: "round.start", payload: { round: 1, totalRounds: state.rounds }, highlight: true });
    events.push(snapshot(state));

    return { state, events };
  },

  nextActor(state: PredictionMarketState) {
    return state.traders[0]?.id;
  },

  nextActors(state: PredictionMarketState) {
    if (state.finished) return undefined;
    return state.traders.filter((t) => (t.type === "buyer" ? t.cash > 0 : t.shares > 0)).map((t) => t.id);
  },

  visibilityForActor(actorId: string) {
    return [actorId];
  },

  buildObservation(agentId: string, state: PredictionMarketState, history: WorldEvent[]): Observation {
    const t = state.traders.find((x) => x.id === agentId)!;
    const base = {
      event: state.event,
      round: state.round,
      totalRounds: state.rounds,
      yourCash: round2(t.cash),
      yourShares: t.shares,
      yourBelief: t.belief,
      lastClearingPrice: state.lastPrice,
      impliedProbability: round2(state.lastPrice / PAYOUT),
      responseShape: "number" as const,
    };
    return {
      worldId: state.worldId,
      agentId,
      visibleState:
        t.type === "buyer"
          ? { role: "buyer", ...base, expectedActionType: "bid" }
          : { role: "seller", ...base, expectedActionType: "ask" },
      history,
    };
  },

  applyAction(agentId: string, action: AgentAction, state: PredictionMarketState): ApplyActionResult {
    const t = state.traders.find((x) => x.id === agentId);
    if (!t) return { events: [] };
    const raw = typeof action.payload.amount === "number" ? action.payload.amount : 0;
    // Clamp to the contract range; a buyer can't spend more cash than it has.
    const clamped = Math.max(0, Math.min(raw, PAYOUT));
    const order = t.type === "buyer" ? Math.min(clamped, t.cash) : clamped;
    state.orders[agentId] = order;

    const active = state.traders.filter((x) => (x.type === "buyer" ? x.cash > 0 : x.shares > 0));
    if (Object.keys(state.orders).length < active.length) return { events: [] };

    // Match highest bids to lowest asks, clear at the midpoint, one contract per trader/round.
    const events: NewWorldEvent[] = [];
    const buyers = state.traders.filter((x) => x.type === "buyer" && state.orders[x.id] !== undefined).sort((a, b) => state.orders[b.id] - state.orders[a.id]);
    const sellers = state.traders.filter((x) => x.type === "seller" && state.orders[x.id] !== undefined).sort((a, b) => state.orders[a.id] - state.orders[b.id]);

    let bi = 0;
    let si = 0;
    while (bi < buyers.length && si < sellers.length) {
      const buyer = buyers[bi];
      const seller = sellers[si];
      const bid = state.orders[buyer.id];
      const ask = state.orders[seller.id];
      if (bid < ask) break;
      const price = round2((bid + ask) / 2);
      if (buyer.cash >= price && seller.shares > 0) {
        buyer.cash -= price;
        buyer.shares += 1;
        seller.cash += price;
        seller.shares -= 1;
        state.lastPrice = price;
        events.push({ type: "trade.executed", payload: { buyer: buyer.id, seller: seller.id, price, impliedProbability: round2(price / PAYOUT) }, highlight: true });
      }
      bi += 1;
      si += 1;
    }

    state.orders = {};
    events.push(snapshot(state));

    if (state.round >= state.rounds) {
      state.finished = true;
      // Resolve the event: YES contracts settle at PAYOUT (true) or 0 (false).
      const settle = state.outcome ? PAYOUT : 0;
      const wealth = state.traders
        .map((x) => ({ id: x.id, belief: x.belief, wealth: round2(x.cash + x.shares * settle) }))
        .sort((a, b) => b.wealth - a.wealth);
      events.push({
        type: "world.finished",
        payload: {
          event: state.event,
          outcome: state.outcome,
          settlePrice: settle,
          finalImpliedProbability: round2(state.lastPrice / PAYOUT),
          wealth,
        },
        highlight: true,
      });
    } else {
      state.round += 1;
      events.push({ type: "round.start", payload: { round: state.round, totalRounds: state.rounds }, highlight: true });
    }
    return { events };
  },

  isFinished(state: PredictionMarketState) {
    return state.finished;
  },
};
