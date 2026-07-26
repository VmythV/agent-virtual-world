/**
 * Declarative Agent configuration. This is the shape the (future) Admin
 * Console CRUD reads/writes; agentFactory.ts turns it into a live
 * AgentAdapter. Keeping this as data (rather than constructing adapters by
 * hand) is what makes the adapter layer a strategy factory instead of a
 * pile of if/else in every demo script.
 */

export interface ApiAgentConfig {
  agentId: string;
  adapter: "api";
  systemPrompt: string;
  model?: string;
}

export interface MockAgentConfig {
  agentId: string;
  adapter: "mock";
  responses: string[];
}

/** A seat played by the human via the UI: act() waits for a decision to be submitted. */
export interface HumanAgentConfig {
  agentId: string;
  adapter: "human";
}

export interface CliAgentConfig {
  agentId: string;
  adapter: "cli";
  cli: CliInvocationConfig;
}

export type AgentConfig = ApiAgentConfig | MockAgentConfig | CliAgentConfig | HumanAgentConfig;

export type CliInvocationConfig =
  | {
      /** Real, non-interactive Claude Code CLI (`claude -p ...`). */
      preset: "claude-code";
      systemPrompt?: string;
      model?: string;
      maxBudgetUsd?: number;
      /**
       * Enable the agent's built-in tools (search, read, run, ...). Default
       * (false) passes `--tools ""` for least privilege — good for pure
       * text-generation worlds. Enable for worlds where the agent must do
       * real external I/O (e.g. research). When on, the CLI is trusted to
       * act, so use only with appropriate sandboxing/permissions.
       */
      allowTools?: boolean;
      extraArgs?: string[];
    }
  | {
      /** Any other CLI agent: full control over the executable and its args. */
      preset: "custom";
      command: string;
      args?: string[];
    };
