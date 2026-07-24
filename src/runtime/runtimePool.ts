export interface RuntimePoolConfig {
  /** Max number of calls (across all agents sharing this pool) running at once. */
  maxConcurrent: number;
  /** Per-call timeout; the AbortSignal passed to the callback fires after this. */
  timeoutMs: number;
  /** Optional lifetime call budget for this pool; further calls throw once hit. */
  maxCalls?: number;
}

export interface RuntimePoolStats {
  active: number;
  queued: number;
  calls: number;
}

/**
 * Shared runtime for CLI-based agents: bounds concurrent subprocesses,
 * enforces a per-call timeout, and tracks a call budget so a misbehaving
 * or runaway agent can't spawn unbounded processes or blow past cost
 * expectations. See docs/architecture.md §2.2.
 */
export class RuntimePool {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  private calls = 0;

  constructor(private readonly config: RuntimePoolConfig) {}

  get stats(): RuntimePoolStats {
    return { active: this.active, queued: this.queue.length, calls: this.calls };
  }

  async run<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.calls += 1;
    if (this.config.maxCalls !== undefined && this.calls > this.config.maxCalls) {
      throw new Error(`RuntimePool: call budget of ${this.config.maxCalls} exceeded`);
    }

    await this.acquire();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      return await fn(controller.signal);
    } finally {
      clearTimeout(timer);
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.config.maxConcurrent) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.queue.shift();
    if (next) next();
  }
}
