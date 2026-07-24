import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { AgentVisualState, WorldEvent, WorldSummary, WsMessage } from "./types";
import { fetchWorlds } from "./api";
import { Stage3D, resolveStageLayout, type AgentPlacement } from "./Stage3D";

type ConnectionStatus = "idle" | "connecting" | "open" | "closed" | "error";
type ViewMode = "stage" | "timeline";

function WorldView() {
  const { worldId } = useParams<{ worldId?: string }>();
  const navigate = useNavigate();

  const [worlds, setWorlds] = useState<WorldSummary[]>([]);
  const [events, setEvents] = useState<WorldEvent[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [viewMode, setViewMode] = useState<ViewMode>("stage");
  const [placements, setPlacements] = useState<AgentPlacement[]>([]);
  const [agentStates, setAgentStates] = useState<Record<string, AgentVisualState>>({});
  const [roundLabel, setRoundLabel] = useState<string | undefined>();
  const listEndRef = useRef<HTMLDivElement>(null);
  const revertTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const loadWorlds = () => {
    fetchWorlds()
      .then((list) => {
        setWorlds(list);
        // Only auto-pick a world when none is selected via the URL yet
        // (bare "/"); once a world is selected, refreshing the list
        // shouldn't yank the user away from it.
        if (!worldId && list[0]) {
          navigate(`/world/${list[0].id}`, { replace: true });
        }
      })
      .catch((err) => console.error(err));
  };

  useEffect(loadWorlds, []);

  useEffect(() => {
    if (!worldId) return;

    setEvents([]);
    setStatus("connecting");
    setRoundLabel(undefined);
    Object.values(revertTimers.current).forEach(clearTimeout);
    revertTimers.current = {};

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws/worlds/${worldId}`);

    ws.onopen = () => setStatus("open");
    ws.onclose = () => setStatus("closed");
    ws.onerror = () => setStatus("error");
    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data) as WsMessage;
      if (data.type === "history") {
        setEvents(data.events);
        const layout = resolveStageLayout(data.events);
        setPlacements(layout);
        const deadIds = collectDeadAgentIds(data.events);
        setAgentStates(
          Object.fromEntries(layout.map((p) => [p.agentId, { state: "idle" as const, dead: deadIds.has(p.agentId) }])),
        );
        const lastRound = [...data.events].reverse().find((e) => e.type === "round.start" || e.type === "phase.start");
        if (lastRound) setRoundLabel(formatRoundLabel(lastRound));
      } else {
        setEvents((prev) => [...prev, data.event]);
        applyLiveEvent(data.event);
        // WorldSummary.status only reflects whatever REST returned when the
        // world list was fetched; refresh it as events stream in so the
        // running/finished/failed dot doesn't go stale mid-run.
        refreshWorldStatus(worldId);
      }
    };

    return () => ws.close();
  }, [worldId]);

  function refreshWorldStatus(id: string) {
    fetch(`/api/worlds/${id}`)
      .then((res) => res.json())
      .then((updated: WorldSummary) => {
        setWorlds((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
      })
      .catch((err) => console.error(err));
  }

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [events]);

  function applyLiveEvent(event: WorldEvent) {
    if (event.type === "round.start" || event.type === "phase.start") {
      setRoundLabel(formatRoundLabel(event));
    }

    if (event.type === "night.result" || event.type === "vote.result") {
      const victimId = (event.payload.victim ?? event.payload.eliminated) as string | null | undefined;
      if (victimId) markDead(victimId);
    }

    if (event.type === "turn.started" && event.actorId) {
      setAgentState(event.actorId, { state: "thinking" });
      return;
    }

    const text = typeof event.payload.text === "string" ? event.payload.text : undefined;
    if (event.actorId && text) {
      setAgentState(event.actorId, { state: "speaking", text });
      const revertDelay = Math.min(9000, Math.max(3000, text.length * 90));
      revertTimers.current[event.actorId] = setTimeout(() => {
        setAgentStates((prev) => ({ ...prev, [event.actorId as string]: { state: "idle", text } }));
      }, revertDelay);
    }
  }

  function setAgentState(agentId: string, visual: AgentVisualState) {
    const pending = revertTimers.current[agentId];
    if (pending) clearTimeout(pending);
    setAgentStates((prev) => ({ ...prev, [agentId]: { ...visual, dead: prev[agentId]?.dead } }));
  }

  function markDead(agentId: string) {
    const pending = revertTimers.current[agentId];
    if (pending) clearTimeout(pending);
    setAgentStates((prev) => ({ ...prev, [agentId]: { ...(prev[agentId] ?? { state: "idle" }), dead: true } }));
  }

  const selectedWorld = worlds.find((w) => w.id === worldId);

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <span className="sidebar-title">世界列表</span>
          <button onClick={loadWorlds}>刷新</button>
        </div>
        <ul className="world-list">
          {worlds.map((world) => (
            <li
              key={world.id}
              className={world.id === worldId ? "selected" : ""}
              onClick={() => navigate(`/world/${world.id}`)}
            >
              <div className="world-list-row">
                <span className={`dot status-${world.status}`} />
                <span className="world-template">{world.template}</span>
              </div>
              <div className="world-id">{world.id.slice(0, 8)}</div>
              <div className="world-time">{new Date(world.createdAt).toLocaleString()}</div>
            </li>
          ))}
          {worlds.length === 0 && <li className="empty">还没有世界，去管理控制台创建一个</li>}
        </ul>
      </aside>

      <main className="main">
        {selectedWorld ? (
          <>
            <header className="main-header">
              <div>
                <strong>{selectedWorld.template}</strong>
                <span className="muted"> · {selectedWorld.id}</span>
              </div>
              <div className="header-meta">
                <div className="view-toggle">
                  <button className={viewMode === "stage" ? "active" : ""} onClick={() => setViewMode("stage")}>
                    3D 舞台
                  </button>
                  <button className={viewMode === "timeline" ? "active" : ""} onClick={() => setViewMode("timeline")}>
                    时间轴
                  </button>
                </div>
                <span className={`dot status-${selectedWorld.status}`} />
                <span>{selectedWorld.status}</span>
                <span className={`dot ws-${status}`} title={`WebSocket: ${status}`} />
                <span>{status}</span>
              </div>
            </header>

            {viewMode === "stage" ? (
              <Stage3D placements={placements} agentStates={agentStates} roundLabel={roundLabel} />
            ) : (
              <div className="timeline">
                {events.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
                {events.length === 0 && <div className="empty-state">等待事件...</div>}
                <div ref={listEndRef} />
              </div>
            )}
          </>
        ) : (
          <div className="empty-state">选择左侧的一个世界查看</div>
        )}
      </main>
    </div>
  );
}

const PHASE_LABELS: Record<string, string> = {
  night: "🌙 夜晚",
  "day-discuss": "☀️ 白天·讨论",
  "day-vote": "☀️ 白天·投票",
};

function formatRoundLabel(event: WorldEvent): string {
  if (event.type === "phase.start") {
    const phase = event.payload.phase as string;
    return `${PHASE_LABELS[phase] ?? phase} · 第 ${event.payload.round} 轮`;
  }
  const total = event.payload.totalRounds;
  return `第 ${event.payload.round}${total ? ` / ${total}` : ""} 轮`;
}

/** Scans history for who's already been eliminated, for worlds loaded mid-game or finished. */
function collectDeadAgentIds(history: WorldEvent[]): Set<string> {
  const dead = new Set<string>();
  for (const event of history) {
    if (event.type === "night.result" || event.type === "vote.result") {
      const victimId = (event.payload.victim ?? event.payload.eliminated) as string | null | undefined;
      if (victimId) dead.add(victimId);
    }
  }
  return dead;
}

function EventRow({ event }: { event: WorldEvent }) {
  return (
    <div className={`event-row${event.highlight ? " highlight" : ""}`}>
      <span className="event-seq">#{event.sequence}</span>
      <span className="event-type">{event.type}</span>
      {event.actorId && <span className="event-actor">{event.actorId}</span>}
      <span className="event-payload">{renderPayload(event)}</span>
      {event.visibleTo && (
        <span className="event-private" title={event.visibleTo.length ? `仅 ${event.visibleTo.join(", ")} 可见` : "任何 Agent 都看不到，仅上帝视角可见"}>
          🔒 {event.visibleTo.length ? event.visibleTo.join(",") : "无 Agent"} 可见
        </span>
      )}
    </div>
  );
}

function renderPayload(event: WorldEvent): string {
  if (typeof event.payload.text === "string") {
    return event.payload.text;
  }
  return JSON.stringify(event.payload);
}

export default WorldView;
