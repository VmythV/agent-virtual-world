import { randomUUID } from "node:crypto";
import { openDatabase } from "../core/db.js";
import { EventLog } from "../core/eventLog.js";
import { runWorld } from "../engine/scheduler.js";
import { escapeRoomWorldTemplate } from "../worldTemplates/escapeRoomWorldTemplate.js";
import { MockAgentAdapter } from "../adapters/MockAgentAdapter.js";
import type { AgentAdapter, WorldEvent } from "../core/types.js";

/**
 * A 3-digit lock: each member privately knows one digit + position; the
 * solver assembles "738". Asserts each member shares once, a member never
 * sees another's private clue, and the solver escapes with the right code.
 */
async function main() {
  const worldId = randomUUID();
  const db = openDatabase("data/events.db");
  const eventLog = new EventLog(db);

  const m1 = new MockAgentAdapter({ agentId: "alice", responses: ["第一位是 7"] });
  const agents = new Map<string, AgentAdapter>([
    ["alice", m1],
    ["bob", new MockAgentAdapter({ agentId: "bob", responses: ["第二位是 3"] })],
    ["carol", new MockAgentAdapter({ agentId: "carol", responses: ["第三位是 8"] })],
    ["solver", new MockAgentAdapter({ agentId: "solver", responses: ["综合三条线索，密码是 738"] })],
  ]);

  console.log(`Running escape-room world ${worldId} (3 clue-holders + 1 solver)\n`);

  const events = await runWorld({
    worldId,
    template: escapeRoomWorldTemplate,
    config: {
      puzzle: "打开三位数密码锁逃出房间",
      solution: "738",
      clues: { alice: "第一位数字是 7", bob: "第二位数字是 3", carol: "第三位数字是 8" },
      solver: "solver",
      rounds: 1,
    },
    agents,
    eventLog,
  });

  for (const e of events) {
    const vis = e.visibleTo ? ` [仅 ${e.visibleTo.join(",")} 可见]` : "";
    console.log(`[#${e.sequence} ${e.type}]${vis} ${e.actorId ? e.actorId + ": " : ""}${JSON.stringify(e.payload)}`);
  }

  const shared = events.filter((e) => e.type === "clue.shared");
  const result = events.find((e) => e.type === "escape.result");
  // alice must not see bob's/carol's private clue.
  const aliceSawOthers = m1.lastObservation!.history.some(
    (e: WorldEvent) => e.type === "clue.assigned" && e.actorId !== "alice",
  );

  const checks: [string, boolean][] = [
    ["三名成员各分享一次线索", shared.length === 3],
    ["成员看不到其他成员的私密线索", !aliceSawOthers],
    ["solver 拼出正确密码，逃脱成功", result?.payload.success === true],
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
