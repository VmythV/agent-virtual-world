import { randomUUID } from "node:crypto";
import { openDatabase } from "../core/db.js";
import { EventLog } from "../core/eventLog.js";
import { runWorld } from "../engine/scheduler.js";
import { courtroomWorldTemplate } from "../worldTemplates/courtroomWorldTemplate.js";
import { MockAgentAdapter } from "../adapters/MockAgentAdapter.js";
import type { AgentAdapter, WorldEvent } from "../core/types.js";

/**
 * A trial: two witnesses testify (each revealing a private fact), then
 * prosecution/defense argue for two rounds, then the judge rules. Asserts a
 * witness never sees another witness's secret before testimony, the flow
 * order, and that a verdict is produced.
 */
async function main() {
  const worldId = randomUUID();
  const db = openDatabase("data/events.db");
  const eventLog = new EventLog(db);

  const w1 = new MockAgentAdapter({ agentId: "witness-1", responses: ["我那晚看见被告在现场附近。"] });
  const agents = new Map<string, AgentAdapter>([
    ["prosecutor", new MockAgentAdapter({ agentId: "prosecutor", responses: ["证据指向被告。", "综合证词，被告有罪。"] })],
    ["defense", new MockAgentAdapter({ agentId: "defense", responses: ["证据均为间接。", "无法排除合理怀疑。"] })],
    ["judge", new MockAgentAdapter({ agentId: "judge", responses: ["综合证词与辩论，本庭裁定证据不足，被告无罪。"] })],
    ["witness-1", w1],
    ["witness-2", new MockAgentAdapter({ agentId: "witness-2", responses: ["案发时被告和我在一起。"] })],
  ]);

  console.log(`Running courtroom world ${worldId} (2 witnesses, 2 argument rounds)\n`);

  const events = await runWorld({
    worldId,
    template: courtroomWorldTemplate,
    config: {
      caseTitle: "国家 诉 被告：盗窃案",
      prosecutor: "prosecutor",
      defense: "defense",
      judge: "judge",
      witnesses: { "witness-1": "看见被告在现场附近", "witness-2": "案发时与被告在一起（不在场证明）" },
      rounds: 2,
    },
    agents,
    eventLog,
  });

  for (const e of events) {
    const vis = e.visibleTo ? ` [仅 ${e.visibleTo.join(",")} 可见]` : "";
    console.log(`[#${e.sequence} ${e.type}]${vis} ${e.actorId ? e.actorId + ": " : ""}${JSON.stringify(e.payload)}`);
  }

  const testimony = events.filter((e) => e.type === "testimony");
  const args = events.filter((e) => e.type === "agent.speak");
  const verdict = events.find((e) => e.type === "world.verdict");
  // witness-1 must not see witness-2's private knowledge before testifying.
  const w1SawOtherKnowledge = w1.lastObservation!.history.some(
    (e: WorldEvent) => e.type === "knowledge.assigned" && e.actorId !== "witness-1",
  );

  const checks: [string, boolean][] = [
    ["两名证人各作证一次", testimony.length === 2],
    ["控辩双方各两轮共 4 次陈述", args.length === 4],
    ["法官作出裁决", !!verdict && verdict.actorId === "judge"],
    ["证人未看到其他证人的私密事实", !w1SawOtherKnowledge],
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
