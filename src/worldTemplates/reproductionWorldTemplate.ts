import type {
  AgentAction,
  ApplyActionResult,
  NewWorldEvent,
  Observation,
  WorldEvent,
  WorldState,
  WorldTemplate,
} from "../core/types.js";

export interface ReproductionConfig {
  founders: string[];
  ticks?: number;
  field?: number;
  maxPopulation?: number;
}

interface Creature {
  id: string;
  x: number;
  z: number;
  energy: number;
  alive: boolean;
  behavior: string;
}

export interface ReproductionState extends WorldState {
  creatures: Creature[];
  field: number;
  tick: number;
  totalTicks: number;
  maxPopulation: number;
  nextId: number;
}

const DECISION_INTERVAL = 4;
const SPEED = 0.3;
const GRAZE_GAIN = 6;
const WANDER_GAIN = 2;
const DRAIN = 3;
const REPRODUCE_AT = 100;
const START_ENERGY = 50;

function noise(a: number, b: number): number {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return s - Math.floor(s);
}
const round = (n: number) => Math.round(n * 100) / 100;
const alive = (s: ReproductionState) => s.creatures.filter((c) => c.alive);

function snapshot(state: ReproductionState): NewWorldEvent {
  const living = alive(state);
  return {
    type: "world.tick",
    payload: {
      tick: state.tick,
      // Same shape the ecosystem view renders (type "prey" -> green dots).
      creatures: living.map((c) => ({ id: c.id, type: "prey", x: round(c.x), z: round(c.z), energy: round(c.energy) })),
      counts: { predators: 0, prey: living.length },
    },
  };
}

/**
 * Reproduction / population sim — the one thing needing a new engine
 * primitive: agents created at RUNTIME. Creatures graze for energy; at a
 * threshold they split into a new creature with a brand-new id (a fresh
 * agent that wasn't registered at world creation — it decides via the
 * scheduler's defaultAgent fallback), and starve to death at zero energy.
 * The population rises and falls until it's capped, goes extinct, or the
 * tick budget runs out.
 */
export const reproductionWorldTemplate: WorldTemplate<ReproductionState> = {
  id: "reproduction",
  scheduling: "tick-based",

  createInitialState(config: Record<string, unknown>) {
    const cfg = config as unknown as ReproductionConfig;
    const field = cfg.field ?? 12;
    const creatures: Creature[] = cfg.founders.map((id, i) => ({
      id,
      x: (noise(i, 1) - 0.5) * field * 0.6,
      z: (noise(i, 2) - 0.5) * field * 0.6,
      energy: START_ENERGY,
      alive: true,
      behavior: "graze",
    }));
    const state: ReproductionState = {
      worldId: "",
      template: "reproduction",
      finished: false,
      creatures,
      field,
      tick: 0,
      totalTicks: cfg.ticks ?? 80,
      maxPopulation: cfg.maxPopulation ?? 40,
      nextId: 1,
    };
    const events: NewWorldEvent[] = [
      { type: "world.created", payload: { founders: cfg.founders, field }, highlight: true },
      snapshot(state),
    ];
    return { state, events };
  },

  nextActor() {
    return undefined;
  },

  actorsForTick(state: ReproductionState) {
    return alive(state)
      .filter((_c, i) => state.tick % DECISION_INTERVAL === i % DECISION_INTERVAL)
      .map((c) => c.id);
  },

  buildObservation(agentId: string, state: ReproductionState, _history: WorldEvent[]): Observation {
    const self = state.creatures.find((c) => c.id === agentId)!;
    return {
      worldId: state.worldId,
      agentId,
      visibleState: {
        energy: round(self.energy),
        self: { x: round(self.x), z: round(self.z) },
        population: alive(state).length,
        expectedActionType: "behave",
        responseShape: "choice",
        choices: ["graze", "wander"],
      },
      history: [],
    };
  },

  applyAction(agentId: string, action: AgentAction, state: ReproductionState): ApplyActionResult {
    const c = state.creatures.find((cr) => cr.id === agentId);
    if (!c || !c.alive) return { events: [] };
    const target = action.payload.target;
    c.behavior = target === "wander" ? "wander" : "graze";
    return { events: [] };
  },

  advanceTick(state: ReproductionState): NewWorldEvent[] {
    const events: NewWorldEvent[] = [];
    const half = state.field / 2;

    // Food is finite: the fuller the field, the less each creature grazes.
    // This makes the population overshoot, starve back, and oscillate rather
    // than simply pinning at the cap — a livelier population curve.
    const crowding = alive(state).length / state.maxPopulation;
    const grazeGain = GRAZE_GAIN * (1 - crowding * 0.9);

    for (const c of alive(state)) {
      // Move a little; grazing gains more energy but you sit still-ish.
      const dx = noise(state.tick, c.x) - 0.5;
      const dz = noise(state.tick, c.z + 1) - 0.5;
      const speed = c.behavior === "graze" ? SPEED * 0.4 : SPEED;
      c.x = Math.max(-half, Math.min(half, c.x + dx * speed));
      c.z = Math.max(-half, Math.min(half, c.z + dz * speed));
      c.energy += (c.behavior === "graze" ? grazeGain : WANDER_GAIN) - DRAIN;
    }

    // Reproduction: split when well-fed and under the population cap.
    for (const c of alive(state)) {
      if (c.energy >= REPRODUCE_AT && alive(state).length < state.maxPopulation) {
        c.energy /= 2;
        const child: Creature = {
          id: `${c.id}-${state.nextId++}`,
          x: c.x + (noise(state.tick, state.nextId) - 0.5),
          z: c.z + (noise(state.tick, state.nextId + 1) - 0.5),
          energy: c.energy,
          alive: true,
          behavior: "graze",
        };
        state.creatures.push(child);
        events.push({ type: "birth.event", payload: { parent: c.id, child: child.id }, highlight: true });
      }
    }

    // Starvation.
    for (const c of alive(state)) {
      if (c.energy <= 0) {
        c.alive = false;
        events.push({ type: "death.event", payload: { id: c.id, cause: "starved" }, highlight: true });
      }
    }

    state.tick += 1;
    events.push(snapshot(state));

    const pop = alive(state).length;
    if (pop === 0 || state.tick >= state.totalTicks) {
      state.finished = true;
      events.push({ type: "world.finished", payload: { population: pop, ticks: state.tick, born: state.nextId - 1 }, highlight: true });
    }
    return events;
  },

  isFinished(state: ReproductionState) {
    return state.finished;
  },
};
