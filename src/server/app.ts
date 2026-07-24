import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import websocketPlugin from "@fastify/websocket";
import { randomUUID } from "node:crypto";
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
}

export async function buildServer(deps: AppDeps): Promise<FastifyInstance> {
  const { eventLog, agentStore, worldStore, cliPool } = deps;
  const app = Fastify({ logger: true });

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
    // subscribe to /ws/worlds/:id for live events as they happen.
    runWorld({ worldId, template, config: body.config, agents, eventLog })
      .then(() => worldStore.markFinished(worldId))
      .catch((err: unknown) => {
        app.log.error(err);
        worldStore.markFailed(worldId, err instanceof Error ? err.message : String(err));
      });

    return reply.code(202).send(record);
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

  return app;
}

function respondToValidationError(err: unknown, reply: FastifyReply) {
  if (err instanceof AgentValidationError) {
    return reply.code(400).send({ error: err.message });
  }
  throw err;
}
