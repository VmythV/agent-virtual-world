import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { EventLog } from "../src/core/eventLog.js";
import { runWorld } from "../src/engine/scheduler.js";
import { MockAgentAdapter } from "../src/adapters/MockAgentAdapter.js";
import { debateWorldTemplate } from "../src/worldTemplates/debateWorldTemplate.js";
import { werewolfWorldTemplate } from "../src/worldTemplates/werewolfWorldTemplate.js";
import type { AgentAction, AgentAdapter, Observation } from "../src/core/types.js";

describe("god instruction delivery", () => {
  it("delivers a targeted instruction to its target's next observation, once, and not to others", async () => {
    const log = new EventLog(new DatabaseSync(":memory:"));

    class Recording implements AgentAdapter {
      readonly observations: Observation[] = [];
      constructor(
        readonly agentId: string,
        private readonly onFirst?: () => void,
      ) {}
      async act(o: Observation): Promise<AgentAction> {
        this.observations.push({ ...o });
        if (this.observations.length === 1) this.onFirst?.();
        return { type: "speak", payload: { text: "x" } };
      }
    }

    // During pro's first turn, inject an instruction targeting con.
    const pro = new Recording("p", () => {
      log.append("w", {
        type: "god.instruction",
        payload: { targetAgentId: "c", text: "SECRET" },
        visibleTo: ["c"],
      });
    });
    const con = new Recording("c");

    await runWorld({
      worldId: "w",
      template: debateWorldTemplate,
      config: { topic: "T", rounds: 2, sides: { pro: ["p"], con: ["c"] }, judge: "j" },
      agents: new Map<string, AgentAdapter>([
        ["p", pro],
        ["c", con],
        ["j", new MockAgentAdapter({ agentId: "j", responses: ["v"] })],
      ]),
      eventLog: log,
    });

    expect(con.observations[0]?.instruction).toContain("SECRET");
    expect(con.observations[1]?.instruction ?? "").not.toContain("SECRET"); // delivered once
    expect(pro.observations.every((o) => !(o.instruction ?? "").includes("SECRET"))).toBe(true); // no leak
  });
});

describe("concurrent multi-agent decisions (nextActors)", () => {
  it("runs a batch of agents' act() calls in parallel", async () => {
    const log = new EventLog(new DatabaseSync(":memory:"));
    let active = 0;
    let maxActive = 0;

    class Slow implements AgentAdapter {
      constructor(
        readonly agentId: string,
        private readonly responses: string[],
      ) {}
      private i = 0;
      async act(o: Observation): Promise<AgentAction> {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 20));
        active -= 1;
        const raw = this.responses[this.i++ % this.responses.length];
        const vs = o.visibleState as { responseShape?: string; choices?: string[] };
        if (vs.responseShape === "choice") {
          return { type: "act", payload: { target: (vs.choices ?? []).includes(raw) ? raw : (vs.choices ?? [])[0] } };
        }
        return { type: "speak", payload: { text: raw } };
      }
    }

    await runWorld({
      worldId: "w",
      template: werewolfWorldTemplate,
      config: { players: ["w1", "s1", "v1", "v2", "v3"], werewolves: ["w1"], seer: "s1" },
      agents: new Map<string, AgentAdapter>([
        ["w1", new Slow("w1", ["v1", "x", "v2"])],
        ["s1", new Slow("s1", ["w1", "x", "w1"])],
        ["v1", new Slow("v1", ["x"])],
        ["v2", new Slow("v2", ["x", "w1"])],
        ["v3", new Slow("v3", ["x", "w1"])],
      ]),
      eventLog: log,
    });

    // The day-vote batch (4 alive voters) should overlap in flight.
    expect(maxActive).toBeGreaterThanOrEqual(2);
  });
});

describe("abort signal", () => {
  it("stops a tick-based world cleanly when aborted", async () => {
    const { aquariumWorldTemplate } = await import("../src/worldTemplates/aquariumWorldTemplate.js");
    const log = new EventLog(new DatabaseSync(":memory:"));
    const controller = new AbortController();
    // Abort almost immediately; with a tick interval the loop should exit early.
    setTimeout(() => controller.abort(), 30);
    const events = await runWorld({
      worldId: "w",
      template: aquariumWorldTemplate,
      config: { fish: ["f1"], ticks: 100000 },
      agents: new Map<string, AgentAdapter>([["f1", new MockAgentAdapter({ agentId: "f1", responses: ["wander"] })]]),
      eventLog: log,
      tickIntervalMs: 10,
      signal: controller.signal,
    });
    // Far fewer than the 100000 configured ticks.
    expect(events.filter((e) => e.type === "world.tick").length).toBeLessThan(100);
    expect(events.find((e) => e.type === "world.finished")).toBeUndefined();
  });
});
