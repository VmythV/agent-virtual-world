import { randomUUID } from "node:crypto";
import { openDatabase } from "../core/db.js";
import { EventLog } from "../core/eventLog.js";
import { runWorld } from "../engine/scheduler.js";
import { parliamentWorldTemplate } from "../worldTemplates/parliamentWorldTemplate.js";
import { MockAgentAdapter } from "../adapters/MockAgentAdapter.js";
import type { AgentAdapter, WorldEvent } from "../core/types.js";

/**
 * Parliament (reskin of the coalition game): alice & bob caucus into a bloc
 * and both vote YES; carol votes NO. Asserts a bloc forms only on mutual
 * picks, whip offers stay private to the pair, the bill passes on the
 * majority, and carol never sees alice's private whip to bob.
 */
async function main() {
  const worldId = randomUUID();
  const db = openDatabase("data/events.db");
  const eventLog = new EventLog(db);

  // Two caucus rounds (choice=another member), then the vote (yes/no/abstain).
  const carol = new MockAgentAdapter({ agentId: "carol", responses: ["alice", "alice", "no"] });
  const agents = new Map<string, AgentAdapter>([
    ["alice", new MockAgentAdapter({ agentId: "alice", responses: ["bob", "bob", "yes"] })],
    ["bob", new MockAgentAdapter({ agentId: "bob", responses: ["alice", "alice", "yes"] })],
    ["carol", carol],
  ]);

  console.log(`Running parliament world ${worldId} (3 legislators, 2 caucus rounds, then a bill vote)\n`);

  const events = await runWorld({
    worldId,
    template: parliamentWorldTemplate,
    config: {
      bill: "《远程办公保障法》",
      members: ["alice", "bob", "carol"],
      stances: { alice: "支持", bob: "支持", carol: "反对" },
      rounds: 2,
    },
    agents,
    eventLog,
  });

  for (const e of events) {
    const vis = e.visibleTo ? ` [仅 ${e.visibleTo.join(",") || "上帝"} 可见]` : "";
    console.log(`[#${e.sequence} ${e.type}]${vis} ${e.actorId ? e.actorId + ": " : ""}${JSON.stringify(e.payload)}`);
  }

  const blocs = events.filter((e) => e.type === "bloc.formed");
  const verdict = events.find((e) => e.type === "world.verdict");
  const carolSawAliceBobWhip = carol.lastObservation!.history.some(
    (e: WorldEvent) => e.type === "whip.offer" && e.actorId === "alice",
  );

  const checks: [string, boolean][] = [
    ["恰好形成一个党团（alice↔bob 互选）", blocs.length === 1],
    ["党团成员为 alice 与 bob", !!blocs[0] && (blocs[0].payload.between as string[]).sort().join(",") === "alice,bob"],
    ["法案以 2:1 通过", verdict?.payload.passed === true],
    ["计票为 yes=2 no=1", !!verdict && (verdict.payload.tally as { yes: number; no: number }).yes === 2 && (verdict.payload.tally as { no: number }).no === 1],
    ["carol 看不到 alice 发给 bob 的私密党鞭", !carolSawAliceBobWhip],
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
