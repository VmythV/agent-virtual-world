import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RuntimePool } from "../src/runtime/runtimePool.js";

const noop = async () => "ok";

describe("RuntimePool", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("throws once the lifetime budget is exceeded", async () => {
    const pool = new RuntimePool({ maxConcurrent: 4, timeoutMs: 1000, maxCalls: 2 });
    await expect(pool.run(noop)).resolves.toBe("ok");
    await expect(pool.run(noop)).resolves.toBe("ok");
    await expect(pool.run(noop)).rejects.toThrow(/lifetime call budget/);
  });

  it("enforces a windowed budget that resets each window", async () => {
    const pool = new RuntimePool({ maxConcurrent: 4, timeoutMs: 1000, maxCallsPerWindow: 2, windowMs: 1000 });
    await expect(pool.run(noop)).resolves.toBe("ok");
    await expect(pool.run(noop)).resolves.toBe("ok");
    await expect(pool.run(noop)).rejects.toThrow(/windowed call budget/);

    // Advance past the window: the counter resets and calls are allowed again.
    vi.advanceTimersByTime(1001);
    await expect(pool.run(noop)).resolves.toBe("ok");
    expect(pool.stats.windowCalls).toBe(1);
  });

  it("limits concurrency: a third call waits until one of two in-flight finishes", async () => {
    const pool = new RuntimePool({ maxConcurrent: 2, timeoutMs: 10_000 });
    let active = 0;
    let maxActive = 0;
    const gate: Array<() => void> = [];
    const task = () =>
      pool.run(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => gate.push(resolve));
        active -= 1;
        return "done";
      });

    const p1 = task();
    const p2 = task();
    const p3 = task();
    await Promise.resolve(); // let the first two acquire

    expect(pool.stats.active).toBe(2);
    expect(pool.stats.queued).toBe(1);

    gate.shift()!(); // finish one -> the queued one starts
    await p1;
    await Promise.resolve();
    expect(pool.stats.active).toBe(2);

    gate.forEach((g) => g());
    await Promise.all([p2, p3]);
    expect(maxActive).toBe(2);
  });
});
