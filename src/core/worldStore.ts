import type { DatabaseSync } from "node:sqlite";

export type WorldStatus = "running" | "finished" | "failed";

export interface WorldRecord {
  id: string;
  template: string;
  config: Record<string, unknown>;
  agentIds: string[];
  status: WorldStatus;
  error?: string;
  createdAt: string;
  finishedAt?: string;
}

export interface CreateWorldInput {
  id: string;
  template: string;
  config: Record<string, unknown>;
  agentIds: string[];
}

/** SQLite-backed run metadata for world instances (what the Admin Console lists/launches). */
export class WorldStore {
  constructor(private readonly db: DatabaseSync) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS worlds (
        id TEXT PRIMARY KEY,
        template TEXT NOT NULL,
        config TEXT NOT NULL,
        agent_ids TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        finished_at TEXT
      );
    `);
  }

  list(): WorldRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM worlds ORDER BY created_at DESC`)
      .all() as unknown as WorldRow[];
    return rows.map(rowToWorld);
  }

  get(id: string): WorldRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM worlds WHERE id = ?`).get(id) as WorldRow | undefined;
    return row ? rowToWorld(row) : undefined;
  }

  create(input: CreateWorldInput): WorldRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO worlds (id, template, config, agent_ids, status, error, created_at, finished_at)
         VALUES (?, ?, ?, ?, 'running', NULL, ?, NULL)`,
      )
      .run(input.id, input.template, JSON.stringify(input.config), JSON.stringify(input.agentIds), now);
    return {
      id: input.id,
      template: input.template,
      config: input.config,
      agentIds: input.agentIds,
      status: "running",
      createdAt: now,
    };
  }

  markFinished(id: string): void {
    this.db
      .prepare(`UPDATE worlds SET status = 'finished', finished_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), id);
  }

  markFailed(id: string, error: string): void {
    this.db
      .prepare(`UPDATE worlds SET status = 'failed', error = ?, finished_at = ? WHERE id = ?`)
      .run(error, new Date().toISOString(), id);
  }
}

interface WorldRow {
  id: string;
  template: string;
  config: string;
  agent_ids: string;
  status: WorldStatus;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

function rowToWorld(row: WorldRow): WorldRecord {
  return {
    id: row.id,
    template: row.template,
    config: JSON.parse(row.config) as Record<string, unknown>,
    agentIds: JSON.parse(row.agent_ids) as string[],
    status: row.status,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    finishedAt: row.finished_at ?? undefined,
  };
}
