import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { EventLog } from "../src/core/eventLog.js";
import { runWorld } from "../src/engine/scheduler.js";
import { collabBuildWorldTemplate } from "../src/worldTemplates/collabBuildWorldTemplate.js";
import { CliAgentAdapter } from "../src/adapters/CliAgentAdapter.js";
import { RuntimePool } from "../src/runtime/runtimePool.js";
import type { AgentAdapter } from "../src/core/types.js";

const fixture = fileURLToPath(new URL("../src/demo/fixtures/mockBuilderCli.mjs", import.meta.url));

describe("collab-build — shared persistent workspace", () => {
  it("builders accumulate changes in ONE workspace across turns", async () => {
    const log = new EventLog(new DatabaseSync(":memory:"));
    const pool = new RuntimePool({ maxConcurrent: 1, timeoutMs: 10_000 });
    const builders = ["a", "b"];
    const agents = new Map<string, AgentAdapter>(
      builders.map((id) => [id, new CliAgentAdapter({ agentId: id, command: process.execPath, args: [fixture], pool })]),
    );

    const events = await runWorld({
      worldId: "w",
      template: collabBuildWorldTemplate,
      config: { task: "build a doc", builders, rounds: 2 },
      agents,
      eventLog: log,
    });

    const steps = events.filter((e) => e.type === "build.step");
    expect(steps).toHaveLength(4); // 2 builders x 2 rounds
    // Every step touched the same shared file (proves persistence across agents/turns).
    expect(steps.every((e) => (e.payload.files as string[]).includes("progress.md"))).toBe(true);
    // The diff is captured for the god view.
    expect(typeof steps[0].payload.diff).toBe("string");
    expect((steps[0].payload.diff as string).length).toBeGreaterThan(0);

    // The final workspace's file accumulated all 4 contributions.
    const finished = events.find((e) => e.type === "world.finished");
    const ws = (finished!.payload as { workspaceDir: string }).workspaceDir;
    const progress = path.join(ws, "progress.md");
    expect(existsSync(progress)).toBe(true);
    expect(readFileSync(progress, "utf8").split("\n").filter((l) => l.startsWith("- "))).toHaveLength(4);
  });
});
