import { randomUUID } from "node:crypto";
import { openDatabase } from "../core/db.js";
import { EventLog } from "../core/eventLog.js";
import { runWorld } from "../engine/scheduler.js";
import { negotiationWorldTemplate } from "../worldTemplates/negotiationWorldTemplate.js";
import { MockAgentAdapter } from "../adapters/MockAgentAdapter.js";
import type { AgentAdapter, WorldEvent } from "../core/types.js";

/**
 * Coalition game: alice & bob mutually ally and both vote alice; carol is
 * left out. Asserts a pact forms only on mutual picks, offers stay private
 * to the pair, the coalition's candidate wins, and carol never sees alice's
 * private offer to bob.
 */
async function main() {
  const worldId = randomUUID();
  const db = openDatabase("data/events.db");
  const eventLog = new EventLog(db);

  // Round 1 & 2 picks then the vote (choice responses cycle per call).
  const carol = new MockAgentAdapter({ agentId: "carol", responses: ["alice", "alice", "carol"] });
  const agents = new Map<string, AgentAdapter>([
    ["alice", new MockAgentAdapter({ agentId: "alice", responses: ["bob", "bob", "alice"] })],
    ["bob", new MockAgentAdapter({ agentId: "bob", responses: ["alice", "alice", "alice"] })],
    ["carol", carol],
  ]);

  console.log(`Running negotiation world ${worldId} (3 players, 2 alliance rounds, then vote)\n`);

  const events = await runWorld({
    worldId,
    template: negotiationWorldTemplate,
    config: { prize: "100 金币", players: ["alice", "bob", "carol"], rounds: 2 },
    agents,
    eventLog,
  });

  for (const e of events) {
    const vis = e.visibleTo ? ` [仅 ${e.visibleTo.join(",")} 可见]` : "";
    console.log(`[#${e.sequence} ${e.type}]${vis} ${e.actorId ? e.actorId + ": " : ""}${JSON.stringify(e.payload)}`);
  }

  const pacts = events.filter((e) => e.type === "pact.formed");
  const verdict = events.find((e) => e.type === "world.verdict");
  // carol must not see alice's private offer to bob.
  const carolSawAliceBobOffer = carol.lastObservation!.history.some(
    (e: WorldEvent) => e.type === "pact.offer" && e.actorId === "alice",
  );

  const checks: [string, boolean][] = [
    ["恰好形成一个联盟（alice↔bob 互选）", pacts.length === 1],
    ["联盟成员为 alice 与 bob", pacts[0] && (pacts[0].payload.between as string[]).sort().join(",") === "alice,bob"],
    ["联盟推举的 alice 获胜", verdict?.payload.winner === "alice"],
    ["carol 看不到 alice 发给 bob 的私密提议", !carolSawAliceBobOffer],
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
