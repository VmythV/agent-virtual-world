import type { AgentAdapter } from "./types.js";
import type { AgentConfig, CliInvocationConfig } from "./agentConfig.js";
import { ApiAgentAdapter } from "../adapters/ApiAgentAdapter.js";
import { MockAgentAdapter } from "../adapters/MockAgentAdapter.js";
import { CliAgentAdapter } from "../adapters/CliAgentAdapter.js";
import { HumanAgentAdapter, type HumanDecisionHub } from "../adapters/HumanAgentAdapter.js";
import { RuntimePool } from "../runtime/runtimePool.js";

export interface AgentFactoryDeps {
  /** Shared across every CLI-backed agent so they compete for one concurrency/budget limit. */
  cliPool: RuntimePool;
  /** Required to build "human" seats; the running server provides it. */
  humanHub?: HumanDecisionHub;
}

/** Strategy factory: turns a declarative AgentConfig into a live AgentAdapter. */
export function createAgentAdapter(config: AgentConfig, deps: AgentFactoryDeps): AgentAdapter {
  switch (config.adapter) {
    case "api":
      return new ApiAgentAdapter({
        agentId: config.agentId,
        systemPrompt: config.systemPrompt,
        model: config.model,
      });
    case "mock":
      return new MockAgentAdapter({ agentId: config.agentId, responses: config.responses });
    case "cli": {
      const { command, args } = resolveCliInvocation(config.cli);
      return new CliAgentAdapter({ agentId: config.agentId, command, args, pool: deps.cliPool });
    }
    case "human": {
      if (!deps.humanHub) throw new Error('createAgentAdapter: "human" agents require a humanHub in deps');
      return new HumanAgentAdapter(config.agentId, deps.humanHub);
    }
  }
}

/**
 * Expands a CLI preset into a concrete command + args. "claude-code" is the
 * built-in preset for the real Claude Code CLI in non-interactive print
 * mode; "custom" passes through whatever the caller supplied, which is how
 * other CLI agents (Codex CLI, a bespoke script, ...) get plugged in.
 */
export function resolveCliInvocation(cli: CliInvocationConfig): { command: string; args: string[] } {
  if (cli.preset === "custom") {
    return { command: cli.command, args: cli.args ?? [] };
  }

  const args = ["-p", "--output-format", "text", "--no-session-persistence"];
  // Least privilege by default (--tools ""); enable the built-in toolset for
  // worlds that need real external I/O (research). Callers can still narrow
  // it further via extraArgs.
  args.push("--tools", cli.allowTools ? "default" : "");
  if (cli.model) args.push("--model", cli.model);
  if (cli.systemPrompt) args.push("--system-prompt", cli.systemPrompt);
  if (cli.maxBudgetUsd !== undefined) args.push("--max-budget-usd", String(cli.maxBudgetUsd));
  if (cli.extraArgs) args.push(...cli.extraArgs);
  return { command: "claude", args };
}
