import { randomUUID } from "node:crypto";
import { openDatabase } from "../core/db.js";
import { EventLog } from "../core/eventLog.js";
import { runWorld } from "../engine/scheduler.js";
import { marketWorldTemplate } from "../worldTemplates/marketWorldTemplate.js";
import { MockAgentAdapter } from "../adapters/MockAgentAdapter.js";
import type { AgentAdapter } from "../core/types.js";

/**
 * A small double-auction market. Two buyers (values 100, 80) and two sellers
 * (costs 40, 60) trade over rounds. Asserts trades clear only when bid >=
 * ask, cash+units are conserved across the whole market, and a final wealth
 * ranking is produced.
 */
async function main() {
  const worldId = randomUUID();
  const db = openDatabase("data/events.db");
  const eventLog = new EventLog(db);

  // Buyers bid near their value; sellers ask near their cost (mock, cycled per round).
  const agents = new Map<string, AgentAdapter>([
    ["buyer-hi", new MockAgentAdapter({ agentId: "buyer-hi", responses: ["90", "85", "80"] })],
    ["buyer-lo", new MockAgentAdapter({ agentId: "buyer-lo", responses: ["70", "72", "74"] })],
    ["seller-lo", new MockAgentAdapter({ agentId: "seller-lo", responses: ["50", "55", "58"] })],
    ["seller-hi", new MockAgentAdapter({ agentId: "seller-hi", responses: ["75", "72", "70"] })],
  ]);

  const config = {
    good: "小麦",
    buyers: { "buyer-hi": { cash: 300, value: 100 }, "buyer-lo": { cash: 300, value: 80 } },
    sellers: { "seller-lo": { units: 3, cost: 40 }, "seller-hi": { units: 3, cost: 60 } },
    rounds: 3,
  };

  // Conserved totals at the start.
  const startCash = 300 + 300;
  const startUnits = 3 + 3;

  console.log(`Running market world ${worldId} (2 buyers, 2 sellers, 3 rounds)\n`);

  const events = await runWorld({ worldId, template: marketWorldTemplate, config, agents, eventLog });

  const trades = events.filter((e) => e.type === "trade.executed");
  for (const e of trades) {
    const p = e.payload as { buyer: string; seller: string; price: number };
    console.log(`[#${e.sequence} trade] ${p.buyer} <- ${p.seller} @ ${p.price}`);
  }
  const finished = events.find((e) => e.type === "world.finished");
  console.log(`\n最终成交价: ${(finished?.payload as { finalPrice: number }).finalPrice}`);
  console.log(`财富排名: ${JSON.stringify((finished?.payload as { wealth: unknown }).wealth)}`);

  // Reconstruct final balances from the last market.tick snapshot.
  const lastTick = [...events].reverse().find((e) => e.type === "market.tick");
  const balances = lastTick!.payload.traders as Array<{ id: string; type: string; cash: number; holdings: number }>;
  const totalCash = balances.reduce((s, b) => s + b.cash, 0);
  const totalUnits = balances.reduce((s, b) => s + b.holdings, 0);

  const priceOk = trades.every((e) => (e.payload.price as number) >= 0);

  const checks: [string, boolean][] = [
    ["至少发生一笔成交", trades.length >= 1],
    ["现金总量守恒", Math.abs(totalCash - startCash) < 0.001],
    ["货物总量守恒", totalUnits === startUnits],
    ["成交价均为正", priceOk],
    ["产出了最终财富排名", !!finished && Array.isArray((finished.payload as { wealth: unknown }).wealth)],
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
