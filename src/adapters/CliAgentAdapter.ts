import type { AgentAction, AgentAdapter, Observation } from "../core/types.js";
import { buildActionPayload, buildPrompt, expectedActionType, expectedWorkspaceDir } from "../core/protocol.js";
import { RuntimePool } from "../runtime/runtimePool.js";
import { runProcess } from "../runtime/processRunner.js";
import { withSandboxDir } from "../runtime/sandbox.js";

export interface CliAgentAdapterConfig {
  agentId: string;
  /** Executable to spawn, e.g. the path to `claude`/`codex`, or process.execPath for a Node script. */
  command: string;
  args?: string[];
  /** Shared across every CliAgentAdapter that should compete for the same concurrency/budget limits. */
  pool: RuntimePool;
}

/**
 * Adapter for CLI-based coding agents (Claude Code, Codex CLI, or any other
 * process that reads a prompt on stdin and prints its answer on stdout).
 * Each call runs through the shared RuntimePool (concurrency/timeout/
 * budget). Normally it gets a fresh per-call sandbox directory; but when the
 * world template hands the observation a `workspaceDir` (collaborative
 * build), it runs there instead so agents' changes persist and accumulate
 * across turns.
 */
export class CliAgentAdapter implements AgentAdapter {
  readonly agentId: string;
  private readonly command: string;
  private readonly args: string[];
  private readonly pool: RuntimePool;

  constructor(config: CliAgentAdapterConfig) {
    this.agentId = config.agentId;
    this.command = config.command;
    this.args = config.args ?? [];
    this.pool = config.pool;
  }

  async act(observation: Observation): Promise<AgentAction> {
    const workspaceDir = expectedWorkspaceDir(observation);
    const runInCwd = async (cwd: string, signal: AbortSignal): Promise<AgentAction> => {
      const result = await runProcess({
        command: this.command,
        args: this.args,
        cwd,
        input: buildPrompt(observation),
        signal,
      });
      return { type: expectedActionType(observation), payload: buildActionPayload(observation, result.stdout) };
    };

    return this.pool.run((signal) =>
      workspaceDir ? runInCwd(workspaceDir, signal) : withSandboxDir(this.agentId, (cwd) => runInCwd(cwd, signal)),
    );
  }
}
