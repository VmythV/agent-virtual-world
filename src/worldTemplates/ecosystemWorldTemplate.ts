import type {
  AgentAction,
  ApplyActionResult,
  NewWorldEvent,
  Observation,
  WorldEvent,
  WorldState,
  WorldTemplate,
} from "../core/types.js";

export type CreatureType = "predator" | "prey";

export interface EcosystemConfig {
  predators: string[];
  prey: string[];
  ticks?: number;
  field?: number; // square field side length
}

interface Creature {
  id: string;
  type: CreatureType;
  x: number;
  z: number;
  energy: number;
  alive: boolean;
  behavior: string;
}

export interface EcosystemState extends WorldState {
  creatures: Creature[];
  field: number;
  tick: number;
  totalTicks: number;
}

const DECISION_INTERVAL = 5;
const PREDATOR_SPEED = 0.34;
const PREY_SPEED = 0.28;
const CATCH_RADIUS = 0.7;
const PREDATOR_DRAIN = 1;
const EAT_GAIN = 45;

function noise(a: number, b: number): number {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return s - Math.floor(s);
}
const round = (n: number) => Math.round(n * 100) / 100;

function alive(state: EcosystemState, type?: CreatureType): Creature[] {
  return state.creatures.filter((c) => c.alive && (!type || c.type === type));
}

function nearest(from: Creature, candidates: Creature[]): Creature | undefined {
  let best: Creature | undefined;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = Math.hypot(c.x - from.x, c.z - from.z);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

function snapshot(state: EcosystemState): NewWorldEvent {
  return {
    type: "world.tick",
    payload: {
      tick: state.tick,
      creatures: alive(state).map((c) => ({ id: c.id, type: c.type, x: round(c.x), z: round(c.z), energy: round(c.energy) })),
      counts: { predators: alive(state, "predator").length, prey: alive(state, "prey").length },
    },
  };
}

/**
 * Predator-prey ecosystem — the aquarium's tick engine pushed to a sim with
 * interaction consequences: predators chase and eat prey (gaining energy),
 * prey flee, predators starve without food, and the run ends when one side
 * is gone. Creatures re-decide a behavior on a staggered schedule; the rest
 * is deterministic physics. Shows tick-based scheduling doing more than idle
 * motion.
 */
export const ecosystemWorldTemplate: WorldTemplate<EcosystemState> = {
  id: "ecosystem",
  scheduling: "tick-based",

  createInitialState(config: Record<string, unknown>) {
    const cfg = config as unknown as EcosystemConfig;
    const field = cfg.field ?? 12;
    const place = (ids: string[], type: CreatureType, energy: number): Creature[] =>
      ids.map((id, i) => ({
        id,
        type,
        x: (noise(i, type === "predator" ? 1 : 5) - 0.5) * field * 0.7,
        z: (noise(i, type === "predator" ? 2 : 6) - 0.5) * field * 0.7,
        energy,
        alive: true,
        behavior: type === "predator" ? "hunt" : "flee",
      }));

    const state: EcosystemState = {
      worldId: "",
      template: "ecosystem",
      finished: false,
      creatures: [...place(cfg.predators, "predator", 80), ...place(cfg.prey, "prey", 100)],
      field,
      tick: 0,
      totalTicks: cfg.ticks ?? 60,
    };

    const events: NewWorldEvent[] = [
      { type: "world.created", payload: { predators: cfg.predators, prey: cfg.prey, field }, highlight: true },
      snapshot(state),
    ];
    return { state, events };
  },

  nextActor() {
    return undefined;
  },

  actorsForTick(state: EcosystemState) {
    return alive(state)
      .filter((_c, i) => state.tick % DECISION_INTERVAL === i % DECISION_INTERVAL)
      .map((c) => c.id);
  },

  buildObservation(agentId: string, state: EcosystemState, _history: WorldEvent[]): Observation {
    const self = state.creatures.find((c) => c.id === agentId)!;
    const foes = self.type === "predator" ? alive(state, "prey") : alive(state, "predator");
    const target = nearest(self, foes);
    const choices = self.type === "predator" ? ["hunt", "wander"] : ["flee", "graze", "wander"];
    return {
      worldId: state.worldId,
      agentId,
      visibleState: {
        type: self.type,
        energy: round(self.energy),
        self: { x: round(self.x), z: round(self.z) },
        nearestFoe: target ? { id: target.id, dist: round(Math.hypot(target.x - self.x, target.z - self.z)) } : null,
        expectedActionType: "behave",
        responseShape: "choice",
        choices,
      },
      history: [],
    };
  },

  applyAction(agentId: string, action: AgentAction, state: EcosystemState): ApplyActionResult {
    const c = state.creatures.find((cr) => cr.id === agentId);
    if (!c || !c.alive) return { events: [] };
    const valid = c.type === "predator" ? ["hunt", "wander"] : ["flee", "graze", "wander"];
    const target = action.payload.target;
    c.behavior = typeof target === "string" && valid.includes(target) ? target : valid[0];
    return { events: [] };
  },

  advanceTick(state: EcosystemState): NewWorldEvent[] {
    const events: NewWorldEvent[] = [];
    const half = state.field / 2;

    for (const c of alive(state)) {
      const speed = c.type === "predator" ? PREDATOR_SPEED : PREY_SPEED;
      let dx = 0;
      let dz = 0;
      const foes = c.type === "predator" ? alive(state, "prey") : alive(state, "predator");
      const foe = nearest(c, foes);

      if (c.behavior === "hunt" && foe) {
        dx = foe.x - c.x;
        dz = foe.z - c.z;
      } else if (c.behavior === "flee" && foe) {
        dx = c.x - foe.x;
        dz = c.z - foe.z;
      } else {
        // wander / graze
        dx = noise(state.tick, c.x) - 0.5;
        dz = noise(state.tick, c.z + 1) - 0.5;
      }
      const len = Math.hypot(dx, dz) || 1;
      c.x += (dx / len) * speed;
      c.z += (dz / len) * speed;
      c.x = Math.max(-half, Math.min(half, c.x));
      c.z = Math.max(-half, Math.min(half, c.z));

      if (c.type === "predator") c.energy -= PREDATOR_DRAIN;
    }

    // Resolve catches: a predator adjacent to a prey eats it.
    for (const pred of alive(state, "predator")) {
      const victim = alive(state, "prey").find((p) => Math.hypot(p.x - pred.x, p.z - pred.z) <= CATCH_RADIUS);
      if (victim) {
        victim.alive = false;
        pred.energy += EAT_GAIN;
        events.push({ type: "eat.event", actorId: pred.id, payload: { prey: victim.id }, highlight: true });
        events.push({ type: "death.event", payload: { id: victim.id, cause: "eaten" }, highlight: true });
      }
    }
    // Starvation.
    for (const pred of alive(state, "predator")) {
      if (pred.energy <= 0) {
        pred.alive = false;
        events.push({ type: "death.event", payload: { id: pred.id, cause: "starved" }, highlight: true });
      }
    }

    state.tick += 1;
    events.push(snapshot(state));

    const predators = alive(state, "predator").length;
    const prey = alive(state, "prey").length;
    if (predators === 0 || prey === 0 || state.tick >= state.totalTicks) {
      state.finished = true;
      const winner = prey === 0 ? "predators" : predators === 0 ? "prey" : "balance";
      events.push({ type: "world.finished", payload: { winner, predators, prey, ticks: state.tick }, highlight: true });
    }
    return events;
  },

  isFinished(state: EcosystemState) {
    return state.finished;
  },
};
