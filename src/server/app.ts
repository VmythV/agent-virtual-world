import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import websocketPlugin from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { EventLog } from "../core/eventLog.js";
import { AgentStore, AgentValidationError } from "../core/agentStore.js";
import { WorldStore } from "../core/worldStore.js";
import { getWorldTemplate } from "../worldTemplates/registry.js";
import { createAgentAdapter } from "../core/agentFactory.js";
import { runWorld } from "../engine/scheduler.js";
import type { RuntimePool } from "../runtime/runtimePool.js";
import type { AgentAdapter, WorldEvent } from "../core/types.js";
import type { AgentConfig } from "../core/agentConfig.js";

export interface AppDeps {
  eventLog: EventLog;
  agentStore: AgentStore;
  worldStore: WorldStore;
  cliPool: RuntimePool;
  /** When set, serve the built frontend (web/dist) from here with an SPA fallback. */
  staticDir?: string;
}

export async function buildServer(deps: AppDeps): Promise<FastifyInstance> {
  const { eventLog, agentStore, worldStore, cliPool, staticDir } = deps;
  const app = Fastify({ logger: true });

  // Abort controllers for worlds currently running in memory, so they can be
  // stopped/deleted mid-run.
  const running = new Map<string, AbortController>();

  await app.register(cors, { origin: true });
  await app.register(websocketPlugin);

  app.get("/api/health", async () => ({ status: "ok" }));

  // --- Agents CRUD -------------------------------------------------------

  app.get("/api/agents", async () => agentStore.list());

  app.get("/api/agents/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const agent = agentStore.get(id);
    if (!agent) return reply.code(404).send({ error: `agent "${id}" not found` });
    return agent;
  });

  app.post("/api/agents", async (req, reply) => {
    try {
      const created = agentStore.create(req.body as AgentConfig);
      return reply.code(201).send(created);
    } catch (err) {
      return respondToValidationError(err, reply);
    }
  });

  app.put("/api/agents/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return agentStore.update(id, req.body as AgentConfig);
    } catch (err) {
      return respondToValidationError(err, reply);
    }
  });

  app.delete("/api/agents/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const inUseBy = worldStore.list().find((w) => w.status === "running" && w.agentIds.includes(id));
    if (inUseBy) {
      return reply.code(409).send({ error: `agent "${id}" is in use by running world ${inUseBy.id}` });
    }
    if (!agentStore.remove(id)) return reply.code(404).send({ error: `agent "${id}" not found` });
    return reply.code(204).send();
  });

  // --- Worlds --------------------------------------------------------------

  app.get("/api/worlds", async () => worldStore.list());

  app.get("/api/worlds/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const world = worldStore.get(id);
    if (!world) return reply.code(404).send({ error: `world "${id}" not found` });
    return world;
  });

  app.get("/api/worlds/:id/events", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!worldStore.get(id)) return reply.code(404).send({ error: `world "${id}" not found` });
    return eventLog.history(id);
  });

  // The "god" command channel (docs/architecture.md §2.4): the human
  // observer issues an instruction to a specific agent (or all agents when
  // agentId is omitted). It's appended as a normal event — so it's
  // auditable and replayable — and the scheduler surfaces it into the
  // target's next Observation.instruction. Targeted instructions get
  // visibleTo:[agentId] so they don't leak into other agents' histories;
  // the human god always sees every instruction via the unfiltered log.
  app.post("/api/worlds/:id/instructions", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!worldStore.get(id)) return reply.code(404).send({ error: `world "${id}" not found` });
    const body = req.body as { agentId?: string; text?: string };
    if (!body.text || typeof body.text !== "string") {
      return reply.code(400).send({ error: "text is required" });
    }
    const targetAgentId = body.agentId || null;
    const event = eventLog.append(id, {
      type: "god.instruction",
      payload: { targetAgentId, text: body.text },
      visibleTo: targetAgentId ? [targetAgentId] : undefined,
      highlight: true,
    });
    return reply.code(201).send(event);
  });

  app.post("/api/worlds", async (req, reply) => {
    const body = req.body as { template: string; agentIds: string[]; config: Record<string, unknown> };

    const template = getWorldTemplate(body.template);
    if (!template) {
      return reply.code(400).send({ error: `unknown template "${body.template}"` });
    }
    if (!Array.isArray(body.agentIds) || body.agentIds.length === 0) {
      return reply.code(400).send({ error: "agentIds must be a non-empty array" });
    }

    const agents = new Map<string, AgentAdapter>();
    for (const agentId of body.agentIds) {
      const stored = agentStore.get(agentId);
      if (!stored) {
        return reply.code(400).send({ error: `agent "${agentId}" not found` });
      }
      agents.set(agentId, createAgentAdapter(stored.config, { cliPool }));
    }

    const worldId = randomUUID();
    const record = worldStore.create({
      id: worldId,
      template: body.template,
      config: body.config,
      agentIds: body.agentIds,
    });

    // Runs in the background; poll GET /api/worlds/:id for status or
    // subscribe to /ws/worlds/:id for live events as they happen. tick-based
    // worlds get a wall-clock interval so live viewers can watch the
    // simulation play out instead of it completing in milliseconds.
    const tickIntervalMs = template.scheduling === "tick-based" ? 150 : undefined;
    const controller = new AbortController();
    running.set(worldId, controller);
    runWorld({ worldId, template, config: body.config, agents, eventLog, tickIntervalMs, signal: controller.signal })
      .then(() => (controller.signal.aborted ? worldStore.markStopped(worldId) : worldStore.markFinished(worldId)))
      .catch((err: unknown) => {
        app.log.error(err);
        worldStore.markFailed(worldId, err instanceof Error ? err.message : String(err));
      })
      .finally(() => running.delete(worldId));

    return reply.code(202).send(record);
  });

  app.post("/api/worlds/:id/stop", async (req, reply) => {
    const { id } = req.params as { id: string };
    const controller = running.get(id);
    if (!controller) return reply.code(409).send({ error: `world "${id}" is not running` });
    controller.abort();
    return reply.code(202).send({ id, status: "stopping" });
  });

  app.delete("/api/worlds/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!worldStore.get(id)) return reply.code(404).send({ error: `world "${id}" not found` });
    running.get(id)?.abort(); // stop it first if still running
    running.delete(id);
    worldStore.remove(id);
    eventLog.deleteWorld(id);
    return reply.code(204).send();
  });

  // --- Live event feed -----------------------------------------------------
  // Sends the full history on connect (so a client never has to coordinate a
  // separate REST call to avoid missing events), then streams new ones live.

  app.get("/ws/worlds/:id", { websocket: true }, (socket, req) => {
    const { id } = req.params as { id: string };

    socket.send(JSON.stringify({ type: "history", events: eventLog.history(id) }));

    const onAppended = (event: WorldEvent) => {
      if (event.worldId !== id) return;
      socket.send(JSON.stringify({ type: "event", event }));
    };
    eventLog.on("appended", onAppended);

    socket.on("close", () => {
      eventLog.off("appended", onAppended);
    });
  });

  // --- Static frontend (single-container deploy) ---------------------------
  // Registered last so it never shadows the API/WS routes above. Serves the
  // built SPA and falls back to index.html for client-side routes (/world/…,
  // /admin/…) while leaving unknown /api/* paths as real 404s.
  if (staticDir) {
    await app.register(fastifyStatic, { root: staticDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url && (req.raw.url.startsWith("/api/") || req.raw.url.startsWith("/ws/"))) {
        return reply.code(404).send({ error: "not found" });
      }
      return reply.sendFile("index.html", staticDir);
    });
    app.log.info(`Serving built frontend from ${join(staticDir)}`);
  }

  return app;
}

function respondToValidationError(err: unknown, reply: FastifyReply) {
  if (err instanceof AgentValidationError) {
    return reply.code(400).send({ error: err.message });
  }
  throw err;
}
