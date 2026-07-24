import { openDatabase } from "../core/db.js";
import { EventLog } from "../core/eventLog.js";
import { AgentStore } from "../core/agentStore.js";
import { WorldStore } from "../core/worldStore.js";
import { RuntimePool } from "../runtime/runtimePool.js";
import { buildServer } from "./app.js";

const PORT = Number(process.env.PORT ?? 4000);
const DB_PATH = process.env.DB_PATH ?? "data/events.db";

async function main() {
  const db = openDatabase(DB_PATH);
  const eventLog = new EventLog(db);
  const agentStore = new AgentStore(db);
  const worldStore = new WorldStore(db);

  // No maxCalls here (unlike the one-shot demo script): this pool lives for
  // the server's whole lifetime, so a lifetime call budget would eventually
  // lock every CLI agent out permanently. Per-call cost is still bounded by
  // each call's own --max-budget-usd; a resettable (e.g. daily) budget is
  // tracked as an open item in docs/architecture.md.
  const cliPool = new RuntimePool({ maxConcurrent: 3, timeoutMs: 90_000 });

  const app = await buildServer({ eventLog, agentStore, worldStore, cliPool });

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
