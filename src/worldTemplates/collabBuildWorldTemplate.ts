import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  AgentAction,
  ApplyActionResult,
  NewWorldEvent,
  Observation,
  WorldEvent,
  WorldState,
  WorldTemplate,
} from "../core/types.js";

export interface CollabBuildConfig {
  task: string;
  builders: string[];
  rounds?: number;
}

export interface CollabBuildState extends WorldState {
  task: string;
  builders: string[];
  rounds: number;
  workspaceDir: string;
  turnIndex: number;
  step: number;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).filter((f) => f !== ".git");
}

/**
 * Collaborative build: multiple coding-agent "builders" take turns working
 * in ONE shared, persistent git workspace to complete a task (the first
 * template that needs a persistent cross-turn workspace — the CLI adapter
 * runs in the dir handed to it via the observation's workspaceDir instead of
 * a fresh sandbox). After each builder's turn the template commits and
 * captures the diff, so the timeline shows exactly what each agent changed.
 */
export const collabBuildWorldTemplate: WorldTemplate<CollabBuildState> = {
  id: "collab-build",
  scheduling: "turn-based",

  createInitialState(config: Record<string, unknown>) {
    const cfg = config as unknown as CollabBuildConfig;
    const workspaceDir = mkdtempSync(path.join(tmpdir(), "avw-build-"));
    git(workspaceDir, ["init", "-q"]);
    git(workspaceDir, ["config", "user.email", "world@agent.local"]);
    git(workspaceDir, ["config", "user.name", "Agent World"]);
    git(workspaceDir, ["commit", "-q", "--allow-empty", "-m", "initial"]);

    const state: CollabBuildState = {
      worldId: "",
      template: "collab-build",
      finished: false,
      task: cfg.task,
      builders: cfg.builders,
      rounds: cfg.rounds ?? 1,
      workspaceDir,
      turnIndex: 0,
      step: 0,
    };

    const events: NewWorldEvent[] = [
      { type: "world.created", payload: { task: cfg.task, builders: cfg.builders, workspaceDir }, highlight: true },
    ];
    return { state, events };
  },

  nextActor(state: CollabBuildState) {
    if (state.finished) return undefined;
    if (state.turnIndex >= state.builders.length * state.rounds) return undefined;
    return state.builders[state.turnIndex % state.builders.length];
  },

  buildObservation(agentId: string, state: CollabBuildState, history: WorldEvent[]): Observation {
    return {
      worldId: state.worldId,
      agentId,
      visibleState: {
        role: "builder",
        task: state.task,
        // The CLI adapter reads this and runs in the shared workspace.
        workspaceDir: state.workspaceDir,
        yourStep: state.step + 1,
        currentFiles: listFiles(state.workspaceDir),
        expectedActionType: "build",
        responseShape: "text",
      },
      history,
    };
  },

  applyAction(agentId: string, action: AgentAction, state: CollabBuildState): ApplyActionResult {
    state.step += 1;
    state.turnIndex += 1;
    const message = typeof action.payload.text === "string" ? action.payload.text.slice(0, 200) : "";

    // Commit whatever the builder changed and capture the diff for the god view.
    git(state.workspaceDir, ["add", "-A"]);
    const stat = git(state.workspaceDir, ["diff", "--cached", "--stat"]).trim();
    const diff = git(state.workspaceDir, ["diff", "--cached"]).slice(0, 4000);
    const changed = stat.length > 0;
    git(state.workspaceDir, ["commit", "-q", "--allow-empty", "-m", `step ${state.step} by ${agentId}`]);

    const events: NewWorldEvent[] = [
      {
        type: "build.step",
        actorId: agentId,
        payload: { step: state.step, message, files: listFiles(state.workspaceDir), stat, diff, changed },
        highlight: true,
      },
    ];

    if (state.turnIndex >= state.builders.length * state.rounds) {
      state.finished = true;
      const log = git(state.workspaceDir, ["log", "--oneline"]).trim();
      events.push({
        type: "world.finished",
        payload: { files: listFiles(state.workspaceDir), commits: log.split("\n").length, workspaceDir: state.workspaceDir },
        highlight: true,
      });
    }
    return { events };
  },

  isFinished(state: CollabBuildState) {
    return state.finished;
  },
};
