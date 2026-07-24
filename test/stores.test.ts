import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { EventLog } from "../src/core/eventLog.js";
import { WorldStore } from "../src/core/worldStore.js";
import { AgentStore, AgentValidationError } from "../src/core/agentStore.js";

function freshDb() {
  return new DatabaseSync(":memory:");
}

describe("EventLog", () => {
  it("appends with monotonic per-world sequence and reads history back", () => {
    const log = new EventLog(freshDb());
    const a = log.append("w1", { type: "x", payload: {} });
    const b = log.append("w1", { type: "y", payload: { n: 1 } });
    log.append("w2", { type: "z", payload: {} });

    expect(a.sequence).toBe(1);
    expect(b.sequence).toBe(2);
    const h = log.history("w1");
    expect(h.map((e) => e.type)).toEqual(["x", "y"]);
    expect(h[1].payload).toEqual({ n: 1 });
    expect(log.history("w2").map((e) => e.sequence)).toEqual([1]); // separate sequence space
  });

  it("round-trips visibleTo (including empty array vs undefined)", () => {
    const log = new EventLog(freshDb());
    log.append("w", { type: "public", payload: {} });
    log.append("w", { type: "hidden-all", payload: {}, visibleTo: [] });
    log.append("w", { type: "targeted", payload: {}, visibleTo: ["a"] });
    const [pub, hidden, targeted] = log.history("w");
    expect(pub.visibleTo).toBeUndefined();
    expect(hidden.visibleTo).toEqual([]);
    expect(targeted.visibleTo).toEqual(["a"]);
  });

  it("emits 'appended' for live broadcast", () => {
    const log = new EventLog(freshDb());
    const seen: string[] = [];
    log.on("appended", (e) => seen.push(e.type));
    log.append("w", { type: "a", payload: {} });
    log.append("w", { type: "b", payload: {} });
    expect(seen).toEqual(["a", "b"]);
  });

  it("deleteWorld removes a world's events", () => {
    const log = new EventLog(freshDb());
    log.append("w", { type: "a", payload: {} });
    log.deleteWorld("w");
    expect(log.history("w")).toEqual([]);
  });
});

describe("WorldStore", () => {
  it("failStaleRunning reconciles only running worlds", () => {
    const store = new WorldStore(freshDb());
    store.create({ id: "r1", template: "debate", config: {}, agentIds: ["a"] });
    store.create({ id: "r2", template: "debate", config: {}, agentIds: ["a"] });
    store.markFinished("r2");

    const n = store.failStaleRunning("restart");
    expect(n).toBe(1);
    expect(store.get("r1")!.status).toBe("failed");
    expect(store.get("r1")!.error).toBe("restart");
    expect(store.get("r2")!.status).toBe("finished"); // untouched
  });

  it("markStopped and remove work", () => {
    const store = new WorldStore(freshDb());
    store.create({ id: "w", template: "debate", config: {}, agentIds: ["a"] });
    store.markStopped("w");
    expect(store.get("w")!.status).toBe("stopped");
    expect(store.remove("w")).toBe(true);
    expect(store.get("w")).toBeUndefined();
  });
});

describe("AgentStore", () => {
  it("validates and rejects bad configs", () => {
    const store = new AgentStore(freshDb());
    expect(() => store.create({ agentId: "", adapter: "mock", responses: [] } as never)).toThrow(AgentValidationError);
    expect(() => store.create({ agentId: "a", adapter: "cli", cli: { preset: "custom" } } as never)).toThrow(
      AgentValidationError,
    );
  });

  it("creates, updates, lists, and removes", () => {
    const store = new AgentStore(freshDb());
    store.create({ agentId: "a", adapter: "mock", responses: ["hi"] });
    expect(store.list()).toHaveLength(1);
    store.update("a", { agentId: "a", adapter: "mock", responses: ["updated"] });
    const got = store.get("a")!;
    expect(got.config.adapter === "mock" && got.config.responses).toEqual(["updated"]);
    expect(store.remove("a")).toBe(true);
    expect(store.list()).toHaveLength(0);
  });
});
