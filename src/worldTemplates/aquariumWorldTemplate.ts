import type {
  AgentAction,
  ApplyActionResult,
  NewWorldEvent,
  Observation,
  WorldEvent,
  WorldState,
  WorldTemplate,
} from "../core/types.js";

export type FishBehavior = "cruise" | "wander" | "school" | "dart";
const BEHAVIORS: FishBehavior[] = ["cruise", "wander", "school", "dart"];

export interface TankSize {
  w: number;
  h: number;
  d: number;
}

export interface AquariumConfig {
  fish: string[];
  ticks?: number;
  tank?: TankSize;
}

interface FishState {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number; // heading in the XZ plane, radians
  vy: number; // vertical drift per tick
  behavior: FishBehavior;
}

export interface AquariumState extends WorldState {
  fish: FishState[];
  tank: TankSize;
  tick: number;
  totalTicks: number;
}

const DECISION_INTERVAL = 6;
const BASE_SPEED = 0.22;
const DART_SPEED = 0.45;

/** Deterministic 0..1 pseudo-random from two seeds — keeps the sim reproducible. */
function noise(a: number, b: number): number {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function snapshot(state: AquariumState): NewWorldEvent {
  return {
    type: "world.tick",
    payload: {
      tick: state.tick,
      fish: state.fish.map((f) => ({ id: f.id, x: round(f.x), y: round(f.y), z: round(f.z), yaw: round(f.yaw), behavior: f.behavior })),
    },
  };
}

export const aquariumWorldTemplate: WorldTemplate<AquariumState> = {
  id: "aquarium",
  scheduling: "tick-based",

  createInitialState(config: Record<string, unknown>) {
    const cfg = config as unknown as AquariumConfig;
    const tank = cfg.tank ?? { w: 10, h: 6, d: 8 };
    const fish: FishState[] = cfg.fish.map((id, i) => ({
      id,
      x: (noise(i, 1) - 0.5) * tank.w * 0.6,
      y: tank.h * (0.3 + noise(i, 2) * 0.4),
      z: (noise(i, 3) - 0.5) * tank.d * 0.6,
      yaw: noise(i, 4) * Math.PI * 2,
      vy: (noise(i, 5) - 0.5) * 0.1,
      behavior: "cruise",
    }));

    const state: AquariumState = {
      worldId: "",
      template: "aquarium",
      finished: false,
      fish,
      tank,
      tick: 0,
      totalTicks: cfg.ticks ?? 80,
    };

    const events: NewWorldEvent[] = [
      { type: "world.created", payload: { fish: cfg.fish, tank }, highlight: true },
      snapshot(state),
    ];
    return { state, events };
  },

  nextActor() {
    return undefined; // tick-based worlds are driven by actorsForTick/advanceTick
  },

  actorsForTick(state: AquariumState) {
    // Staggered so fish don't all re-decide on the same tick.
    return state.fish
      .filter((_f, i) => state.tick % DECISION_INTERVAL === i % DECISION_INTERVAL)
      .map((f) => f.id);
  },

  buildObservation(agentId: string, state: AquariumState, _history: WorldEvent[]): Observation {
    const self = state.fish.find((f) => f.id === agentId)!;
    const neighbors = state.fish
      .filter((f) => f.id !== agentId)
      .map((f) => ({ id: f.id, dx: round(f.x - self.x), dz: round(f.z - self.z), dist: round(Math.hypot(f.x - self.x, f.z - self.z)) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 3);

    return {
      worldId: state.worldId,
      agentId,
      visibleState: {
        tick: state.tick,
        self: { x: round(self.x), y: round(self.y), z: round(self.z) },
        nearby: neighbors,
        tank: state.tank,
        expectedActionType: "behave",
        responseShape: "choice",
        choices: BEHAVIORS,
      },
      history: [], // continuous sim — the compact visibleState is all a fish needs
    };
  },

  applyAction(agentId: string, action: AgentAction, state: AquariumState): ApplyActionResult {
    const fish = state.fish.find((f) => f.id === agentId);
    if (!fish) return { events: [] };
    const target = action.payload.target;
    fish.behavior = (typeof target === "string" && (BEHAVIORS as string[]).includes(target) ? target : "cruise") as FishBehavior;
    return { events: [{ type: "fish.behavior", actorId: agentId, payload: { behavior: fish.behavior } }] };
  },

  advanceTick(state: AquariumState): NewWorldEvent[] {
    const { tank } = state;
    const cx = tank.w / 2;
    const cz = tank.d / 2;

    // Centroid for schooling.
    const centroid = state.fish.reduce((acc, f) => ({ x: acc.x + f.x / state.fish.length, z: acc.z + f.z / state.fish.length }), { x: 0, z: 0 });

    for (let i = 0; i < state.fish.length; i++) {
      const f = state.fish[i];
      let speed = BASE_SPEED;

      switch (f.behavior) {
        case "wander":
          f.yaw += (noise(state.tick, i) - 0.5) * 0.6;
          break;
        case "school": {
          const desired = Math.atan2(centroid.x - f.x, centroid.z - f.z);
          f.yaw += clampTurn(angleDelta(f.yaw, desired), 0.25);
          break;
        }
        case "dart":
          speed = DART_SPEED;
          break;
        case "cruise":
        default:
          break;
      }

      f.x += Math.sin(f.yaw) * speed;
      f.z += Math.cos(f.yaw) * speed;
      f.y += f.vy;

      // Bounce off the tank walls by reflecting the heading / vertical drift.
      if (f.x > cx) { f.x = cx; f.yaw = -f.yaw; }
      if (f.x < -cx) { f.x = -cx; f.yaw = -f.yaw; }
      if (f.z > cz) { f.z = cz; f.yaw = Math.PI - f.yaw; }
      if (f.z < -cz) { f.z = -cz; f.yaw = Math.PI - f.yaw; }
      if (f.y > tank.h) { f.y = tank.h; f.vy = -Math.abs(f.vy); }
      if (f.y < 0.4) { f.y = 0.4; f.vy = Math.abs(f.vy); }
    }

    state.tick += 1;

    const events: NewWorldEvent[] = [snapshot(state)];
    if (state.tick >= state.totalTicks) {
      state.finished = true;
      events.push({ type: "world.finished", payload: { ticks: state.tick }, highlight: true });
    }
    return events;
  },

  isFinished(state: AquariumState) {
    return state.finished;
  },
};

function angleDelta(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function clampTurn(delta: number, max: number): number {
  return Math.max(-max, Math.min(max, delta));
}
