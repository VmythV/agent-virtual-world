import type { AgentAction, AgentAdapter, Observation } from "../core/types.js";
import { expectedActionType } from "../core/protocol.js";

export interface MockAgentAdapterConfig {
  agentId: string;
  /** Canned responses, cycled through on each successive call. */
  responses: string[];
}

/**
 * Deterministic, network-free adapter used to exercise the engine
 * (scheduler, world templates, event log) without API credentials or cost.
 */
export class MockAgentAdapter implements AgentAdapter {
  readonly agentId: string;
  private readonly responses: string[];
  private callCount = 0;

  constructor(config: MockAgentAdapterConfig) {
    this.agentId = config.agentId;
    this.responses = config.responses;
  }

  async act(observation: Observation): Promise<AgentAction> {
    const text = this.responses[this.callCount % this.responses.length];
    this.callCount += 1;
    return { type: expectedActionType(observation), payload: { text } };
  }
}
