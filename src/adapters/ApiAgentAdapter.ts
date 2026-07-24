import Anthropic from "@anthropic-ai/sdk";
import type { AgentAction, AgentAdapter, Observation } from "../core/types.js";
import { buildPrompt, expectedActionType } from "../core/protocol.js";

export interface ApiAgentAdapterConfig {
  agentId: string;
  systemPrompt: string;
  model?: string;
  apiKey?: string;
}

/** Default adapter: talks directly to the Anthropic Messages API. */
export class ApiAgentAdapter implements AgentAdapter {
  readonly agentId: string;
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly systemPrompt: string;

  constructor(config: ApiAgentAdapterConfig) {
    this.agentId = config.agentId;
    this.model = config.model ?? "claude-sonnet-5";
    this.systemPrompt = config.systemPrompt;
    this.client = new Anthropic({ apiKey: config.apiKey ?? process.env.ANTHROPIC_API_KEY });
  }

  async act(observation: Observation): Promise<AgentAction> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 512,
      system: this.systemPrompt,
      messages: [{ role: "user", content: buildPrompt(observation) }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    return { type: expectedActionType(observation), payload: { text } };
  }
}
