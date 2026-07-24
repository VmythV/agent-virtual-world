import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { EventLog } from "../core/eventLog.js";
import type { AgentAdapter } from "../core/types.js";
import { runWorld } from "../engine/scheduler.js";
import { debateWorldTemplate, type DebateSide } from "../worldTemplates/debateWorldTemplate.js";
import { ApiAgentAdapter } from "../adapters/ApiAgentAdapter.js";
import { MockAgentAdapter } from "../adapters/MockAgentAdapter.js";
import { CliAgentAdapter } from "../adapters/CliAgentAdapter.js";
import { RuntimePool } from "../runtime/runtimePool.js";

const useRealApi = Boolean(process.env.ANTHROPIC_API_KEY);
const cliFixturePath = fileURLToPath(new URL("./fixtures/mockCliAgent.mjs", import.meta.url));

// Shared by every CLI-backed agent so the demo also exercises the
// concurrency/timeout/budget controls from RuntimePool, not just the
// happy-path process spawn.
const cliPool = new RuntimePool({ maxConcurrent: 2, timeoutMs: 5_000, maxCalls: 20 });

function buildLlmAgent(agentId: string, side: DebateSide): AgentAdapter {
  if (useRealApi) {
    return new ApiAgentAdapter({ agentId, systemPrompt: systemPromptFor(side) });
  }
  return new MockAgentAdapter({ agentId, responses: mockResponsesFor(agentId, side) });
}

function buildCliAgent(agentId: string): AgentAdapter {
  return new CliAgentAdapter({
    agentId,
    command: process.execPath,
    args: [cliFixturePath],
    pool: cliPool,
  });
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
    ["pro-1", buildLlmAgent("pro-1", "pro")],
    ["con-1", buildCliAgent("con-1")],
    ["judge-1", buildLlmAgent("judge-1", "judge")],
  ]);

  console.log(
    `Running debate world ${worldId}\n` +
      `  pro-1, judge-1 -> ${useRealApi ? "live Anthropic API" : "mock adapter (set ANTHROPIC_API_KEY for the real API)"}\n` +
      `  con-1          -> CliAgentAdapter (fixture CLI process, standing in for Claude Code / Codex CLI)\n`,
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
  console.log(
    `CliAgentAdapter 运行统计: ${JSON.stringify(cliPool.stats)} (调用次数/并发/排队情况，来自 RuntimePool)`,
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
