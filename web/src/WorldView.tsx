import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { AgentVisualState, WorldEvent, WorldSummary, WsMessage } from "./types";
import { deleteWorld, fetchWorlds, sendInstruction, stopWorld } from "./api";
import { Stage3D } from "./Stage3D";
import { Aquarium3D } from "./Aquarium3D";
import { resolveStageLayout, type AgentPlacement } from "./world/layout";
import {
  aquariumFromHistory,
  collectDeadAgentIds,
  formatRoundLabel,
  reconstructView,
  type AquariumView,
  type FishSnapshot,
  type ShownView,
} from "./world/replay";

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
  const [aquarium, setAquarium] = useState<AquariumView | undefined>();
  const [instrTarget, setInstrTarget] = useState("");
  const [instrText, setInstrText] = useState("");
  const [instrSending, setInstrSending] = useState(false);
  const [replay, setReplay] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const listEndRef = useRef<HTMLDivElement>(null);
  const cursorRowRef = useRef<HTMLDivElement>(null);
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
    setAquarium(undefined);
    setReplay(false);
    setPlaying(false);
    setCursor(0);
    Object.values(revertTimers.current).forEach(clearTimeout);
    revertTimers.current = {};

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${protocol}://${window.location.host}/ws/worlds/${worldId}`;

    let cancelled = false;
    let ws: WebSocket;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    // Reconnect with exponential backoff so the live view survives a server
    // restart / network blip. On reconnect the server replays the full
    // history on connect, so state re-syncs cleanly.
    const connect = () => {
      setStatus(attempt === 0 ? "connecting" : "error");
      ws = new WebSocket(url);

      ws.onopen = () => {
        attempt = 0;
        setStatus("open");
      };
      ws.onerror = () => setStatus("error");
      ws.onclose = () => {
        if (cancelled) return;
        const delay = Math.min(1000 * 2 ** attempt, 10_000);
        attempt += 1;
        setStatus("connecting");
        reconnectTimer = setTimeout(connect, delay);
      };
      ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data) as WsMessage;
        if (data.type === "history") {
          setEvents(data.events);
          const aquariumView = aquariumFromHistory(data.events);
          if (aquariumView) {
            setAquarium(aquariumView);
          } else {
            const layout = resolveStageLayout(data.events);
            setPlacements(layout);
            const deadIds = collectDeadAgentIds(data.events);
            setAgentStates(
              Object.fromEntries(layout.map((p) => [p.agentId, { state: "idle" as const, dead: deadIds.has(p.agentId) }])),
            );
            const lastRound = [...data.events].reverse().find((e) => e.type === "round.start" || e.type === "phase.start");
            if (lastRound) setRoundLabel(formatRoundLabel(lastRound));
          }
        } else {
          setEvents((prev) => [...prev, data.event]);
          if (data.event.type === "world.tick") {
            setAquarium((prev) =>
              prev
                ? { ...prev, fish: data.event.payload.fish as FishSnapshot[], tick: data.event.payload.tick as number }
                : prev,
            );
          } else {
            applyLiveEvent(data.event);
          }
          // WorldSummary.status only reflects whatever REST returned when the
          // world list was fetched; refresh it as events stream in so the
          // running/finished/failed dot doesn't go stale mid-run.
          refreshWorldStatus(worldId);
        }
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
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
    if (replay) return; // in replay, follow the cursor instead of the live tail
    listEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [events, replay]);

  // Replay playback: advance the cursor on a timer while playing.
  useEffect(() => {
    if (!replay || !playing) return;
    if (cursor >= events.length - 1) {
      setPlaying(false);
      return;
    }
    const id = setTimeout(() => setCursor((c) => Math.min(events.length - 1, c + 1)), 250 / speed);
    return () => clearTimeout(id);
  }, [replay, playing, cursor, speed, events.length]);

  // Keep the cursor row in view while replaying the timeline.
  useEffect(() => {
    if (replay && viewMode === "timeline") cursorRowRef.current?.scrollIntoView({ block: "center" });
  }, [replay, cursor, viewMode]);

  function enterReplay() {
    setReplay(true);
    setPlaying(false);
    setCursor(0);
  }

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

  async function handleSendInstruction(e: React.FormEvent) {
    e.preventDefault();
    if (!worldId || !instrText.trim()) return;
    setInstrSending(true);
    try {
      await sendInstruction(worldId, instrText.trim(), instrTarget || undefined);
      setInstrText("");
    } catch (err) {
      console.error(err);
    } finally {
      setInstrSending(false);
    }
  }

  async function handleStop() {
    if (!worldId) return;
    try {
      await stopWorld(worldId);
      refreshWorldStatus(worldId);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleDelete() {
    if (!worldId) return;
    if (!window.confirm("删除这个世界及其全部事件？此操作不可恢复。")) return;
    try {
      await deleteWorld(worldId);
      const remaining = worlds.filter((w) => w.id !== worldId);
      setWorlds(remaining);
      navigate(remaining[0] ? `/world/${remaining[0].id}` : "/", { replace: true });
    } catch (err) {
      console.error(err);
    }
  }

  const selectedWorld = worlds.find((w) => w.id === worldId);

  const shown: ShownView = replay
    ? reconstructView(events, cursor)
    : { aquarium, placements, agentStates, roundLabel };
  const cursorEvent = replay ? events[cursor] : undefined;

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
                    {aquarium ? "3D 水族箱" : "3D 舞台"}
                  </button>
                  <button className={viewMode === "timeline" ? "active" : ""} onClick={() => setViewMode("timeline")}>
                    时间轴
                  </button>
                </div>
                <button
                  className={`replay-toggle${replay ? " active" : ""}`}
                  onClick={() => (replay ? setReplay(false) : enterReplay())}
                  disabled={events.length === 0}
                >
                  {replay ? "退出回放" : "回放"}
                </button>
                {selectedWorld.status === "running" && (
                  <button className="run-ctrl stop" onClick={handleStop}>
                    终止
                  </button>
                )}
                <button className="run-ctrl delete" onClick={handleDelete}>
                  删除
                </button>
                <span className={`dot status-${selectedWorld.status}`} />
                <span>{selectedWorld.status}</span>
                <span className={`dot ws-${status}`} title={`WebSocket: ${status}`} />
                <span>{status}</span>
              </div>
            </header>

            {(selectedWorld.status === "failed" || selectedWorld.status === "stopped") && (
              <div className={`world-banner ${selectedWorld.status}`}>
                {selectedWorld.status === "failed" ? "世界运行失败" : "世界已被终止"}
                {selectedWorld.error ? `：${selectedWorld.error}` : ""}
              </div>
            )}

            {selectedWorld.status === "running" && (
              <form className="god-bar" onSubmit={handleSendInstruction}>
                <span className="god-bar-label">上帝指令</span>
                <select value={instrTarget} onChange={(e) => setInstrTarget(e.target.value)}>
                  <option value="">广播给所有 Agent</option>
                  {selectedWorld.agentIds.map((id) => (
                    <option key={id} value={id}>
                      发给 {id}
                    </option>
                  ))}
                </select>
                <input
                  value={instrText}
                  onChange={(e) => setInstrText(e.target.value)}
                  placeholder="对 Agent 发号施令，会出现在它下一次决策的观测里…"
                />
                <button type="submit" disabled={instrSending || !instrText.trim()}>
                  发送
                </button>
              </form>
            )}

            {replay && (
              <div className="replay-bar">
                <button onClick={() => setPlaying((p) => !p)}>{playing ? "⏸" : "▶"}</button>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, events.length - 1)}
                  value={cursor}
                  onChange={(e) => {
                    setPlaying(false);
                    setCursor(Number(e.target.value));
                  }}
                />
                <span className="replay-pos">
                  {cursor + 1} / {events.length}
                </span>
                <div className="replay-speeds">
                  {[1, 2, 4].map((s) => (
                    <button key={s} className={speed === s ? "active" : ""} onClick={() => setSpeed(s)}>
                      {s}x
                    </button>
                  ))}
                </div>
                {cursorEvent && <span className="replay-cursor-type">{cursorEvent.type}</span>}
              </div>
            )}

            {viewMode === "stage" ? (
              shown.aquarium ? (
                <Aquarium3D
                  tank={shown.aquarium.tank}
                  fish={shown.aquarium.fish}
                  tickLabel={`第 ${shown.aquarium.tick} tick`}
                />
              ) : (
                <Stage3D placements={shown.placements} agentStates={shown.agentStates} roundLabel={shown.roundLabel} />
              )
            ) : (
              <div className="timeline">
                {events.map((event, i) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    dim={replay && i > cursor}
                    current={replay && i === cursor}
                    rowRef={replay && i === cursor ? cursorRowRef : undefined}
                  />
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

function EventRow({
  event,
  dim,
  current,
  rowRef,
}: {
  event: WorldEvent;
  dim?: boolean;
  current?: boolean;
  rowRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={rowRef}
      className={`event-row${event.highlight ? " highlight" : ""}${current ? " cursor" : ""}${dim ? " dim" : ""}`}
    >
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
