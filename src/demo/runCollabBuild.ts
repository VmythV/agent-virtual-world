import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { openDatabase } from "../core/db.js";
import { EventLog } from "../core/eventLog.js";
import { runWorld } from "../engine/scheduler.js";
import { collabBuildWorldTemplate } from "../worldTemplates/collabBuildWorldTemplate.js";
import { CliAgentAdapter } from "../adapters/CliAgentAdapter.js";
import { RuntimePool } from "../runtime/runtimePool.js";
import type { AgentAdapter } from "../core/types.js";

const fixturePath = fileURLToPath(new URL("./fixtures/mockBuilderCli.mjs", import.meta.url));

/**
 * Three CLI "builders" collaborate on ONE shared git workspace across two
 * rounds. Uses a mock builder CLI (free/deterministic) instead of a real
 * claude session; point the CliAgentAdapter at the real `claude` binary to
 * do actual coding. Asserts each turn commits a growing diff to the SAME
 * files (proving the workspace persists across agents), and the final
 * progress.md accumulated every step.
 */
async function main() {
  const worldId = randomUUID();
  const db = openDatabase("data/events.db");
  const eventLog = new EventLog(db);
  const pool = new RuntimePool({ maxConcurrent: 1, timeoutMs: 10_000 });

  const builders = ["arch", "dev", "qa"];
  const agents = new Map<string, AgentAdapter>(
    builders.map((id) => [
      id,
      new CliAgentAdapter({ agentId: id, command: process.execPath, args: [fixturePath], pool }),
    ]),
  );

  console.log(`Running collab-build world ${worldId} (3 builders, 2 rounds, shared workspace)\n`);

  const events = await runWorld({
    worldId,
    template: collabBuildWorldTemplate,
    config: { task: "共同写出一个项目进度文档 progress.md", builders, rounds: 2 },
    agents,
    eventLog,
  });

  const steps = events.filter((e) => e.type === "build.step");
  for (const e of steps) {
    const p = e.payload as { step: number; stat: string; files: string[] };
    console.log(`[#${e.sequence} build.step] ${e.actorId} 第${p.step}步 — 变更: ${p.stat.replace(/\n/g, " ")} — 文件: ${p.files.join(",")}`);
  }

  const finished = events.find((e) => e.type === "world.finished");
  const ws = (finished?.payload as { workspaceDir: string } | undefined)?.workspaceDir;
  const progressFile = ws ? path.join(ws, "progress.md") : "";
  const progress = ws && existsSync(progressFile) ? readFileSync(progressFile, "utf8") : "";
  const progressLines = progress.split("\n").filter((l) => l.startsWith("- ")).length;
  console.log(`\n最终 progress.md（累计 ${progressLines} 行贡献）:\n${progress}`);

  const allTouchedSameFile = steps.every((e) => (e.payload.files as string[]).includes("progress.md"));

  const checks: [string, boolean][] = [
    ["6 步各产生一次提交（3 builder × 2 轮）", steps.length === 6],
    ["每一步都在同一个共享文件上累积", allTouchedSameFile],
    ["最终文档累计了全部 6 步贡献", progressLines === 6],
    ["前 5 步都产生了实际变更", steps.slice(0, 5).every((e) => e.payload.changed === true)],
  ];

  console.log("\n校验:");
  let allPassed = true;
  for (const [label, passed] of checks) {
    console.log(`  ${passed ? "✔" : "✘"} ${label}`);
    if (!passed) allPassed = false;
  }

  db.close();
  if (!allPassed) {
    console.error("\n校验失败！");
    process.exit(1);
  }
  console.log("\n校验全部通过 ✔");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
