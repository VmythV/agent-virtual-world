import { randomUUID } from "node:crypto";
import { openDatabase } from "../core/db.js";
import { EventLog } from "../core/eventLog.js";
import { runWorld } from "../engine/scheduler.js";
import { werewolfWorldTemplate } from "../worldTemplates/werewolfWorldTemplate.js";
import type { AgentAction, AgentAdapter, Observation } from "../core/types.js";

/**
 * Proves multi-agent decisions run concurrently: a shared tracker counts how
 * many act() calls are in flight at once. With batched night/day-vote phases
 * the scheduler should have >= 2 agents deciding simultaneously — and the
 * game must still produce a correct result.
 */
class Tracker {
  active = 0;
  maxActive = 0;
}

class SlowMockAdapter implements AgentAdapter {
  constructor(
    readonly agentId: string,
    private readonly responses: string[],
    private readonly tracker: Tracker,
    private readonly delayMs = 120,
  ) {}
  private callCount = 0;

  async act(observation: Observation): Promise<AgentAction> {
    this.tracker.active += 1;
    this.tracker.maxActive = Math.max(this.tracker.maxActive, this.tracker.active);
    try {
      await new Promise((r) => setTimeout(r, this.delayMs));
      const raw = this.responses[this.callCount % this.responses.length];
      this.callCount += 1;
      const visible = observation.visibleState as { responseShape?: string; choices?: string[] };
      if (visible.responseShape === "choice") {
        const choices = visible.choices ?? [];
        return { type: "act", payload: { target: choices.includes(raw) ? raw : choices[0] } };
      }
      return { type: "speak", payload: { text: raw } };
    } finally {
      this.tracker.active -= 1;
    }
  }
}

async function main() {
  const worldId = randomUUID();
  const db = openDatabase("data/events.db");
  const eventLog = new EventLog(db);
  const tracker = new Tracker();

  // 1 wolf + seer + 3 villagers: night batch = 2 (wolf + seer), and — since
  // the village survives night 1 — a day-vote batch of 4. Both run
  // concurrently; villagers then vote the wolf out.
  const players = ["wolf-1", "seer-1", "villager-1", "villager-2", "villager-3"];
  const agents = new Map<string, AgentAdapter>([
    ["wolf-1", new SlowMockAdapter("wolf-1", ["villager-1", "狼人发言", "villager-2"], tracker)],
    ["seer-1", new SlowMockAdapter("seer-1", ["wolf-1", "预言家发言", "wolf-1"], tracker)],
    ["villager-1", new SlowMockAdapter("villager-1", ["(夜里出局)"], tracker)],
    ["villager-2", new SlowMockAdapter("villager-2", ["村民发言", "wolf-1"], tracker)],
    ["villager-3", new SlowMockAdapter("villager-3", ["村民发言", "wolf-1"], tracker)],
  ]);

  console.log(`Running werewolf world ${worldId} with slow (120ms) mock agents to measure concurrency\n`);

  const started = Date.now();
  const events = await runWorld({
    worldId,
    template: werewolfWorldTemplate,
    config: { players, werewolves: ["wolf-1"], seer: "seer-1" },
    agents,
    eventLog,
  });
  const elapsed = Date.now() - started;

  const verdict = events.find((e) => e.type === "world.verdict");
  const winner = verdict?.payload.winner;
  const totalActCalls = events.filter((e) => e.type === "turn.started").length;

  console.log(`最大并发 act() 数: ${tracker.maxActive}`);
  console.log(`总 act() 调用次数: ${totalActCalls}，总耗时: ${elapsed}ms`);
  console.log(`若严格串行（120ms/次）理论下限: ${totalActCalls * 120}ms`);
  console.log(`胜负结果: ${winner}`);

  const checks: [string, boolean][] = [
    ["观测到 >= 2 个 Agent 并发决策", tracker.maxActive >= 2],
    ["实际耗时明显低于严格串行下限（说明确有并发）", elapsed < totalActCalls * 120 * 0.8],
    ["游戏仍产出了有效胜负", winner === "werewolves" || winner === "villagers"],
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
