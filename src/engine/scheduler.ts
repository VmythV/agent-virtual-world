import type { EventLog } from "../core/eventLog.js";
import type { AgentAdapter, WorldEvent, WorldState, WorldTemplate } from "../core/types.js";

export interface RunWorldOptions<TState extends WorldState> {
  worldId: string;
  template: WorldTemplate<TState>;
  config: Record<string, unknown>;
  agents: Map<string, AgentAdapter>;
  eventLog: EventLog;
  /** Safety valve against a misbehaving template looping forever. */
  maxSteps?: number;
  /**
   * tick-based only: wall-clock delay between ticks. Without it a mock
   * simulation completes in milliseconds and there's nothing to watch
   * live; with it the WS streams tick snapshots at a human pace.
   */
  tickIntervalMs?: number;
}

/**
 * Drives a world to completion, persisting every event. Dispatches on the
 * template's scheduling mode: turn-based waits for one agent at a time;
 * tick-based advances a continuous simulation on a clock, letting agents
 * re-decide periodically.
 */
export async function runWorld<TState extends WorldState>(
  options: RunWorldOptions<TState>,
): Promise<WorldEvent[]> {
  const { worldId, template, config, eventLog } = options;

  const { state, events: initEvents } = template.createInitialState(config);
  state.worldId = worldId;

  const persisted: WorldEvent[] = initEvents.map((event) => eventLog.append(worldId, event));

  if (template.scheduling === "tick-based") {
    await runTickBased(options, state, persisted);
  } else {
    await runTurnBased(options, state, persisted);
  }

  return persisted;
}

async function runTurnBased<TState extends WorldState>(
  options: RunWorldOptions<TState>,
  state: TState,
  persisted: WorldEvent[],
): Promise<void> {
  const { worldId, template, agents, eventLog, maxSteps = 200 } = options;

  let steps = 0;
  while (!template.isFinished(state)) {
    if (steps >= maxSteps) {
      throw new Error(
        `runWorld: exceeded maxSteps (${maxSteps}) for world ${worldId} using template ${template.id}`,
      );
    }
    steps += 1;

    const actorId = template.nextActor(state);
    if (!actorId) {
      throw new Error(
        `runWorld: template ${template.id} is not finished but returned no next actor`,
      );
    }

    const agent = agents.get(actorId);
    if (!agent) {
      throw new Error(`runWorld: no agent adapter registered for actor "${actorId}"`);
    }

    // Emitted before the (possibly slow, real CLI/API) call so clients can
    // show "this agent is deciding now" instead of only seeing the result.
    // visibilityForActor lets games with hidden roles (werewolf) avoid
    // leaking whose turn it is during a private phase.
    const turnVisibleTo = template.visibilityForActor?.(actorId, state);
    persisted.push(
      eventLog.append(worldId, { type: "turn.started", actorId, payload: {}, visibleTo: turnVisibleTo }),
    );

    // Every template gets this filtering for free: an event is visible to
    // this actor unless it was tagged with a visibleTo list that excludes
    // them. REST/WS never apply this filter, so the human observer always
    // sees the raw, unredacted history regardless of what agents see.
    const history = eventLog.history(worldId).filter((e) => !e.visibleTo || e.visibleTo.includes(actorId));
    const observation = template.buildObservation(actorId, state, history);
    const action = await agent.act(observation);
    const { events } = template.applyAction(actorId, action, state);

    for (const event of events) {
      persisted.push(eventLog.append(worldId, event));
    }
  }
}

async function runTickBased<TState extends WorldState>(
  options: RunWorldOptions<TState>,
  state: TState,
  persisted: WorldEvent[],
): Promise<void> {
  const { worldId, template, agents, eventLog, maxSteps = 5000, tickIntervalMs = 0 } = options;

  if (!template.actorsForTick || !template.advanceTick) {
    throw new Error(`runWorld: tick-based template ${template.id} must implement actorsForTick + advanceTick`);
  }

  let ticks = 0;
  while (!template.isFinished(state)) {
    if (ticks >= maxSteps) {
      throw new Error(
        `runWorld: exceeded maxSteps (${maxSteps}) for tick-based world ${worldId} using template ${template.id}`,
      );
    }
    ticks += 1;

    // Gather this tick's decisions. Agents re-decide infrequently, so most
    // ticks have an empty actor list and are pure physics.
    for (const actorId of template.actorsForTick(state)) {
      const agent = agents.get(actorId);
      if (!agent) {
        throw new Error(`runWorld: no agent adapter registered for actor "${actorId}"`);
      }
      const history = eventLog.history(worldId).filter((e) => !e.visibleTo || e.visibleTo.includes(actorId));
      const observation = template.buildObservation(actorId, state, history);
      const action = await agent.act(observation);
      const { events } = template.applyAction(actorId, action, state);
      for (const event of events) {
        persisted.push(eventLog.append(worldId, event));
      }
    }

    for (const event of template.advanceTick(state)) {
      persisted.push(eventLog.append(worldId, event));
    }

    if (tickIntervalMs > 0 && !template.isFinished(state)) {
      await sleep(tickIntervalMs);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
