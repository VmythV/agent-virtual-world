import { randomUUID } from "node:crypto";
import { openDatabase } from "../core/db.js";
import { EventLog } from "../core/eventLog.js";
import { runWorld } from "../engine/scheduler.js";
import { werewolfWorldTemplate } from "../worldTemplates/werewolfWorldTemplate.js";
import { MockAgentAdapter } from "../adapters/MockAgentAdapter.js";
import type { AgentAdapter } from "../core/types.js";

/**
 * Runs a fully scripted (mock, no cost) werewolf game to a predetermined
 * outcome, then asserts that villager-2 never saw anything it shouldn't
 * have — the actual test of docs/architecture.md §2.6's hidden-info design.
 */
async function main() {
  const worldId = randomUUID();
  const db = openDatabase("data/events.db");
  const eventLog = new EventLog(db);

  const wolf = new MockAgentAdapter({
    agentId: "wolf-1",
    responses: ["villager-1", "我觉得咱们要小心村民之间互相猜忌", "villager-2"],
  });
  const seer = new MockAgentAdapter({
    agentId: "seer-1",
    responses: ["wolf-1", "我查验的结果显示有问题，大家要小心", "wolf-1"],
  });
  const villager1 = new MockAgentAdapter({ agentId: "villager-1", responses: ["(夜里就出局，不会被调用)"] });
  const villager2 = new MockAgentAdapter({
    agentId: "villager-2",
    responses: ["我觉得wolf-1的发言很奇怪", "wolf-1"],
  });

  const agents = new Map<string, AgentAdapter>([
    ["wolf-1", wolf],
    ["seer-1", seer],
    ["villager-1", villager1],
    ["villager-2", villager2],
  ]);

  console.log(`Running werewolf world ${worldId} (mock agents, scripted so villagers vote out wolf-1 on day 1)\n`);

  const events = await runWorld({
    worldId,
    template: werewolfWorldTemplate,
    config: {
      players: ["wolf-1", "villager-1", "villager-2", "seer-1"],
      werewolves: ["wolf-1"],
      seer: "seer-1",
    },
    agents,
    eventLog,
  });

  console.log(`共 ${events.length} 条事件已写入 data/events.db:\n`);
  for (const event of events) {
    const actor = event.actorId ? `${event.actorId}: ` : "";
    const visibility = event.visibleTo
      ? ` [仅 ${event.visibleTo.length ? event.visibleTo.join(",") : "无 Agent"} 可见]`
      : "";
    console.log(`[#${event.sequence} ${event.type}]${visibility} ${actor}${JSON.stringify(event.payload)}`);
  }

  console.log("\n隐藏信息校验（villager-2 视角）:");
  const obs = villager2.lastObservation;
  if (!obs) throw new Error("villager-2 从未被调用过，无法校验");

  const forbiddenTypes = ["roles.assigned", "seer.result", "night.action"];
  const leakedByType = obs.history.filter((e) => forbiddenTypes.includes(e.type));
  const leakedOtherRoles = obs.history.filter((e) => e.type === "role.assigned" && e.actorId !== "villager-2");

  const dayBreakSeq = events.find((e) => e.type === "phase.start" && e.payload.phase === "day-discuss")?.sequence ?? 0;
  const leakedNightTurns = obs.history.filter(
    (e) => e.type === "turn.started" && e.sequence < dayBreakSeq && (e.actorId === "wolf-1" || e.actorId === "seer-1"),
  );

  const checks: [string, boolean][] = [
    ["未泄露 roles.assigned / seer.result / night.action", leakedByType.length === 0],
    ["未泄露其他玩家的 role.assigned", leakedOtherRoles.length === 0],
    ["未泄露夜晚阶段狼人/预言家的 turn.started", leakedNightTurns.length === 0],
    ["自己的 role.assigned 可见", obs.history.some((e) => e.type === "role.assigned" && e.actorId === "villager-2")],
    ["night.result（公共信息）可见", obs.history.some((e) => e.type === "night.result")],
  ];

  let allPassed = true;
  for (const [label, passed] of checks) {
    console.log(`  ${passed ? "✔" : "✘"} ${label}`);
    if (!passed) allPassed = false;
  }

  console.log(`\nvillager-2 实际看到的历史事件数: ${obs.history.length} / 全局事件总数（上帝视角）: ${events.length}`);

  db.close();

  if (!allPassed) {
    console.error("\n隐藏信息校验失败！");
    process.exit(1);
  }
  console.log("\n隐藏信息校验全部通过 ✔");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
