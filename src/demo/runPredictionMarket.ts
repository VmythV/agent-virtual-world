import { randomUUID } from "node:crypto";
import { openDatabase } from "../core/db.js";
import { EventLog } from "../core/eventLog.js";
import { runWorld } from "../engine/scheduler.js";
import { predictionMarketWorldTemplate } from "../worldTemplates/predictionMarketWorldTemplate.js";
import { MockAgentAdapter } from "../adapters/MockAgentAdapter.js";
import type { AgentAdapter } from "../core/types.js";

/**
 * Prediction market (reskin of the double auction): traders buy/sell YES
 * contracts on a binary event. Bulls bid high, bears ask low, contracts change
 * hands, and the clearing price reads as an implied probability. The event
 * then resolves TRUE — YES contracts settle at 100. Asserts trades clear,
 * cash+contracts are conserved through trading, the outcome stays god-only
 * until resolution, and a final wealth ranking is produced.
 */
async function main() {
  const worldId = randomUUID();
  const db = openDatabase("data/events.db");
  const eventLog = new EventLog(db);

  // Bulls bid up near 100; a bear sells its contracts cheaply (cycled per round).
  const agents = new Map<string, AgentAdapter>([
    ["bull-1", new MockAgentAdapter({ agentId: "bull-1", responses: ["70", "75", "80"] })],
    ["bull-2", new MockAgentAdapter({ agentId: "bull-2", responses: ["65", "72", "78"] })],
    ["bear-1", new MockAgentAdapter({ agentId: "bear-1", responses: ["60", "62", "66"] })],
    ["bear-2", new MockAgentAdapter({ agentId: "bear-2", responses: ["55", "58", "62"] })],
  ]);

  const config = {
    event: "下季度产品会如期发布吗？",
    outcome: true, // god-only truth; resolves at the end
    buyers: { "bull-1": { cash: 400, belief: 0.85 }, "bull-2": { cash: 400, belief: 0.75 } },
    sellers: { "bear-1": { shares: 3, belief: 0.55 }, "bear-2": { shares: 3, belief: 0.45 } },
    rounds: 3,
  };

  const startCash = 400 + 400;
  const startShares = 3 + 3;

  console.log(`Running prediction-market world ${worldId} (2 buyers, 2 sellers, 3 rounds, outcome=TRUE)\n`);

  const events = await runWorld({ worldId, template: predictionMarketWorldTemplate, config, agents, eventLog });

  const trades = events.filter((e) => e.type === "trade.executed");
  for (const e of trades) {
    const p = e.payload as { buyer: string; seller: string; price: number; impliedProbability: number };
    console.log(`[#${e.sequence} trade] ${p.buyer} <- ${p.seller} @ ${p.price}（隐含概率 ${p.impliedProbability}）`);
  }
  const finished = events.find((e) => e.type === "world.finished");
  const fp = finished?.payload as { outcome: boolean; finalImpliedProbability: number; wealth: unknown };
  console.log(`\n事件结算: ${fp.outcome ? "发生（YES=100）" : "未发生（YES=0）"}`);
  console.log(`最终隐含概率: ${fp.finalImpliedProbability}`);
  console.log(`财富排名: ${JSON.stringify(fp.wealth)}`);

  // Conservation only holds DURING trading (before settlement mints/burns value),
  // so reconstruct from the last market.tick, which is emitted pre-settlement.
  const lastTick = [...events].reverse().find((e) => e.type === "market.tick");
  const balances = lastTick!.payload.traders as Array<{ id: string; cash: number; shares: number }>;
  const totalCash = balances.reduce((s, b) => s + b.cash, 0);
  const totalShares = balances.reduce((s, b) => s + b.shares, 0);

  // The outcome must never have been visible to any trader before resolution.
  const sealed = events.find((e) => e.type === "outcome.sealed");
  const outcomeGodOnly = !!sealed && Array.isArray(sealed.visibleTo) && sealed.visibleTo.length === 0;

  const checks: [string, boolean][] = [
    ["至少发生一笔成交", trades.length >= 1],
    ["交易期间现金守恒", Math.abs(totalCash - startCash) < 0.001],
    ["交易期间合约守恒", totalShares === startShares],
    ["真实结果对交易者保密（仅上帝可见）", outcomeGodOnly],
    ["结算后产出财富排名", !!finished && Array.isArray(fp.wealth)],
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
