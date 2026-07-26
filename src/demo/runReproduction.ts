import { randomUUID } from "node:crypto";
import { openDatabase } from "../core/db.js";
import { EventLog } from "../core/eventLog.js";
import { runWorld } from "../engine/scheduler.js";
import { reproductionWorldTemplate } from "../worldTemplates/reproductionWorldTemplate.js";
import { MockAgentAdapter } from "../adapters/MockAgentAdapter.js";
import type { AgentAdapter } from "../core/types.js";

/**
 * Reproduction / population sim. Only the FOUNDERS are registered as agents;
 * every offspring is a brand-new id created mid-run that no pre-registered
 * adapter covers — it decides through the scheduler's `defaultAgent` fallback.
 * Asserts births actually happen (population grows past the founders), the
 * offspring ids never crash the scheduler, and the sim terminates cleanly.
 */
async function main() {
  const worldId = randomUUID();
  const db = openDatabase("data/events.db");
  const eventLog = new EventLog(db);

  const founders = ["cell-a", "cell-b", "cell-c"];
  const agents = new Map<string, AgentAdapter>(
    founders.map((id) => [id, new MockAgentAdapter({ agentId: id, responses: ["graze"] })] as const),
  );
  // Shared behaviour for offspring the template invents at runtime.
  const defaultAgent = new MockAgentAdapter({ agentId: "__spawned__", responses: ["graze"] });

  const ticks = 80;
  console.log(`Running reproduction world ${worldId} (${founders.length} founders, ${ticks} ticks)\n`);

  const events = await runWorld({
    worldId,
    template: reproductionWorldTemplate,
    config: { founders, ticks, field: 12, maxPopulation: 40 },
    agents,
    eventLog,
    defaultAgent,
  });

  const tickEvents = events.filter((e) => e.type === "world.tick");
  const births = events.filter((e) => e.type === "birth.event");
  const deaths = events.filter((e) => e.type === "death.event");
  const finished = events.find((e) => e.type === "world.finished");
  const peak = Math.max(...tickEvents.map((t) => (t.payload.creatures as unknown[]).length));
  console.log(`共 ${events.length} 事件；world.tick=${tickEvents.length}，出生=${births.length}，死亡=${deaths.length}，峰值种群=${peak}`);
  console.log(`结局: ${JSON.stringify(finished?.payload)}`);

  // Every birth introduces an id that was never in `agents`.
  const bornIds = new Set(births.map((b) => b.payload.child as string));
  const noneWereFounders = [...bornIds].every((id) => !founders.includes(id));

  const checks: [string, boolean][] = [
    ["每 tick 一张快照（有界）", tickEvents.length >= 2 && tickEvents.length <= ticks + 1],
    ["至少发生一次繁殖（运行时生成新 Agent）", births.length >= 1],
    ["后代都是运行时新 id（非初代）", bornIds.size >= 1 && noneWereFounders],
    ["种群曾超过初代数量", peak > founders.length],
    ["模拟正常终止", !!finished],
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
