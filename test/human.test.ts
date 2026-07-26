import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { EventLog } from "../src/core/eventLog.js";
import { runWorld } from "../src/engine/scheduler.js";
import { HumanAgentAdapter, HumanDecisionHub } from "../src/adapters/HumanAgentAdapter.js";
import { MockAgentAdapter } from "../src/adapters/MockAgentAdapter.js";
import { debateWorldTemplate } from "../src/worldTemplates/debateWorldTemplate.js";
import type { AgentAdapter, WorldEvent } from "../src/core/types.js";

describe("human-as-player", () => {
  it("blocks the turn until the human submits, then resumes with their input", async () => {
    const log = new EventLog(new DatabaseSync(":memory:"));
    const hub = new HumanDecisionHub(log);

    // Auto-play the human: whenever a decision is requested, submit a canned answer.
    const submitted: string[] = [];
    log.on("appended", (e: WorldEvent) => {
      if (e.type === "decision.requested" && e.actorId) {
        const answer = `人类第 ${submitted.length + 1} 次发言`;
        submitted.push(answer);
        // resolve on the next tick so it genuinely goes through the async wait
        setTimeout(() => hub.submit(e.worldId, e.actorId!, answer), 0);
      }
    });

    await runWorld({
      worldId: "w",
      template: debateWorldTemplate,
      config: { topic: "T", rounds: 2, sides: { pro: ["me"], con: ["ai"] }, judge: "j" },
      agents: new Map<string, AgentAdapter>([
        ["me", new HumanAgentAdapter("me", hub)],
        ["ai", new MockAgentAdapter({ agentId: "ai", responses: ["ai-1", "ai-2"] })],
        ["j", new MockAgentAdapter({ agentId: "j", responses: ["verdict"] })],
      ]),
      eventLog: log,
    });

    // decision.requested is emitted by the hub straight to the log (so it
    // reaches WS/history/frontend); read the full history to assert on it.
    const events = log.history("w");
    expect(events.filter((e) => e.type === "decision.requested")).toHaveLength(2);
    const humanSpeaks = events.filter((e) => e.type === "agent.speak" && e.actorId === "me").map((e) => e.payload.text);
    expect(humanSpeaks).toEqual(["人类第 1 次发言", "人类第 2 次发言"]);
    expect(events.at(-1)!.type).toBe("world.verdict");
  });

  it("cancelWorld unblocks a pending decision so a stopped world can unwind", async () => {
    const log = new EventLog(new DatabaseSync(":memory:"));
    const hub = new HumanDecisionHub(log);
    // Cancel shortly after the decision is requested (as stop/delete would).
    log.on("appended", (e: WorldEvent) => {
      if (e.type === "decision.requested") setTimeout(() => hub.cancelWorld(e.worldId), 0);
    });
    const events = await runWorld({
      worldId: "w",
      template: debateWorldTemplate,
      config: { topic: "T", rounds: 1, sides: { pro: ["me"], con: ["ai"] }, judge: "j" },
      agents: new Map<string, AgentAdapter>([
        ["me", new HumanAgentAdapter("me", hub)],
        ["ai", new MockAgentAdapter({ agentId: "ai", responses: ["x"] })],
        ["j", new MockAgentAdapter({ agentId: "j", responses: ["v"] })],
      ]),
      eventLog: log,
    });
    // It didn't hang; the human's turn resolved (with an empty default) and the world finished.
    expect(events.some((e) => e.type === "agent.speak" && e.actorId === "me")).toBe(true);
  });
});
