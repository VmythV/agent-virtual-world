import type { AgentAction, AgentAdapter, Observation } from "../core/types.js";
import { buildActionPayload, expectedActionType } from "../core/protocol.js";
import type { EventLog } from "../core/eventLog.js";

interface Pending {
  observation: Observation;
  resolve: (action: AgentAction) => void;
}

/**
 * Coordinates human-played seats. When a HumanAgentAdapter is asked to act,
 * it registers here: a `decision.requested` event is emitted (so the UI can
 * prompt with the right shape/choices) and the turn blocks until the human
 * submits a response via REST — or the world is stopped, which resolves any
 * pending decision with a default so the run can unwind cleanly.
 */
export class HumanDecisionHub {
  private pending = new Map<string, Pending>();

  constructor(private readonly eventLog: EventLog) {}

  private key(worldId: string, agentId: string): string {
    return `${worldId}::${agentId}`;
  }

  request(worldId: string, agentId: string, observation: Observation): Promise<AgentAction> {
    // Visible only to the human's own seat (and the god via the raw log).
    this.eventLog.append(worldId, {
      type: "decision.requested",
      actorId: agentId,
      payload: { visibleState: observation.visibleState },
      visibleTo: [agentId],
      highlight: true,
    });
    return new Promise((resolve) => {
      this.pending.set(this.key(worldId, agentId), { observation, resolve });
    });
  }

  /** Returns false if there was no pending decision for that seat. */
  submit(worldId: string, agentId: string, response: string): boolean {
    const p = this.pending.get(this.key(worldId, agentId));
    if (!p) return false;
    this.pending.delete(this.key(worldId, agentId));
    p.resolve({ type: expectedActionType(p.observation), payload: buildActionPayload(p.observation, response) });
    return true;
  }

  /** Resolve every pending decision for a world with a default, so a stopped/deleted world can unwind. */
  cancelWorld(worldId: string): void {
    for (const [key, p] of this.pending) {
      if (key.startsWith(`${worldId}::`)) {
        this.pending.delete(key);
        p.resolve({ type: expectedActionType(p.observation), payload: buildActionPayload(p.observation, "") });
      }
    }
  }
}

/** A seat driven by a human: act() blocks on the hub until a decision is submitted. */
export class HumanAgentAdapter implements AgentAdapter {
  constructor(
    readonly agentId: string,
    private readonly hub: HumanDecisionHub,
  ) {}

  act(observation: Observation): Promise<AgentAction> {
    return this.hub.request(observation.worldId, this.agentId, observation);
  }
}
