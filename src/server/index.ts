import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { openDatabase } from "../core/db.js";
import { EventLog } from "../core/eventLog.js";
import { AgentStore } from "../core/agentStore.js";
import { WorldStore } from "../core/worldStore.js";
import { RuntimePool } from "../runtime/runtimePool.js";
import { buildServer } from "./app.js";

const PORT = Number(process.env.PORT ?? 4000);
const DB_PATH = process.env.DB_PATH ?? "data/events.db";

/**
 * Serve the built SPA from the same server when it exists (single-container
 * deploy). Defaults to web/dist; override with STATIC_DIR. In dev this dir
 * is absent, so Vite keeps serving the frontend on :5173 and this is skipped.
 */
function resolveStaticDir(): string | undefined {
  const dir = resolve(process.env.STATIC_DIR ?? "web/dist");
  return existsSync(dir) ? dir : undefined;
}

async function main() {
  const db = openDatabase(DB_PATH);
  const eventLog = new EventLog(db);
  const agentStore = new AgentStore(db);
  const worldStore = new WorldStore(db);

  // Worlds run in memory; anything still 'running' in the DB at startup was
  // orphaned by a previous shutdown/crash and can never resume, so reconcile
  // it to 'failed' rather than leaving it stuck.
  const reconciled = worldStore.failStaleRunning("服务重启，运行中的世界已中断");
  if (reconciled > 0) console.log(`Reconciled ${reconciled} stale running world(s) to failed on startup`);

  // A resettable (hourly) budget rather than a lifetime one, so a long-lived
  // server bounds CLI-agent cost/runaways without ever permanently locking
  // agents out. Per-call cost is still capped by each call's own
  // --max-budget-usd. Tune via env for different deployments.
  const cliPool = new RuntimePool({
    maxConcurrent: Number(process.env.CLI_MAX_CONCURRENT ?? 3),
    timeoutMs: Number(process.env.CLI_TIMEOUT_MS ?? 90_000),
    maxCallsPerWindow: Number(process.env.CLI_MAX_CALLS_PER_HOUR ?? 500),
    windowMs: 60 * 60 * 1000,
  });

  const app = await buildServer({ eventLog, agentStore, worldStore, cliPool, staticDir: resolveStaticDir() });

  await app.listen({ port: PORT, host: "0.0.0.0" });

  const shutdown = async () => {
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
