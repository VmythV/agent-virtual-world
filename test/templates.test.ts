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

describe("auction template — sealed bids + numeric actions", () => {
  it("highest bidder wins at their price; sealed bids stay private", async () => {
    const alice = new MockAgentAdapter({ agentId: "alice", responses: ["90", "70"] });
    const events = await run(
      "auction",
      { items: ["itemA", "itemB"], valuations: { alice: 100, bob: 80 } },
      new Map<string, AgentAdapter>([
        ["alice", alice],
        ["bob", mock("bob", ["75", "78"])],
      ]),
    );
    const results = events.filter((e) => e.type === "auction.result");
    expect(results).toHaveLength(2);
    expect(results[0].payload.winner).toBe("alice");
    expect(results[0].payload.price).toBe(90); // first-price
    expect(results[1].payload.winner).toBe("bob"); // 78 > alice's 70

    // alice's observation never contains bob's sealed bid.
    const leaked = alice.lastObservation!.history.filter(
      (e: WorldEvent) => e.type === "bid.placed" && e.actorId !== "alice",
    );
    expect(leaked).toHaveLength(0);
  });

  it("clamps a bid to the bidder's valuation (no overbidding above value)", async () => {
    const events = await run(
      "auction",
      { items: ["x"], valuations: { a: 50, b: 40 } },
      new Map<string, AgentAdapter>([
        ["a", mock("a", ["9999"])], // tries to overbid
        ["b", mock("b", ["30"])],
      ]),
    );
    const result = events.find((e) => e.type === "auction.result");
    expect(result!.payload.price).toBe(50); // clamped to valuation
  });
});

describe("human-lab template — private personas", () => {
  it("keeps each person's persona private and runs to an observer summary", async () => {
    const alice = new MockAgentAdapter({ agentId: "alice", responses: ["hi", "hi2"] });
    const events = await run(
      "human-lab",
      { scenario: "S", rounds: 2, personas: { alice: "optimist", bob: "skeptic" }, observer: "obs" },
      new Map<string, AgentAdapter>([
        ["alice", alice],
        ["bob", mock("bob", ["b1", "b2"])],
        ["obs", mock("obs", ["summary"])],
      ]),
    );
    expect(events.filter((e) => e.type === "agent.speak")).toHaveLength(4); // 2 people x 2 rounds
    expect(events.at(-1)!.type).toBe("experiment.summary");

    const seen = alice.lastObservation!.history;
    expect(seen.some((e: WorldEvent) => e.type === "personas.assigned")).toBe(false);
    expect(seen.filter((e: WorldEvent) => e.type === "persona.assigned" && e.actorId !== "alice")).toHaveLength(0);
    expect(seen.some((e: WorldEvent) => e.type === "persona.assigned" && e.actorId === "alice")).toBe(true);
  });
});

describe("escape-room template — asymmetric clues", () => {
  it("members keep clues private, solver escapes with the combined answer", async () => {
    const alice = new MockAgentAdapter({ agentId: "alice", responses: ["first is 7"] });
    const events = await run(
      "escape-room",
      {
        puzzle: "3-digit lock",
        solution: "738",
        clues: { alice: "digit 1 is 7", bob: "digit 2 is 3", carol: "digit 3 is 8" },
        solver: "solver",
        rounds: 1,
      },
      new Map<string, AgentAdapter>([
        ["alice", alice],
        ["bob", mock("bob", ["second is 3"])],
        ["carol", mock("carol", ["third is 8"])],
        ["solver", mock("solver", ["the code is 738"])],
      ]),
    );
    expect(events.filter((e) => e.type === "clue.shared")).toHaveLength(3);
    expect(events.find((e) => e.type === "escape.result")!.payload.success).toBe(true);
    // alice never saw another member's private clue.
    expect(
      alice.lastObservation!.history.some((e: WorldEvent) => e.type === "clue.assigned" && e.actorId !== "alice"),
    ).toBe(false);
  });

  it("fails the escape when the solver's answer is wrong", async () => {
    const events = await run(
      "escape-room",
      { puzzle: "P", solution: "738", clues: { a: "x", b: "y" }, solver: "s", rounds: 1 },
      new Map<string, AgentAdapter>([
        ["a", mock("a", ["x"])],
        ["b", mock("b", ["y"])],
        ["s", mock("s", ["maybe 111?"])],
      ]),
    );
    expect(events.find((e) => e.type === "escape.result")!.payload.success).toBe(false);
  });
});

