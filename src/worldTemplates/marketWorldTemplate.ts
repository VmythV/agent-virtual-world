import type {
  AgentAction,
  ApplyActionResult,
  NewWorldEvent,
  Observation,
  WorldEvent,
  WorldState,
  WorldTemplate,
} from "../core/types.js";

export interface MarketConfig {
  good: string;
  buyers: Record<string, { cash: number; value: number }>;
  sellers: Record<string, { units: number; cost: number }>;
  rounds?: number;
}

interface Trader {
  id: string;
  type: "buyer" | "seller";
  cash: number;
  holdings: number;
  value: number; // buyer's private willingness-to-pay per unit
  cost: number; // seller's private cost per unit
}

export interface MarketState extends WorldState {
  good: string;
  traders: Trader[];
  rounds: number;
  round: number;
  orders: Record<string, number>;
  lastPrice: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function snapshot(state: MarketState): NewWorldEvent {
  return {
    type: "market.tick",
    payload: {
      round: state.round,
      clearingPrice: state.lastPrice,
      traders: state.traders.map((t) => ({ id: t.id, type: t.type, cash: round2(t.cash), holdings: t.holdings })),
    },
  };
}

/**
 * A double-auction market with price discovery. Each round every trader
 * submits a private numeric order (buyers bid, sellers ask — the numeric
 * action shape), the template matches highest bids to lowest asks and clears
 * trades at the midpoint, moving cash and units between persistent per-trader
 * balances. Over rounds the clearing price converges toward the competitive
 * price. Each trader only knows their own value/cost (private); the god sees
 * everything.
 */
export const marketWorldTemplate: WorldTemplate<MarketState> = {
  id: "market",
  scheduling: "turn-based",

  createInitialState(config: Record<string, unknown>) {
    const cfg = config as unknown as MarketConfig;
    const traders: Trader[] = [
      ...Object.entries(cfg.buyers).map(([id, b]) => ({ id, type: "buyer" as const, cash: b.cash, holdings: 0, value: b.value, cost: 0 })),
      ...Object.entries(cfg.sellers).map(([id, s]) => ({ id, type: "seller" as const, cash: 0, holdings: s.units, value: 0, cost: s.cost })),
    ];
    const state: MarketState = {
      worldId: "",
      template: "market",
      finished: false,
      good: cfg.good,
      traders,
      rounds: cfg.rounds ?? 4,
      round: 1,
      orders: {},
      lastPrice: 0,
    };

    const events: NewWorldEvent[] = [
      {
        type: "world.created",
        payload: { good: cfg.good, buyers: Object.keys(cfg.buyers), sellers: Object.keys(cfg.sellers) },
        highlight: true,
      },
    ];
    for (const t of traders) {
      events.push({
        type: "trader.assigned",
        actorId: t.id,
        payload: t.type === "buyer" ? { type: "buyer", value: t.value, cash: t.cash } : { type: "seller", cost: t.cost, units: t.holdings },
        visibleTo: [t.id],
      });
    }
    events.push({ type: "round.start", payload: { round: 1, totalRounds: state.rounds }, highlight: true });
    events.push(snapshot(state));

    return { state, events };
  },

  nextActor(state: MarketState) {
    return state.traders[0]?.id;
  },

  nextActors(state: MarketState) {
    if (state.finished) return undefined;
    // Everyone submits their order at once, privately (sealed).
    return state.traders.filter((t) => (t.type === "buyer" ? t.cash > 0 : t.holdings > 0)).map((t) => t.id);
  },

  visibilityForActor(actorId: string) {
    return [actorId];
  },

  buildObservation(agentId: string, state: MarketState, history: WorldEvent[]): Observation {
    const t = state.traders.find((x) => x.id === agentId)!;
    const base = {
      good: state.good,
      round: state.round,
      totalRounds: state.rounds,
      yourCash: round2(t.cash),
      yourHoldings: t.holdings,
      lastClearingPrice: state.lastPrice,
      responseShape: "number" as const,
    };
    return {
      worldId: state.worldId,
      agentId,
      visibleState:
        t.type === "buyer"
          ? { role: "buyer", ...base, yourValue: t.value, expectedActionType: "bid" }
          : { role: "seller", ...base, yourCost: t.cost, expectedActionType: "ask" },
      history,
    };
  },

  applyAction(agentId: string, action: AgentAction, state: MarketState): ApplyActionResult {
    const t = state.traders.find((x) => x.id === agentId);
    if (!t) return { events: [] };
    const raw = typeof action.payload.amount === "number" ? action.payload.amount : 0;
    // Buyers won't bid above value or beyond cash; sellers won't ask below cost.
    const order = t.type === "buyer" ? Math.max(0, Math.min(raw, t.value, t.cash)) : Math.max(raw, t.cost);
    state.orders[agentId] = order;

    const active = state.traders.filter((x) => (x.type === "buyer" ? x.cash > 0 : x.holdings > 0));
    if (Object.keys(state.orders).length < active.length) return { events: [] };

    // Match: highest bids to lowest asks, clear at the midpoint, one trade per trader/round.
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
      if (bid < ask) break; // no more profitable matches
      const price = round2((bid + ask) / 2);
      if (buyer.cash >= price && seller.holdings > 0) {
        buyer.cash -= price;
        buyer.holdings += 1;
        seller.cash += price;
        seller.holdings -= 1;
        state.lastPrice = price;
        events.push({ type: "trade.executed", payload: { buyer: buyer.id, seller: seller.id, price, good: state.good }, highlight: true });
      }
      bi += 1;
      si += 1;
    }

    state.orders = {};
    events.push(snapshot(state));

    if (state.round >= state.rounds) {
      state.finished = true;
      const wealth = state.traders
        .map((x) => ({ id: x.id, wealth: round2(x.cash + x.holdings * state.lastPrice) }))
        .sort((a, b) => b.wealth - a.wealth);
      events.push({ type: "world.finished", payload: { finalPrice: state.lastPrice, wealth }, highlight: true });
    } else {
      state.round += 1;
      events.push({ type: "round.start", payload: { round: state.round, totalRounds: state.rounds }, highlight: true });
    }
    return { events };
  },

  isFinished(state: MarketState) {
    return state.finished;
  },
};
