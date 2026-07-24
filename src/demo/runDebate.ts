import { randomUUID } from "node:crypto";
import { EventLog } from "../core/eventLog.js";
import type { AgentAdapter } from "../core/types.js";
import { runWorld } from "../engine/scheduler.js";
import { debateWorldTemplate, type DebateSide } from "../worldTemplates/debateWorldTemplate.js";
import { ApiAgentAdapter } from "../adapters/ApiAgentAdapter.js";
import { MockAgentAdapter } from "../adapters/MockAgentAdapter.js";

const useRealApi = Boolean(process.env.ANTHROPIC_API_KEY);

function buildAgent(agentId: string, side: DebateSide): AgentAdapter {
  if (useRealApi) {
    return new ApiAgentAdapter({ agentId, systemPrompt: systemPromptFor(side) });
  }
  return new MockAgentAdapter({ agentId, responses: mockResponsesFor(agentId, side) });
}

function systemPromptFor(side: DebateSide): string {
  if (side === "judge") {
    return "你是一场辩论赛的裁判。根据双方发言给出简短总结，并判定获胜方。";
  }
  return `你是一场辩论赛的${side === "pro" ? "正方" : "反方"}辩手。针对辩题给出简短有力的发言，不要重复对方已经说过的论点。`;
}

function mockResponsesFor(agentId: string, side: DebateSide): string[] {
  if (side === "judge") {
    return ["综合双方论点，正方论据更充分、反方回应较弱，本场判正方胜。"];
  }
  const stance = side === "pro" ? "支持" : "反对";
  return [
    `[${agentId}] 第一轮：${stance}该观点——效率与灵活性是核心理由。`,
    `[${agentId}] 第二轮：回应对方质疑，并补充数据支撑。`,
  ];
}

async function main() {
  const worldId = randomUUID();
  const eventLog = new EventLog("data/events.db");

  const agents = new Map<string, AgentAdapter>([
    ["pro-1", buildAgent("pro-1", "pro")],
    ["con-1", buildAgent("con-1", "con")],
    ["judge-1", buildAgent("judge-1", "judge")],
  ]);

  console.log(
    `Running debate world ${worldId} using ${
      useRealApi ? "the live Anthropic API" : "mock adapters (set ANTHROPIC_API_KEY to use the real API)"
    }\n`,
  );

  const events = await runWorld({
    worldId,
    template: debateWorldTemplate,
    config: {
      topic: "远程办公利大于弊",
      rounds: 2,
      sides: { pro: ["pro-1"], con: ["con-1"] },
      judge: "judge-1",
    },
    agents,
    eventLog,
  });

  console.log(`共 ${events.length} 条事件已写入 data/events.db:\n`);
  for (const event of events) {
    const actor = event.actorId ? `${event.actorId}: ` : "";
    console.log(`[#${event.sequence} ${event.type}] ${actor}${JSON.stringify(event.payload)}`);
  }

  const replay = eventLog.history(worldId);
  const persistedCorrectly =
    replay.length === events.length && replay.every((e, i) => e.id === events[i].id);
  console.log(
    `\n回放校验: 从 SQLite 读回 ${replay.length} 条事件，与运行时产生的事件${
      persistedCorrectly ? "完全一致 ✔" : "不一致 ✘"
    }`,
  );

  eventLog.close();

  if (!persistedCorrectly) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
