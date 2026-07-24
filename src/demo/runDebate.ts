import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../core/db.js";
import { EventLog } from "../core/eventLog.js";
import type { AgentAdapter } from "../core/types.js";
import type { AgentConfig } from "../core/agentConfig.js";
import { createAgentAdapter } from "../core/agentFactory.js";
import { runWorld } from "../engine/scheduler.js";
import { debateWorldTemplate, type DebateSide } from "../worldTemplates/debateWorldTemplate.js";
import { RuntimePool } from "../runtime/runtimePool.js";

const useRealApi = Boolean(process.env.ANTHROPIC_API_KEY);
const useMockCli = Boolean(process.env.USE_MOCK_CLI);
const cliFixturePath = fileURLToPath(new URL("./fixtures/mockCliAgent.mjs", import.meta.url));

function systemPromptFor(side: DebateSide): string {
  if (side === "judge") {
    return "你是一场辩论赛的裁判。根据双方发言给出简短总结，并判定获胜方。只输出总结和判定，不要解释你的思考过程。";
  }
  return `你是一场辩论赛的${side === "pro" ? "正方" : "反方"}辩手。针对辩题给出简短有力的发言（不超过两句话），不要重复对方已经说过的论点，只输出发言内容本身。`;
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

/** pro-1/judge-1: real API when a key is set, otherwise a deterministic mock. */
function llmAgentConfig(agentId: string, side: DebateSide): AgentConfig {
  if (useRealApi) {
    return { agentId, adapter: "api", systemPrompt: systemPromptFor(side) };
  }
  return { agentId, adapter: "mock", responses: mockResponsesFor(agentId, side) };
}

/**
 * con-1: CLI-backed agent, config-driven so this is exactly what the (future)
 * Admin Console would let you pick — a named preset ("claude-code") with a
 * few knobs, or "custom" with a fully explicit command/args. Defaults to the
 * real `claude` CLI; set USE_MOCK_CLI=1 to fall back to the free/fast fixture
 * script for repeated local testing without spending real API budget.
 */
function cliAgentConfig(agentId: string, side: DebateSide): AgentConfig {
  if (useMockCli) {
    return {
      agentId,
      adapter: "cli",
      cli: { preset: "custom", command: process.execPath, args: [cliFixturePath] },
    };
  }
  return {
    agentId,
    adapter: "cli",
    cli: {
      preset: "claude-code",
      systemPrompt: systemPromptFor(side),
      model: "haiku",
      maxBudgetUsd: 0.05,
    },
  };
}

async function main() {
  const worldId = randomUUID();
  const db = openDatabase("data/events.db");
  const eventLog = new EventLog(db);
  const cliPool = new RuntimePool({ maxConcurrent: 2, timeoutMs: 90_000, maxCalls: 20 });

  const agentConfigs: AgentConfig[] = [
    llmAgentConfig("pro-1", "pro"),
    cliAgentConfig("con-1", "con"),
    llmAgentConfig("judge-1", "judge"),
  ];
  const agents = new Map<string, AgentAdapter>(
    agentConfigs.map((config) => [config.agentId, createAgentAdapter(config, { cliPool })]),
  );

  console.log(
    `Running debate world ${worldId}\n` +
      `  pro-1, judge-1 -> ${useRealApi ? "live Anthropic API" : "mock adapter (set ANTHROPIC_API_KEY for the real API)"}\n` +
      `  con-1          -> CliAgentAdapter, preset "${useMockCli ? "custom (fixture script)" : "claude-code (real claude -p)"}"` +
      `${useMockCli ? " — unset USE_MOCK_CLI to use the real CLI" : " (set USE_MOCK_CLI=1 for a free/fast fixture run)"}\n`,
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

  db.close();

  if (!persistedCorrectly) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
