import { randomUUID } from "node:crypto";
import { openDatabase } from "../core/db.js";
import { EventLog } from "../core/eventLog.js";
import { runWorld } from "../engine/scheduler.js";
import { debateWorldTemplate } from "../worldTemplates/debateWorldTemplate.js";
import type { AgentAction, AgentAdapter, Observation } from "../core/types.js";

/**
 * Deterministically validates the "god" command channel end-to-end through
 * the real scheduler + event log (no API cost). During pro-1's first turn
 * an instruction is injected targeting con-1; because the scheduler
 * re-reads the log each turn, con-1's very next Observation should carry
 * it — and only con-1's, only once.
 */
const INSTRUCTION = "请在你的发言中明确提到「弹性工作制」这个词。";

class RecordingAdapter implements AgentAdapter {
  readonly observations: Observation[] = [];
  constructor(readonly agentId: string, private readonly reply: string, private readonly onFirstAct?: () => void) {}

  async act(observation: Observation): Promise<AgentAction> {
    // Snapshot instruction (the scheduler mutates the object we're handed).
    this.observations.push({ ...observation });
    if (this.observations.length === 1) this.onFirstAct?.();
    return { type: "speak", payload: { text: this.reply } };
  }
}

async function main() {
  const worldId = randomUUID();
  const db = openDatabase("data/events.db");
  const eventLog = new EventLog(db);

  // pro-1 injects the god instruction (targeting con-1) during its first turn.
  const pro = new RecordingAdapter("pro-1", "[pro-1] 正方发言", () => {
    eventLog.append(worldId, {
      type: "god.instruction",
      payload: { targetAgentId: "con-1", text: INSTRUCTION },
      visibleTo: ["con-1"],
      highlight: true,
    });
    console.log("（在 pro-1 回合中注入了一条针对 con-1 的上帝指令）");
  });
  const con = new RecordingAdapter("con-1", "[con-1] 反方发言");
  const judge = new RecordingAdapter("judge-1", "裁定：平局");

  const agents = new Map<string, AgentAdapter>([
    ["pro-1", pro],
    ["con-1", con],
    ["judge-1", judge],
  ]);

  console.log(`Running debate world ${worldId} to test the god instruction channel\n`);

  await runWorld({
    worldId,
    template: debateWorldTemplate,
    config: { topic: "远程办公利大于弊", rounds: 2, sides: { pro: ["pro-1"], con: ["con-1"] }, judge: "judge-1" },
    agents,
    eventLog,
  });

  const conFirst = con.observations[0]?.instruction;
  const conSecond = con.observations[1]?.instruction;
  const proEverSaw = pro.observations.some((o) => (o.instruction ?? "").includes(INSTRUCTION));

  console.log(`con-1 第一次观测的 instruction: ${JSON.stringify(conFirst)}`);
  console.log(`con-1 第二次观测的 instruction: ${JSON.stringify(conSecond)}`);
  console.log(`pro-1 是否在任何一次观测里收到该指令: ${proEverSaw}`);

  const checks: [string, boolean][] = [
    ["con-1 首次观测收到了上帝指令", !!conFirst && conFirst.includes(INSTRUCTION)],
    ["指令只送达一次（con-1 第二次观测不再重复）", !conSecond || !conSecond.includes(INSTRUCTION)],
    ["定向指令未泄露给 pro-1", !proEverSaw],
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
