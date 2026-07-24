import { randomUUID } from "node:crypto";
import { openDatabase } from "../core/db.js";
import { EventLog } from "../core/eventLog.js";
import { runWorld } from "../engine/scheduler.js";
import { ecosystemWorldTemplate } from "../worldTemplates/ecosystemWorldTemplate.js";
import { MockAgentAdapter } from "../adapters/MockAgentAdapter.js";
import type { AgentAdapter } from "../core/types.js";

/**
 * Predator-prey ecosystem. Prey wander (easy to catch) so the demo
 * deterministically produces catches. Asserts snapshots are emitted, at
 * least one prey is eaten, creatures stay in-field, and the sim terminates
 * within the tick budget with a valid outcome.
 */
async function main() {
  const worldId = randomUUID();
  const db = openDatabase("data/events.db");
  const eventLog = new EventLog(db);

  const predators = ["fox-1", "fox-2"];
  const prey = ["rabbit-1", "rabbit-2", "rabbit-3", "rabbit-4"];
  const agents = new Map<string, AgentAdapter>([
    ...predators.map((id) => [id, new MockAgentAdapter({ agentId: id, responses: ["hunt"] })] as const),
    ...prey.map((id) => [id, new MockAgentAdapter({ agentId: id, responses: ["wander"] })] as const),
  ]);

  const field = 10;
  const ticks = 60;
  console.log(`Running ecosystem world ${worldId} (${predators.length} predators, ${prey.length} prey, ${ticks} ticks)\n`);

  const events = await runWorld({
    worldId,
    template: ecosystemWorldTemplate,
    config: { predators, prey, ticks, field },
    agents,
    eventLog,
  });

  const tickEvents = events.filter((e) => e.type === "world.tick");
  const eats = events.filter((e) => e.type === "eat.event");
  const deaths = events.filter((e) => e.type === "death.event");
  const finished = events.find((e) => e.type === "world.finished");
  console.log(`共 ${events.length} 事件；world.tick=${tickEvents.length}，捕食=${eats.length}，死亡=${deaths.length}`);
  console.log(`结局: ${JSON.stringify(finished?.payload)}`);

  let outOfField = 0;
  for (const t of tickEvents) {
    for (const c of t.payload.creatures as Array<{ x: number; z: number }>) {
      if (Math.abs(c.x) > field / 2 + 0.01 || Math.abs(c.z) > field / 2 + 0.01) outOfField += 1;
    }
  }

  const checks: [string, boolean][] = [
    ["每 tick 一张快照（有界）", tickEvents.length >= 2 && tickEvents.length <= ticks + 1],
    ["至少发生一次捕食", eats.length >= 1],
    ["所有生物始终在场地内", outOfField === 0],
    ["模拟正常终止并给出结局", !!finished && ["predators", "prey", "balance"].includes(finished.payload.winner as string)],
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
