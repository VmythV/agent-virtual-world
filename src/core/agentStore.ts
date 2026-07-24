import type { DatabaseSync } from "node:sqlite";
import type { AgentConfig } from "./agentConfig.js";

export interface StoredAgent {
  config: AgentConfig;
  createdAt: string;
  updatedAt: string;
}

export class AgentValidationError extends Error {}

/** SQLite-backed CRUD for AgentConfig — what the Admin Console's Agent CRUD reads/writes. */
export class AgentStore {
  constructor(private readonly db: DatabaseSync) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        config TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  list(): StoredAgent[] {
    const rows = this.db.prepare(`SELECT * FROM agents ORDER BY created_at ASC`).all() as unknown as AgentRow[];
    return rows.map(rowToAgent);
  }

  get(id: string): StoredAgent | undefined {
    const row = this.db.prepare(`SELECT * FROM agents WHERE id = ?`).get(id) as AgentRow | undefined;
    return row ? rowToAgent(row) : undefined;
  }

  create(config: AgentConfig): StoredAgent {
    validateAgentConfig(config);
    if (this.get(config.agentId)) {
      throw new AgentValidationError(`agent "${config.agentId}" already exists`);
    }
    const now = new Date().toISOString();
    this.db
      .prepare(`INSERT INTO agents (id, config, created_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run(config.agentId, JSON.stringify(config), now, now);
    return { config, createdAt: now, updatedAt: now };
  }

  update(id: string, config: AgentConfig): StoredAgent {
    validateAgentConfig(config);
    if (config.agentId !== id) {
      throw new AgentValidationError(`config.agentId "${config.agentId}" does not match path id "${id}"`);
    }
    const existing = this.get(id);
    if (!existing) {
      throw new AgentValidationError(`agent "${id}" not found`);
    }
    const now = new Date().toISOString();
    this.db.prepare(`UPDATE agents SET config = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(config), now, id);
    return { config, createdAt: existing.createdAt, updatedAt: now };
  }

  remove(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM agents WHERE id = ?`).run(id);
    return result.changes > 0;
  }
}

interface AgentRow {
  id: string;
  config: string;
  created_at: string;
  updated_at: string;
}

function rowToAgent(row: AgentRow): StoredAgent {
  return { config: JSON.parse(row.config) as AgentConfig, createdAt: row.created_at, updatedAt: row.updated_at };
}

const ADAPTERS = new Set(["api", "mock", "cli"]);
const CLI_PRESETS = new Set(["claude-code", "custom"]);

export function validateAgentConfig(config: AgentConfig): void {
  if (!config || typeof config !== "object") {
    throw new AgentValidationError("config must be an object");
  }
  if (!config.agentId || typeof config.agentId !== "string") {
    throw new AgentValidationError("config.agentId is required and must be a string");
  }
  if (!ADAPTERS.has(config.adapter)) {
    throw new AgentValidationError(`config.adapter must be one of ${[...ADAPTERS].join(", ")}`);
  }
  if (config.adapter === "api" && typeof config.systemPrompt !== "string") {
    throw new AgentValidationError("api agent requires config.systemPrompt (string)");
  }
  if (config.adapter === "mock" && !Array.isArray(config.responses)) {
    throw new AgentValidationError("mock agent requires config.responses (string[])");
  }
  if (config.adapter === "cli") {
    if (!config.cli || !CLI_PRESETS.has(config.cli.preset)) {
      throw new AgentValidationError(`cli agent requires config.cli.preset to be one of ${[...CLI_PRESETS].join(", ")}`);
    }
    if (config.cli.preset === "custom" && typeof config.cli.command !== "string") {
      throw new AgentValidationError('cli agent with preset "custom" requires config.cli.command (string)');
    }
  }
}
