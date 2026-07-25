import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../core/db.js";
import { EventLog } from "../core/eventLog.js";
import { runWorld } from "../engine/scheduler.js";
import { researchWorldTemplate } from "../worldTemplates/researchWorldTemplate.js";
import { CliAgentAdapter } from "../adapters/CliAgentAdapter.js";
import { MockAgentAdapter } from "../adapters/MockAgentAdapter.js";
import { RuntimePool } from "../runtime/runtimePool.js";
import { resolveCliInvocation } from "../core/agentFactory.js";
import type { AgentAdapter } from "../core/types.js";

const fixture = fileURLToPath(new URL("./fixtures/mockResearchCli.mjs", import.meta.url));

/**
 * Two tool-using researchers investigate a question over two rounds, then a
 * lead synthesizes. Uses a mock research CLI (free/deterministic) that
 * "calls a tool"; a real deployment would use the claude-code preset with
 * allowTools:true. Also prints the args the claude-code preset produces with
 * tools enabled vs disabled, showing the new capability.
 */
async function main() {
  const worldId = randomUUID();
  const db = openDatabase("data/events.db");
  const eventLog = new EventLog(db);
  const pool = new RuntimePool({ maxConcurrent: 2, timeoutMs: 10_000 });

  console.log("claude-code preset args WITH tools:   ", resolveCliInvocation({ preset: "claude-code", allowTools: true }).args.join(" "));
  console.log("claude-code preset args WITHOUT tools: ", resolveCliInvocation({ preset: "claude-code" }).args.join(" "));
  console.log();

  const researchers = ["r1", "r2"];
  const agents = new Map<string, AgentAdapter>([
    ...researchers.map((id) => [id, new CliAgentAdapter({ agentId: id, command: process.execPath, args: [fixture], pool })] as const),
    ["lead", new MockAgentAdapter({ agentId: "lead", responses: ["综合两位研究员用工具查到的资料，得出最终结论。"] })],
  ]);

  console.log(`Running research world ${worldId} (2 tool-using researchers, 2 rounds, 1 lead)\n`);

  const events = await runWorld({
    worldId,
    template: researchWorldTemplate,
    config: { question: "某项技术的可行性如何？", researchers, lead: "lead", rounds: 2 },
    agents,
    eventLog,
  });

  for (const e of events) {
    console.log(`[#${e.sequence} ${e.type}] ${e.actorId ? e.actorId + ": " : ""}${JSON.stringify(e.payload)}`);
  }

  const findings = events.filter((e) => e.type === "research.finding");
  const usedTool = findings.every((e) => (e.payload.text as string).includes("工具"));
  const answer = events.find((e) => e.type === "research.answer");

  const checks: [string, boolean][] = [
    ["两名研究员各两轮共 4 条发现", findings.length === 4],
    ["每条发现都来自工具调用", usedTool],
    ["lead 产出了最终结论", !!answer && answer.actorId === "lead"],
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
