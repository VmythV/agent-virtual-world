import { randomUUID } from "node:crypto";
import { openDatabase } from "../core/db.js";
import { EventLog } from "../core/eventLog.js";
import { runWorld } from "../engine/scheduler.js";
import { problemSolvingWorldTemplate } from "../worldTemplates/problemSolvingWorldTemplate.js";
import { MockAgentAdapter } from "../adapters/MockAgentAdapter.js";
import type { AgentAdapter } from "../core/types.js";

/**
 * Scripted mock problem-solving run: the coordinator consults two experts
 * then finalizes. Asserts the delegation event sequence, that both
 * contributions were gathered, and that a final answer was produced.
 */
async function main() {
  const worldId = randomUUID();
  const db = openDatabase("data/events.db");
  const eventLog = new EventLog(db);

  // Coordinator call sequence: route->calculator, route->geometry, FINALIZE, then answer(text).
  const coordinator = new MockAgentAdapter({
    agentId: "coordinator",
    responses: ["calculator", "geometry-expert", "FINALIZE", "综合计算器与几何专家的结果，最终答案为 42。"],
  });
  const calculator = new MockAgentAdapter({ agentId: "calculator", responses: ["数值计算部分：6 × 7 = 42。"] });
  const geometry = new MockAgentAdapter({ agentId: "geometry-expert", responses: ["几何分析部分：该图形可分解为两个三角形。"] });

  const agents = new Map<string, AgentAdapter>([
    ["coordinator", coordinator],
    ["calculator", calculator],
    ["geometry-expert", geometry],
  ]);

  console.log(`Running problem-solving world ${worldId} (coordinator delegates to 2 experts)\n`);

  const events = await runWorld({
    worldId,
    template: problemSolvingWorldTemplate,
    config: {
      problem: "求解这道结合了数值计算与几何分析的综合题。",
      coordinator: "coordinator",
      experts: ["calculator", "geometry-expert"],
    },
    agents,
    eventLog,
  });

  for (const event of events) {
    const actor = event.actorId ? `${event.actorId}: ` : "";
    console.log(`[#${event.sequence} ${event.type}] ${actor}${JSON.stringify(event.payload)}`);
  }

  const routes = events.filter((e) => e.type === "coordinator.route");
  const contributions = events.filter((e) => e.type === "expert.contribution");
  const answer = events.find((e) => e.type === "world.answer");

  const checks: [string, boolean][] = [
    ["协调者进行了 3 次路由决策（2 次派发 + 1 次 FINALIZE）", routes.length === 3],
    ["收集到 2 位专家的贡献", contributions.length === 2],
    ["计算器与几何专家各贡献一次", contributions.some((c) => c.actorId === "calculator") && contributions.some((c) => c.actorId === "geometry-expert")],
    ["产生了最终解答", !!answer && typeof answer.payload.text === "string" && (answer.payload.text as string).includes("42")],
    ["最终解答由协调者给出", answer?.actorId === "coordinator"],
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
