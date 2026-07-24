import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** Opens the shared SQLite database used by EventLog, AgentStore and WorldStore alike. */
export function openDatabase(path: string): DatabaseSync {
  // Ensure the parent directory exists so a fresh clone / CI run (where the
  // gitignored data/ dir isn't present) doesn't fail to create the file.
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  return new DatabaseSync(path);
}
