import { useEffect, useRef, useState } from "react";
import type { WorldEvent, WorldSummary, WsMessage } from "./types";
import { fetchWorlds } from "./api";
import "./App.css";

type ConnectionStatus = "idle" | "connecting" | "open" | "closed" | "error";

function App() {
  const [worlds, setWorlds] = useState<WorldSummary[]>([]);
  const [selectedWorldId, setSelectedWorldId] = useState<string | undefined>();
  const [events, setEvents] = useState<WorldEvent[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const listEndRef = useRef<HTMLDivElement>(null);

  const loadWorlds = () => {
    fetchWorlds()
      .then((list) => {
        setWorlds(list);
        setSelectedWorldId((current) => current ?? list[0]?.id);
      })
      .catch((err) => console.error(err));
  };

  useEffect(loadWorlds, []);

  useEffect(() => {
    if (!selectedWorldId) return;

    setEvents([]);
    setStatus("connecting");

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws/worlds/${selectedWorldId}`);

    ws.onopen = () => setStatus("open");
    ws.onclose = () => setStatus("closed");
    ws.onerror = () => setStatus("error");
    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data) as WsMessage;
      if (data.type === "history") {
        setEvents(data.events);
      } else {
        setEvents((prev) => [...prev, data.event]);
      }
    };

    return () => ws.close();
  }, [selectedWorldId]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [events]);

  const selectedWorld = worlds.find((w) => w.id === selectedWorldId);

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>Agent Virtual World</h1>
          <button onClick={loadWorlds}>刷新</button>
        </div>
        <ul className="world-list">
          {worlds.map((world) => (
            <li
              key={world.id}
              className={world.id === selectedWorldId ? "selected" : ""}
              onClick={() => setSelectedWorldId(world.id)}
            >
              <div className="world-list-row">
                <span className={`dot status-${world.status}`} />
                <span className="world-template">{world.template}</span>
              </div>
              <div className="world-id">{world.id.slice(0, 8)}</div>
              <div className="world-time">{new Date(world.createdAt).toLocaleString()}</div>
            </li>
          ))}
          {worlds.length === 0 && <li className="empty">还没有世界，先通过 REST API 创建一个</li>}
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
                <span className={`dot status-${selectedWorld.status}`} />
                <span>{selectedWorld.status}</span>
                <span className={`dot ws-${status}`} title={`WebSocket: ${status}`} />
                <span>{status}</span>
              </div>
            </header>
            <div className="timeline">
              {events.map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
              {events.length === 0 && <div className="empty-state">等待事件...</div>}
              <div ref={listEndRef} />
            </div>
          </>
        ) : (
          <div className="empty-state">选择左侧的一个世界查看事件时间轴</div>
        )}
      </main>
    </div>
  );
}

function EventRow({ event }: { event: WorldEvent }) {
  return (
    <div className={`event-row${event.highlight ? " highlight" : ""}`}>
      <span className="event-seq">#{event.sequence}</span>
      <span className="event-type">{event.type}</span>
      {event.actorId && <span className="event-actor">{event.actorId}</span>}
      <span className="event-payload">{renderPayload(event)}</span>
    </div>
  );
}

function renderPayload(event: WorldEvent): string {
  if (typeof event.payload.text === "string") {
    return event.payload.text;
  }
  return JSON.stringify(event.payload);
}

export default App;
