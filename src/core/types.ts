/**
 * Core protocol shared by the execution engine, world templates and agent
 * adapters. See docs/architecture.md for the design rationale.
 */

export interface WorldEvent {
  id: string;
  worldId: string;
  sequence: number;
  timestamp: string;
  type: string;
  actorId?: string;
  payload: Record<string, unknown>;
  highlight?: boolean;
}

export type NewWorldEvent = Omit<WorldEvent, "id" | "worldId" | "sequence" | "timestamp">;

export interface Observation {
  worldId: string;
  agentId: string;
  visibleState: unknown;
  history: WorldEvent[];
  instruction?: string;
}

export interface AgentAction {
  type: string;
  payload: Record<string, unknown>;
  reasoning?: string;
}

export interface AgentAdapter {
  readonly agentId: string;
  act(observation: Observation): Promise<AgentAction>;
}

export interface WorldState {
  worldId: string;
  template: string;
  finished: boolean;
}

export interface ApplyActionResult {
  events: NewWorldEvent[];
}

/**
 * A pluggable world template. Turn-based templates are driven by
 * `nextActor` returning one agent id at a time; tick-based templates
 * (not needed for the debate MVP) would instead be driven by a fixed
 * clock calling every agent each tick.
 */
export interface WorldTemplate<TState extends WorldState = WorldState> {
  readonly id: string;
  readonly scheduling: "turn-based" | "tick-based";

  createInitialState(config: Record<string, unknown>): { state: TState; events: NewWorldEvent[] };

  /** Whose turn is it next, or undefined if the world has nothing left to do. */
  nextActor(state: TState): string | undefined;

  buildObservation(agentId: string, state: TState, history: WorldEvent[]): Observation;

  applyAction(agentId: string, action: AgentAction, state: TState): ApplyActionResult;

  isFinished(state: TState): boolean;
}
