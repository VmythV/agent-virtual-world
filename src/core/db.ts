import { DatabaseSync } from "node:sqlite";

/** Opens the shared SQLite database used by EventLog, AgentStore and WorldStore alike. */
export function openDatabase(path: string): DatabaseSync {
  return new DatabaseSync(path);
}
