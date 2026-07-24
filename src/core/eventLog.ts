import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { NewWorldEvent, WorldEvent } from "./types.js";

/**
 * Event-sourced append-only log. This is the single source of truth for
 * everything that happens in a world; the world view and replay both read
 * from here instead of talking to the execution engine directly.
 *
 * Uses node:sqlite (built into Node 22.5+) to avoid a native-module
 * dependency for the MVP. Swap for a proper driver if this becomes a
 * bottleneck.
 */
export class EventLog {
  private db: DatabaseSync;
  private sequenceCounters = new Map<string, number>();

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        world_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        actor_id TEXT,
        payload TEXT NOT NULL,
        highlight INTEGER NOT NULL DEFAULT 0
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_events_world_seq ON events (world_id, sequence);
    `);
  }

  append(worldId: string, event: NewWorldEvent): WorldEvent {
    const sequence = this.nextSequence(worldId);
    const full: WorldEvent = {
      id: randomUUID(),
      worldId,
      sequence,
      timestamp: new Date().toISOString(),
      ...event,
    };

    this.db
      .prepare(
        `INSERT INTO events (id, world_id, sequence, timestamp, type, actor_id, payload, highlight)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        full.id,
        full.worldId,
        full.sequence,
        full.timestamp,
        full.type,
        full.actorId ?? null,
        JSON.stringify(full.payload),
        full.highlight ? 1 : 0,
      );

    return full;
  }

  history(worldId: string): WorldEvent[] {
    const rows = this.db
      .prepare(`SELECT * FROM events WHERE world_id = ? ORDER BY sequence ASC`)
      .all(worldId) as unknown as SqliteEventRow[];
    return rows.map(rowToEvent);
  }

  close(): void {
    this.db.close();
  }

  private nextSequence(worldId: string): number {
    const current = this.sequenceCounters.get(worldId) ?? this.loadMaxSequence(worldId);
    const next = current + 1;
    this.sequenceCounters.set(worldId, next);
    return next;
  }

  private loadMaxSequence(worldId: string): number {
    const row = this.db
      .prepare(`SELECT MAX(sequence) as maxSeq FROM events WHERE world_id = ?`)
      .get(worldId) as { maxSeq: number | null };
    return row.maxSeq ?? 0;
  }
}

interface SqliteEventRow {
  id: string;
  world_id: string;
  sequence: number;
  timestamp: string;
  type: string;
  actor_id: string | null;
  payload: string;
  highlight: number;
}

function rowToEvent(row: SqliteEventRow): WorldEvent {
  return {
    id: row.id,
    worldId: row.world_id,
    sequence: row.sequence,
    timestamp: row.timestamp,
    type: row.type,
    actorId: row.actor_id ?? undefined,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    highlight: !!row.highlight,
  };
}
