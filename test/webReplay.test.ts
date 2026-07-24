import { describe, it, expect } from "vitest";
import { aquariumFromHistory, collectDeadAgentIds, formatRoundLabel, reconstructView } from "../web/src/world/replay";
import type { WorldEvent } from "../web/src/types";

let seq = 0;
function ev(type: string, payload: Record<string, unknown>, extra: Partial<WorldEvent> = {}): WorldEvent {
  return { id: `e${seq}`, worldId: "w", sequence: seq++, timestamp: "", type, payload, ...extra };
}

describe("formatRoundLabel", () => {
  it("formats round.start with total", () => {
    expect(formatRoundLabel(ev("round.start", { round: 2, totalRounds: 3 }))).toBe("第 2 / 3 轮");
  });
  it("formats werewolf phase.start", () => {
    expect(formatRoundLabel(ev("phase.start", { phase: "night", round: 1 }))).toContain("夜晚");
    expect(formatRoundLabel(ev("phase.start", { phase: "day-vote", round: 2 }))).toContain("投票");
  });
});

describe("collectDeadAgentIds", () => {
  it("accumulates victims from night/vote results", () => {
    const dead = collectDeadAgentIds([
      ev("night.result", { victim: "v1" }),
      ev("night.result", { victim: null }),
      ev("vote.result", { eliminated: "w1" }),
    ]);
    expect([...dead].sort()).toEqual(["v1", "w1"]);
  });
});

describe("aquariumFromHistory", () => {
  it("returns the latest tick snapshot", () => {
    const view = aquariumFromHistory([
      ev("world.created", { fish: ["f"], tank: { w: 8, h: 5, d: 6 } }),
      ev("world.tick", { tick: 0, fish: [{ id: "f", x: 0, y: 1, z: 0, yaw: 0, behavior: "cruise" }] }),
      ev("world.tick", { tick: 1, fish: [{ id: "f", x: 1, y: 1, z: 0, yaw: 0.2, behavior: "wander" }] }),
    ]);
    expect(view?.tick).toBe(1);
    expect(view?.fish[0].x).toBe(1);
  });
  it("is undefined for non-aquarium worlds", () => {
    expect(aquariumFromHistory([ev("world.created", { sides: { pro: [], con: [] } })])).toBeUndefined();
  });
});

describe("reconstructView (replay fold)", () => {
  const history = [
    ev("world.created", { players: ["w1", "v1", "v2"] }),
    ev("roles.assigned", { roles: { w1: "werewolf", v1: "villager", v2: "villager" } }, { visibleTo: [] }),
    ev("phase.start", { phase: "night", round: 1 }),
    ev("night.result", { victim: "v1" }),
    ev("phase.start", { phase: "day-discuss", round: 1 }),
    ev("turn.started", {}, { actorId: "w1" }),
    ev("agent.speak", { text: "hi" }, { actorId: "w1" }),
  ];

  it("nobody is dead before the night.result cursor", () => {
    const view = reconstructView(history, 2); // up to phase.start night
    expect(Object.values(view.agentStates).some((s) => s.dead)).toBe(false);
  });

  it("v1 is dead once the cursor passes night.result", () => {
    const view = reconstructView(history, 3);
    expect(view.agentStates["v1"].dead).toBe(true);
    expect(view.roundLabel).toContain("夜晚");
  });

  it("freezes the cursor event's actor as speaking", () => {
    const view = reconstructView(history, 6); // agent.speak w1
    expect(view.agentStates["w1"].state).toBe("speaking");
    expect(view.agentStates["w1"].text).toBe("hi");
    expect(view.roundLabel).toContain("讨论");
  });

  it("freezes a turn.started actor as thinking", () => {
    const view = reconstructView(history, 5); // turn.started w1
    expect(view.agentStates["w1"].state).toBe("thinking");
  });
});