describe("market template — double auction, conservation", () => {
  it("clears trades and conserves cash + goods across the market", async () => {
    const events = await run(
      "market",
      {
        good: "g",
        buyers: { bh: { cash: 300, value: 100 }, bl: { cash: 300, value: 80 } },
        sellers: { sl: { units: 3, cost: 40 }, sh: { units: 3, cost: 60 } },
        rounds: 3,
      },
      new Map<string, AgentAdapter>([
        ["bh", mock("bh", ["90", "85", "80"])],
        ["bl", mock("bl", ["70", "72", "74"])],
        ["sl", mock("sl", ["50", "55", "58"])],
        ["sh", mock("sh", ["75", "72", "70"])],
      ]),
    );
    expect(events.filter((e) => e.type === "trade.executed").length).toBeGreaterThanOrEqual(1);

    const lastTick = [...events].reverse().find((e) => e.type === "market.tick")!;
    const bal = lastTick.payload.traders as Array<{ cash: number; holdings: number }>;
    expect(bal.reduce((s, b) => s + b.cash, 0)).toBeCloseTo(600, 3); // cash conserved
    expect(bal.reduce((s, b) => s + b.holdings, 0)).toBe(6); // units conserved

    const finished = events.find((e) => e.type === "world.finished");
    expect(Array.isArray((finished!.payload as { wealth: unknown }).wealth)).toBe(true);
  });
});

describe("negotiation template — private pacts + coalition vote", () => {
  it("forms a pact only on mutual picks, keeps offers private, coalition candidate wins", async () => {
    const carol = new MockAgentAdapter({ agentId: "carol", responses: ["alice", "alice", "carol"] });
    const events = await run(
      "negotiation",
      { prize: "P", players: ["alice", "bob", "carol"], rounds: 2 },
      new Map<string, AgentAdapter>([
        ["alice", mock("alice", ["bob", "bob", "alice"])],
        ["bob", mock("bob", ["alice", "alice", "alice"])],
        ["carol", carol],
      ]),
    );
    const pacts = events.filter((e) => e.type === "pact.formed");
    expect(pacts).toHaveLength(1);
    expect((pacts[0].payload.between as string[]).slice().sort()).toEqual(["alice", "bob"]);
    expect(events.find((e) => e.type === "world.verdict")!.payload.winner).toBe("alice");
    // carol never saw alice's private offer to bob.
    expect(
      carol.lastObservation!.history.some((e: WorldEvent) => e.type === "pact.offer" && e.actorId === "alice"),
    ).toBe(false);
  });
});

describe("courtroom template", () => {
  it("witnesses testify (privately-known facts), then arguments, then a verdict", async () => {
    const w1 = new MockAgentAdapter({ agentId: "w1", responses: ["testimony-1"] });
    const events = await run(
      "courtroom",
      {
        caseTitle: "C",
        prosecutor: "pro",
        defense: "def",
        judge: "j",
        witnesses: { w1: "secret-1", w2: "secret-2" },
        rounds: 2,
      },
      new Map<string, AgentAdapter>([
        ["pro", mock("pro", ["p1", "p2"])],
        ["def", mock("def", ["d1", "d2"])],
        ["j", mock("j", ["verdict"])],
        ["w1", w1],
        ["w2", mock("w2", ["testimony-2"])],
      ]),
    );
    expect(events.filter((e) => e.type === "testimony")).toHaveLength(2);
    expect(events.filter((e) => e.type === "agent.speak")).toHaveLength(4); // 2 sides x 2 rounds
    expect(events.at(-1)!.type).toBe("world.verdict");

    // w1 never sees w2's private knowledge before testifying.
    const leaked = w1.lastObservation!.history.filter(
      (e: WorldEvent) => e.type === "knowledge.assigned" && e.actorId !== "w1",
    );
    expect(leaked).toHaveLength(0);
  });
});

describe("ecosystem template (tick-based)", () => {
  it("predators eat prey and the sim terminates with a valid outcome", async () => {
    const predators = ["fox-1", "fox-2"];
    const prey = ["r1", "r2", "r3"];
    const field = 10;
    const events = await run(
      "ecosystem",
      { predators, prey, ticks: 60, field },
      new Map<string, AgentAdapter>([
        ...predators.map((id) => [id, mock(id, ["hunt"])] as const),
        ...prey.map((id) => [id, mock(id, ["wander"])] as const),
      ]),
    );
    const ticks = events.filter((e) => e.type === "world.tick");
    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks.length).toBeLessThanOrEqual(61);
    expect(events.filter((e) => e.type === "eat.event").length).toBeGreaterThanOrEqual(1);

    const finished = events.find((e) => e.type === "world.finished");
    expect(["predators", "prey", "balance"]).toContain(finished!.payload.winner);

    for (const t of ticks) {
      for (const c of t.payload.creatures as Array<{ x: number; z: number }>) {
        expect(Math.abs(c.x)).toBeLessThanOrEqual(field / 2 + 0.01);
        expect(Math.abs(c.z)).toBeLessThanOrEqual(field / 2 + 0.01);
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
