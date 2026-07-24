import { randomUUID } from "node:crypto";
import { openDatabase } from "../core/db.js";
import { EventLog } from "../core/eventLog.js";
import { runWorld } from "../engine/scheduler.js";
import { humanLabWorldTemplate } from "../worldTemplates/humanLabWorldTemplate.js";
import { MockAgentAdapter } from "../adapters/MockAgentAdapter.js";
import type { AgentAdapter, WorldEvent } from "../core/types.js";

/**
 * Scripted human-experiment run: three "people" with secret personas react
 * to a scenario over two rounds, then an observer summarizes. Asserts the
 * per-agent persona redaction (a participant never sees another's persona).
 */
async function main() {
  const worldId = randomUUID();
  const db = openDatabase("data/events.db");
  const eventLog = new EventLog(db);

  const alice = new MockAgentAdapter({ agentId: "alice", responses: ["(乐观地)我相信大家会合作。", "还是选择信任。"] });
  const agents = new Map<string, AgentAdapter>([
    ["alice", alice],
    ["bob", new MockAgentAdapter({ agentId: "bob", responses: ["(多疑地)我担心有人会背叛。", "我要保护自己。"] })],
    ["carol", new MockAgentAdapter({ agentId: "carol", responses: ["(务实地)看收益再决定。", "权衡利弊后行动。"] })],
    ["observer", new MockAgentAdapter({ agentId: "observer", responses: ["观察结论：乐观者推动合作，多疑者引发防御，务实者随收益摇摆。"] })],
  ]);

  console.log(`Running human-lab world ${worldId} (3 personas + observer, 2 rounds)\n`);

  const events = await runWorld({
    worldId,
    template: humanLabWorldTemplate,
    config: {
      scenario: "囚徒困境的重复博弈：合作或背叛。",
      rounds: 2,
      personas: { alice: "乐观、信任他人", bob: "多疑、防御性强", carol: "务实、利益驱动" },
      observer: "observer",
    },
    agents,
    eventLog,
  });

  for (const e of events) {
    const vis = e.visibleTo ? ` [仅 ${e.visibleTo.length ? e.visibleTo.join(",") : "无 Agent"} 可见]` : "";
    console.log(`[#${e.sequence} ${e.type}]${vis} ${e.actorId ? e.actorId + ": " : ""}${JSON.stringify(e.payload)}`);
  }

  const seen = alice.lastObservation!.history.map((e: WorldEvent) => e.type);
  const otherPersonas = alice.lastObservation!.history.filter(
    (e: WorldEvent) => e.type === "persona.assigned" && e.actorId !== "alice",
  );
  const speaks = events.filter((e) => e.type === "agent.speak");
  const summary = events.find((e) => e.type === "experiment.summary");

  const checks: [string, boolean][] = [
    ["三人各两轮共 6 次发言", speaks.length === 6],
    ["未泄露整体 personas.assigned 给参与者", !seen.includes("personas.assigned")],
    ["未泄露他人的 persona.assigned", otherPersonas.length === 0],
    ["alice 能看到自己的 persona.assigned", alice.lastObservation!.history.some((e: WorldEvent) => e.type === "persona.assigned" && e.actorId === "alice")],
    ["观察者产出了实验总结", !!summary && summary.actorId === "observer"],
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
