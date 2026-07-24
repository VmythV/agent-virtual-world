import { describe, it, expect } from "vitest";
import { resolveStageLayout } from "../web/src/world/layout";
import type { WorldEvent } from "../web/src/types";

let seq = 0;
function ev(type: string, payload: Record<string, unknown>, extra: Partial<WorldEvent> = {}): WorldEvent {
  return { id: `e${seq}`, worldId: "w", sequence: seq++, timestamp: "", type, payload, ...extra };
}

describe("resolveStageLayout dispatch (frontend)", () => {
  it("returns [] with no world.created", () => {
    expect(resolveStageLayout([])).toEqual([]);
  });

  it("debate: pro left, con right, judge upstage center", () => {
    const p = resolveStageLayout([ev("world.created", { sides: { pro: ["p"], con: ["c"] }, judge: "j" })]);
    expect(p.map((x) => [x.agentId, x.role])).toEqual([
      ["p", "pro"],
      ["c", "con"],
      ["j", "judge"],
    ]);
    expect(p.find((x) => x.agentId === "p")!.position[0]).toBeLessThan(0);
    expect(p.find((x) => x.agentId === "c")!.position[0]).toBeGreaterThan(0);
  });

  it("discussion: participants are 'other', moderator is 'judge'", () => {
    const p = resolveStageLayout([ev("world.created", { topic: "T", participants: ["a", "b"], moderator: "m" })]);
    expect(p.filter((x) => x.role === "other").map((x) => x.agentId)).toEqual(["a", "b"]);
    expect(p.find((x) => x.role === "judge")!.agentId).toBe("m");
  });

  it("human-lab wins over discussion when 'scenario' is present", () => {
    const p = resolveStageLayout([ev("world.created", { scenario: "S", participants: ["a", "b"], observer: "o" })]);
    expect(p.filter((x) => x.role === "participant").map((x) => x.agentId)).toEqual(["a", "b"]);
    expect(p.find((x) => x.role === "observer")!.agentId).toBe("o");
  });

  it("problem-solving: coordinator + experts", () => {
    const p = resolveStageLayout([ev("world.created", { problem: "P", coordinator: "co", experts: ["e1", "e2"] })]);
    expect(p.find((x) => x.role === "coordinator")!.agentId).toBe("co");
    expect(p.filter((x) => x.role === "expert").map((x) => x.agentId)).toEqual(["e1", "e2"]);
  });

  it("werewolf: colors players by role from roles.assigned", () => {
    const p = resolveStageLayout([
      ev("world.created", { players: ["w1", "v1", "s1"] }),
      ev("roles.assigned", { roles: { w1: "werewolf", v1: "villager", s1: "seer" } }, { visibleTo: [] }),
    ]);
    expect(Object.fromEntries(p.map((x) => [x.agentId, x.role]))).toEqual({ w1: "werewolf", v1: "villager", s1: "seer" });
  });

  it("werewolf without roles yet: everyone 'other'", () => {
    const p = resolveStageLayout([ev("world.created", { players: ["w1", "v1"] })]);
    expect(p.every((x) => x.role === "other")).toBe(true);
  });
});
