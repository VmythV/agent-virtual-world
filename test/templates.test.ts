import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { EventLog } from "../src/core/eventLog.js";
import { runWorld } from "../src/engine/scheduler.js";
import { MockAgentAdapter } from "../src/adapters/MockAgentAdapter.js";
import { getWorldTemplate } from "../src/worldTemplates/registry.js";
import type { AgentAdapter, WorldEvent, WorldTemplate, WorldState } from "../src/core/types.js";

function run(templateId: string, config: Record<string, unknown>, agents: Map<string, AgentAdapter>) {
  const log = new EventLog(new DatabaseSync(":memory:"));
  const template = getWorldTemplate(templateId) as WorldTemplate<WorldState>;
  return runWorld({ worldId: "w", template, config, agents, eventLog: log });
}

const mock = (id: string, responses: string[]) => new MockAgentAdapter({ agentId: id, responses });

describe("debate template", () => {
  it("runs pro/con rounds then a judge verdict", async () => {
    const events = await run(
      "debate",
      { topic: "T", rounds: 2, sides: { pro: ["p"], con: ["c"] }, judge: "j" },
      new Map<string, AgentAdapter>([
        ["p", mock("p", ["p1", "p2"])],
        ["c", mock("c", ["c1", "c2"])],
        ["j", mock("j", ["verdict"])],
      ]),
    );
    const speaks = events.filter((e) => e.type === "agent.speak");
    expect(speaks).toHaveLength(4); // 2 rounds x 2 sides
    expect(events.at(-1)!.type).toBe("world.verdict");
  });
});

describe("problem-solving template", () => {
  it("coordinator delegates then synthesizes an answer", async () => {
    const events = await run(
      "problem-solving",
      { problem: "P", coordinator: "co", experts: ["e1", "e2"] },
      new Map<string, AgentAdapter>([
        ["co", mock("co", ["e1", "e2", "FINALIZE", "final answer"])],
        ["e1", mock("e1", ["contrib-1"])],
        ["e2", mock("e2", ["contrib-2"])],
      ]),
    );
    expect(events.filter((e) => e.type === "expert.contribution")).toHaveLength(2);
    const answer = events.find((e) => e.type === "world.answer");
    expect(answer?.actorId).toBe("co");
    expect(answer?.payload.text).toBe("final answer");
  });
});

describe("aquarium template (tick-based)", () => {
  it("emits a bounded snapshot per tick with in-bounds fish", async () => {
    const tank = { w: 8, h: 5, d: 6 };
    const events = await run(
      "aquarium",
      { fish: ["f1", "f2"], ticks: 20, tank },
      new Map<string, AgentAdapter>([
        ["f1", mock("f1", ["wander"])],
        ["f2", mock("f2", ["school"])],
      ]),
    );
    const ticks = events.filter((e) => e.type === "world.tick");
    expect(ticks).toHaveLength(21); // initial + 20
    for (const t of ticks) {
      for (const f of t.payload.fish as Array<{ x: number; z: number }>) {
        expect(Math.abs(f.x)).toBeLessThanOrEqual(tank.w / 2 + 0.01);
        expect(Math.abs(f.z)).toBeLessThanOrEqual(tank.d / 2 + 0.01);
      }
    }
  });
});

describe("werewolf template — hidden information", () => {
  it("redacts night/role/seer events from a villager's observation", async () => {
    const villager = new MockAgentAdapter({ agentId: "v2", responses: ["speak", "w1"] });
    await run(
      "werewolf",
      { players: ["w1", "s1", "v1", "v2"], werewolves: ["w1"], seer: "s1" },
      new Map<string, AgentAdapter>([
        ["w1", mock("w1", ["v1", "wolf-speak", "v2"])],
        ["s1", mock("s1", ["w1", "seer-speak", "w1"])],
        ["v1", mock("v1", ["(dies night 1)"])],
        ["v2", villager],
      ]),
    );
    const seen = villager.lastObservation!.history.map((e: WorldEvent) => e.type);
    expect(seen).not.toContain("roles.assigned");
    expect(seen).not.toContain("seer.result");
    expect(seen).not.toContain("night.action");
    // a villager never sees other players' private role.assigned
    const roleAssignedForOthers = villager.lastObservation!.history.filter(
      (e: WorldEvent) => e.type === "role.assigned" && e.actorId !== "v2",
    );
    expect(roleAssignedForOthers).toHaveLength(0);
    // but the public night.result is visible
    expect(seen).toContain("night.result");
  });

  it("produces a valid winner", async () => {
    const events = await run(
      "werewolf",
      { players: ["w1", "s1", "v1", "v2"], werewolves: ["w1"], seer: "s1" },
      new Map<string, AgentAdapter>([
        ["w1", mock("w1", ["v1", "x", "v2"])],
        ["s1", mock("s1", ["w1", "x", "w1"])],
        ["v1", mock("v1", ["x"])],
        ["v2", mock("v2", ["x", "w1"])],
      ]),
    );
    const verdict = events.find((e) => e.type === "world.verdict");
    expect(["werewolves", "villagers"]).toContain(verdict?.payload.winner);
  });
});
