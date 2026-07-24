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
}

/**
 * Turn-based world runner: repeatedly asks the template whose turn it is,
 * lets that agent act, applies the action, and persists whatever events
 * come out — until the template reports itself finished.
 */
export async function runWorld<TState extends WorldState>(
  options: RunWorldOptions<TState>,
): Promise<WorldEvent[]> {
  const { worldId, template, config, agents, eventLog, maxSteps = 200 } = options;

  const { state, events: initEvents } = template.createInitialState(config);
  state.worldId = worldId;

  const persisted: WorldEvent[] = initEvents.map((event) => eventLog.append(worldId, event));

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

    const history = eventLog.history(worldId);
    const observation = template.buildObservation(actorId, state, history);
    const action = await agent.act(observation);
    const { events } = template.applyAction(actorId, action, state);

    for (const event of events) {
      persisted.push(eventLog.append(worldId, event));
    }
  }

  return persisted;
}
