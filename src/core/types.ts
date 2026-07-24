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
  /**
   * Restricts which agents see this event in their own Observation.history.
   * `undefined` = every agent can see it (the default — matches every
   * template before werewolf). An explicit array (including `[]`) means
   * only those agentIds see it via buildObservation; it is NOT filtered
   * from EventLog.history()/REST/WS, so the human "god" observer always
   * sees everything regardless of this field. See docs/architecture.md §2.6.
   */
  visibleTo?: string[];
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

  /**
   * Optional: a batch of agents whose decisions this step are simultaneous
   * and independent (e.g. every player casting a hidden vote at once). The
   * scheduler builds all their observations from the same pre-batch history
   * — so they don't see each other's actions this step — and runs their
   * act() calls in parallel, which also cuts wall-clock time when the
   * agents are slow (real API/CLI). Return undefined/empty to fall back to
   * the sequential single-actor `nextActor` path.
   */
  nextActors?(state: TState): string[] | undefined;

  buildObservation(agentId: string, state: TState, history: WorldEvent[]): Observation;

  applyAction(agentId: string, action: AgentAction, state: TState): ApplyActionResult;

  isFinished(state: TState): boolean;

  /**
   * Optional: who should see "it's this agent's turn now" (the engine-level
   * turn.started event). Omit, or return undefined, for public (the
   * default for every template that doesn't have hidden roles). Needed by
   * games like werewolf where even the fact that it's a given agent's turn
   * during the night phase would leak their role.
   */
  visibilityForActor?(actorId: string, state: TState): string[] | undefined;

  // --- tick-based scheduling (only used when scheduling === "tick-based") ---

  /**
   * Which agents should make a decision this tick (may be empty). The
   * scheduler awaits each one's act() and applies it before advancing the
   * simulation. Agents typically re-decide infrequently/staggered rather
   * than every tick, so most ticks are pure deterministic physics.
   */
  actorsForTick?(state: TState): string[];

  /**
   * Advances the deterministic simulation by one tick after this tick's
   * agent decisions have been applied, returning the events to persist
   * (e.g. a world.tick snapshot). Also responsible for setting
   * state.finished when the sim is over.
   */
  advanceTick?(state: TState): NewWorldEvent[];
}
