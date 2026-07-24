import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Runs `fn` with a fresh, empty working directory scoped to this single
 * call, deleted afterwards. This is the MVP-level sandbox boundary for
 * CLI agents (restricted cwd only, not full process/container isolation —
 * see the open risk noted in docs/architecture.md §5).
 */
export async function withSandboxDir<T>(agentId: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), `avw-${agentId}-`));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
