import { randomUUID } from "node:crypto";
import { openDatabase } from "../core/db.js";
import { EventLog } from "../core/eventLog.js";
import { runWorld } from "../engine/scheduler.js";
import { auctionWorldTemplate } from "../worldTemplates/auctionWorldTemplate.js";
import { MockAgentAdapter } from "../adapters/MockAgentAdapter.js";
import type { AgentAdapter, WorldEvent } from "../core/types.js";

/**
 * Sealed-bid auction with private valuations. Two items; each bidder bids a
 * number for each. Asserts the sealed bids stay hidden from other bidders,
 * that the highest bidder wins at their price, and a valid result per item.
 */
async function main() {
  const worldId = randomUUID();
  const db = openDatabase("data/events.db");
  const eventLog = new EventLog(db);

  // valuations: alice 100, bob 80, carol 60. Mock bids (number strings).
  const alice = new MockAgentAdapter({ agentId: "alice", responses: ["90", "70"] });
  const agents = new Map<string, AgentAdapter>([
    ["alice", alice],
    ["bob", new MockAgentAdapter({ agentId: "bob", responses: ["75", "78"] })],
    ["carol", new MockAgentAdapter({ agentId: "carol", responses: ["55", "60"] })],
  ]);

  console.log(`Running auction world ${worldId} (2 sealed-bid items, private valuations)\n`);

  const events = await runWorld({
    worldId,
    template: auctionWorldTemplate,
    config: { items: ["古董花瓶", "限量球鞋"], valuations: { alice: 100, bob: 80, carol: 60 } },
    agents,
    eventLog,
  });

  for (const e of events) {
    const vis = e.visibleTo ? ` [仅 ${e.visibleTo.join(",")} 可见]` : "";
    console.log(`[#${e.sequence} ${e.type}]${vis} ${e.actorId ? e.actorId + ": " : ""}${JSON.stringify(e.payload)}`);
  }

  const results = events.filter((e) => e.type === "auction.result");
  // Bidder alice must never see bob's/carol's sealed bids in her observation.
  const aliceSaw = alice.lastObservation!.history.map((e: WorldEvent) => e.type);
  const leakedBids = alice.lastObservation!.history.filter(
    (e: WorldEvent) => e.type === "bid.placed" && e.actorId !== "alice",
  );

  const item1 = results[0]?.payload as { winner: string; price: number };

  const checks: [string, boolean][] = [
    ["两件拍品各出一个结果", results.length === 2],
    ["第一件由出价最高者(alice 90)赢得，成交价=其出价", item1?.winner === "alice" && item1?.price === 90],
    ["密封出价未泄露给其他竞拍者", leakedBids.length === 0],
    ["竞拍者能看到自己的估值分配", aliceSaw.includes("valuation.assigned")],
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
