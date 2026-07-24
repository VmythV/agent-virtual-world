import type { EventLog } from "../core/eventLog.js";
import type { AgentAdapter, Observation, WorldEvent, WorldState, WorldTemplate } from "../core/types.js";

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
  /**
   * Cooperative cancellation: when aborted, the loop stops cleanly between
   * steps and runWorld resolves. The caller can then mark the world stopped.
   */
  signal?: AbortSignal;
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
  const { worldId, template, signal, maxSteps = 200 } = options;
  const deliveredInstructions = new Set<string>();

  let steps = 0;
  while (!template.isFinished(state)) {
    if (signal?.aborted) return;
    if (steps >= maxSteps) {
      throw new Error(
        `runWorld: exceeded maxSteps (${maxSteps}) for world ${worldId} using template ${template.id}`,
      );
    }
    steps += 1;

    // A template may declare a batch of agents that decide simultaneously
    // this step (e.g. all voters). Otherwise fall back to the single next
    // actor.
    const batch = template.nextActors?.(state)?.filter(Boolean) as string[] | undefined;
    let actorIds: string[];
    if (batch && batch.length > 0) {
      actorIds = batch;
    } else {
      const single = template.nextActor(state);
      if (!single) {
        throw new Error(`runWorld: template ${template.id} is not finished but returned no next actor`);
      }
      actorIds = [single];
    }

    await runStep(actorIds, options, state, persisted, deliveredInstructions, true);
  }
}

async function runTickBased<TState extends WorldState>(
  options: RunWorldOptions<TState>,
  state: TState,
  persisted: WorldEvent[],
): Promise<void> {
  const { worldId, template, eventLog, signal, maxSteps = 5000, tickIntervalMs = 0 } = options;
  const deliveredInstructions = new Set<string>();

  if (!template.actorsForTick || !template.advanceTick) {
    throw new Error(`runWorld: tick-based template ${template.id} must implement actorsForTick + advanceTick`);
  }

  let ticks = 0;
  while (!template.isFinished(state)) {
    if (signal?.aborted) return;
    if (ticks >= maxSteps) {
      throw new Error(
        `runWorld: exceeded maxSteps (${maxSteps}) for tick-based world ${worldId} using template ${template.id}`,
      );
    }
    ticks += 1;

    // Agents re-decide infrequently, so most ticks have an empty actor list
    // and are pure physics. When several decide the same tick they run
    // concurrently.
    const actorIds = template.actorsForTick(state);
    if (actorIds.length > 0) {
      await runStep(actorIds, options, state, persisted, deliveredInstructions, false);
    }

    for (const event of template.advanceTick(state)) {
      persisted.push(eventLog.append(worldId, event));
    }

    if (tickIntervalMs > 0 && !template.isFinished(state)) {
      await sleep(tickIntervalMs);
    }
  }
}

/**
 * Runs one step for a set of actors: emits their turn.started events (when
 * `emitTurnStarted`), builds every observation from a single pre-batch
 * history snapshot so simultaneous actors can't see each other's actions,
 * runs all act() calls concurrently, then applies the results in order.
 * State mutation stays serial — only the (slow) act() calls parallelize.
 */
async function runStep<TState extends WorldState>(
  actorIds: string[],
  options: RunWorldOptions<TState>,
  state: TState,
  persisted: WorldEvent[],
  deliveredInstructions: Set<string>,
  emitTurnStarted: boolean,
): Promise<void> {
  const { worldId, template, agents, eventLog } = options;

  const chosen = actorIds.map((actorId) => {
    const agent = agents.get(actorId);
    if (!agent) throw new Error(`runWorld: no agent adapter registered for actor "${actorId}"`);
    return { actorId, agent };
  });

  if (emitTurnStarted) {
    // Emitted before the (possibly slow, real CLI/API) call so clients can
    // show "this agent is deciding now". visibilityForActor lets games with
    // hidden roles (werewolf) avoid leaking whose turn it is.
    for (const { actorId } of chosen) {
      const turnVisibleTo = template.visibilityForActor?.(actorId, state);
      persisted.push(eventLog.append(worldId, { type: "turn.started", actorId, payload: {}, visibleTo: turnVisibleTo }));
    }
  }

  // One snapshot for the whole batch: filtered per-actor by visibleTo so the
  // human observer's raw log is never redacted, and (crucially) simultaneous
  // actors observe the same pre-batch state. Re-reading here also surfaces
  // any god instruction that arrived mid-run.
  const fullHistory = eventLog.history(worldId);
  const observations = chosen.map(({ actorId }) => {
    const history = fullHistory.filter((e) => !e.visibleTo || e.visibleTo.includes(actorId));
    const observation = template.buildObservation(actorId, state, history);
    applyPendingInstructions(observation, history, actorId, deliveredInstructions);
    return observation;
  });

  const actions = await Promise.all(chosen.map(({ agent }, i) => agent.act(observations[i])));

  for (let i = 0; i < chosen.length; i++) {
    const { events } = template.applyAction(chosen[i].actorId, actions[i], state);
    for (const event of events) {
      persisted.push(eventLog.append(worldId, event));
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Surfaces "god" instructions (docs/architecture.md §2.4) into the current
 * actor's Observation.instruction: any god.instruction event in this
 * actor's (already visibleTo-filtered) history that targets this actor —
 * or is a broadcast (targetAgentId null) — and hasn't been delivered to
 * them yet. `delivered` is keyed per (event, actor) so a broadcast reaches
 * every agent exactly once and a targeted instruction only its target.
 */
function applyPendingInstructions(
  observation: Observation,
  history: WorldEvent[],
  actorId: string,
  delivered: Set<string>,
): void {
  const parts: string[] = [];
  for (const event of history) {
    if (event.type !== "god.instruction") continue;
    const target = event.payload.targetAgentId as string | null | undefined;
    if (target && target !== actorId) continue;
    const key = `${event.id}::${actorId}`;
    if (delivered.has(key)) continue;
    delivered.add(key);
    if (typeof event.payload.text === "string") parts.push(event.payload.text);
  }
  if (parts.length > 0) {
    observation.instruction = [observation.instruction, ...parts].filter(Boolean).join("\n");
  }
}
