import { randomUUID } from "node:crypto";
import { openDatabase } from "../core/db.js";
import { EventLog } from "../core/eventLog.js";
import { runWorld } from "../engine/scheduler.js";
import { aquariumWorldTemplate, type TankSize } from "../worldTemplates/aquariumWorldTemplate.js";
import { MockAgentAdapter } from "../adapters/MockAgentAdapter.js";
import type { AgentAdapter } from "../core/types.js";

/**
 * Runs a bounded mock aquarium (no tick delay so it completes instantly)
 * and asserts the tick-based engine behaves: snapshots are emitted, the
 * event count is bounded (no runaway loop), and every fish stays inside
 * the tank on every tick.
 */
async function main() {
  const worldId = randomUUID();
  const db = openDatabase("data/events.db");
  const eventLog = new EventLog(db);

  const fishIds = ["nemo", "dory", "marlin", "bruce"];
  const behaviors = ["wander", "school", "dart", "cruise"];
  const agents = new Map<string, AgentAdapter>(
    fishIds.map((id, i) => [id, new MockAgentAdapter({ agentId: id, responses: [behaviors[i % behaviors.length]] })]),
  );

  const ticks = 40;
  const tank: TankSize = { w: 10, h: 6, d: 8 };

  console.log(`Running aquarium world ${worldId} (${fishIds.length} mock fish, ${ticks} ticks, no delay)\n`);

  const events = await runWorld({
    worldId,
    template: aquariumWorldTemplate,
    config: { fish: fishIds, ticks, tank },
    agents,
    eventLog,
  });

  const tickEvents = events.filter((e) => e.type === "world.tick");
  const behaviorEvents = events.filter((e) => e.type === "fish.behavior");
  console.log(`共 ${events.length} 条事件 (world.tick: ${tickEvents.length}, fish.behavior: ${behaviorEvents.length})`);

  // --- assertions ---
  const checks: [string, boolean][] = [];

  // Snapshots emitted: initial (tick 0) + one per advanced tick.
  checks.push([`world.tick 快照数量正确 (${ticks + 1})`, tickEvents.length === ticks + 1]);

  // Bounded: no runaway. Loose upper bound well under the scheduler's maxSteps.
  checks.push(["事件总数有界（无失控循环）", events.length < ticks * 10]);

  // Every fish inside the tank on every tick.
  const cx = tank.w / 2;
  const cz = tank.d / 2;
  let outOfBounds = 0;
  for (const e of tickEvents) {
    const fish = e.payload.fish as Array<{ id: string; x: number; y: number; z: number }>;
    for (const f of fish) {
      if (f.x < -cx - 0.01 || f.x > cx + 0.01 || f.z < -cz - 0.01 || f.z > cz + 0.01 || f.y < 0 || f.y > tank.h + 0.01) {
        outOfBounds += 1;
      }
    }
  }
  checks.push(["所有鱼始终在缸内", outOfBounds === 0]);

  // Fish actually moved (sim isn't frozen).
  const first = tickEvents[0].payload.fish as Array<{ id: string; x: number; z: number }>;
  const last = tickEvents[tickEvents.length - 1].payload.fish as Array<{ id: string; x: number; z: number }>;
  const moved = first.some((f, i) => Math.abs(f.x - last[i].x) > 0.1 || Math.abs(f.z - last[i].z) > 0.1);
  checks.push(["鱼群确实游动了（模拟非静止）", moved]);

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
