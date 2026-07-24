export interface RuntimePoolConfig {
  /** Max number of calls (across all agents sharing this pool) running at once. */
  maxConcurrent: number;
  /** Per-call timeout; the AbortSignal passed to the callback fires after this. */
  timeoutMs: number;
  /**
   * Optional lifetime call budget for this pool; further calls throw once hit.
   * Suits one-shot scripts, but a long-running server should prefer the
   * windowed budget below so agents aren't locked out permanently.
   */
  maxCalls?: number;
  /**
   * Optional resettable budget: at most `maxCallsPerWindow` calls per
   * rolling `windowMs`. When the window elapses the counter resets, so a
   * long-lived server bounds cost without ever permanently locking agents
   * out. See docs/architecture.md §5.
   */
  maxCallsPerWindow?: number;
  windowMs?: number;
}

export interface RuntimePoolStats {
  active: number;
  queued: number;
  calls: number;
  windowCalls: number;
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
  private windowCalls = 0;
  private windowStart = Date.now();

  constructor(private readonly config: RuntimePoolConfig) {}

  get stats(): RuntimePoolStats {
    return { active: this.active, queued: this.queue.length, calls: this.calls, windowCalls: this.currentWindowCalls() };
  }

  private currentWindowCalls(): number {
    if (this.config.windowMs !== undefined && Date.now() - this.windowStart >= this.config.windowMs) {
      return 0; // window has rolled over since the last call
    }
    return this.windowCalls;
  }

  async run<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.calls += 1;

    if (this.config.maxCalls !== undefined && this.calls > this.config.maxCalls) {
      throw new Error(`RuntimePool: lifetime call budget of ${this.config.maxCalls} exceeded`);
    }

    if (this.config.maxCallsPerWindow !== undefined && this.config.windowMs !== undefined) {
      if (Date.now() - this.windowStart >= this.config.windowMs) {
        this.windowStart = Date.now();
        this.windowCalls = 0;
      }
      this.windowCalls += 1;
      if (this.windowCalls > this.config.maxCallsPerWindow) {
        const resetIn = Math.ceil((this.windowStart + this.config.windowMs - Date.now()) / 1000);
        throw new Error(
          `RuntimePool: windowed call budget of ${this.config.maxCallsPerWindow}/${this.config.windowMs}ms exceeded; resets in ~${resetIn}s`,
        );
      }
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
