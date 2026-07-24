import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import type { Group } from "three";
import type { AgentVisualState, AvatarState, WorldEvent } from "./types";

export type StageRole =
  | "pro"
  | "con"
  | "judge"
  | "other"
  | "werewolf"
  | "villager"
  | "seer"
  | "coordinator"
  | "expert"
  | "participant"
  | "observer";

export interface AgentPlacement {
  agentId: string;
  role: StageRole;
  position: [number, number, number];
}

const ROLE_COLOR: Record<StageRole, string> = {
  pro: "#3b82f6",
  con: "#ef4444",
  judge: "#f59e0b",
  other: "#9ca3af",
  werewolf: "#dc2626",
  villager: "#38bdf8",
  seer: "#a855f7",
  coordinator: "#f59e0b",
  expert: "#2dd4bf",
  participant: "#818cf8",
  observer: "#f59e0b",
};

const DEAD_COLOR = "#4b5563";

/**
 * Debate world template's stage layout: pro/con face off on either side,
 * judge stands upstage center. Derived straight from the world.created
 * event's payload (topic/rounds/sides/judge) rather than a separate REST
 * call, so the 3D view only needs the event stream.
 */
export function resolveDebateLayout(worldCreatedPayload: Record<string, unknown> | undefined): AgentPlacement[] {
  if (!worldCreatedPayload) return [];
  const sides = (worldCreatedPayload.sides as { pro?: string[]; con?: string[] } | undefined) ?? {};
  const judge = worldCreatedPayload.judge as string | undefined;
  const placements: AgentPlacement[] = [];

  (sides.pro ?? []).forEach((agentId, i) => {
    placements.push({ agentId, role: "pro", position: [-2.6, 0, -1 - i * 1.6] });
  });
  (sides.con ?? []).forEach((agentId, i) => {
    placements.push({ agentId, role: "con", position: [2.6, 0, -1 - i * 1.6] });
  });
  if (judge) {
    placements.push({ agentId: judge, role: "judge", position: [0, 0, -4.2] });
  }
  return placements;
}

/**
 * Discussion world template's stage layout: participants fan out in a
 * semicircle facing the camera, moderator (if any) stands upstage center —
 * same "judge slot" as debate's judge, reusing its color.
 */
export function resolveDiscussionLayout(worldCreatedPayload: Record<string, unknown> | undefined): AgentPlacement[] {
  if (!worldCreatedPayload) return [];
  const participants = (worldCreatedPayload.participants as string[] | undefined) ?? [];
  const moderator = worldCreatedPayload.moderator as string | undefined;
  const placements: AgentPlacement[] = [];
  const radius = 3.2;

  participants.forEach((agentId, i) => {
    const spread = participants.length > 1 ? i / (participants.length - 1) - 0.5 : 0;
    const angle = spread * Math.PI * 0.8;
    const x = Math.sin(angle) * radius;
    const z = -1.5 - Math.cos(angle) * radius * 0.5;
    placements.push({ agentId, role: "other", position: [x, 0, z] });
  });
  if (moderator) {
    placements.push({ agentId: moderator, role: "judge", position: [0, 0, -4.6] });
  }
  return placements;
}

/**
 * Problem-solving world layout: the coordinator (manager) stands upstage
 * center, the expert "tools" line up in a front row facing it — reads as a
 * coordinator directing a panel of specialists rather than peers debating.
 */
export function resolveProblemLayout(worldCreatedPayload: Record<string, unknown> | undefined): AgentPlacement[] {
  if (!worldCreatedPayload) return [];
  const coordinator = worldCreatedPayload.coordinator as string | undefined;
  const experts = (worldCreatedPayload.experts as string[] | undefined) ?? [];
  const placements: AgentPlacement[] = [];

  experts.forEach((agentId, i) => {
    const spread = experts.length > 1 ? i / (experts.length - 1) - 0.5 : 0;
    placements.push({ agentId, role: "expert", position: [spread * 5, 0, -0.5] });
  });
  if (coordinator) {
    placements.push({ agentId: coordinator, role: "coordinator", position: [0, 0, -4.4] });
  }
  return placements;
}

/**
 * Human-experiment-lab layout: the "people" fan out in a semicircle (like
 * discussion) with the observer/researcher upstage center. Participants get
 * their own indigo color to read distinctly from a plain discussion.
 */
export function resolveHumanLabLayout(worldCreatedPayload: Record<string, unknown> | undefined): AgentPlacement[] {
  if (!worldCreatedPayload) return [];
  const participants = (worldCreatedPayload.participants as string[] | undefined) ?? [];
  const observer = worldCreatedPayload.observer as string | undefined;
  const placements: AgentPlacement[] = [];
  const radius = 3.2;

  participants.forEach((agentId, i) => {
    const spread = participants.length > 1 ? i / (participants.length - 1) - 0.5 : 0;
    const angle = spread * Math.PI * 0.8;
    placements.push({ agentId, role: "participant", position: [Math.sin(angle) * radius, 0, -1.5 - Math.cos(angle) * radius * 0.5] });
  });
  if (observer) {
    placements.push({ agentId: observer, role: "observer", position: [0, 0, -4.6] });
  }
  return placements;
}

/**
 * Werewolf world template's stage layout: everyone stands in a circle (no
 * "sides" — the whole point is you can't tell who's who just from where
 * they're standing). Colored by role for the god view only: role.assigned
 * is per-player-private (visibleTo), but the public roles.assigned event
 * (visibleTo: []) is still visible via the raw, unfiltered EventLog that
 * the frontend reads from — the human observer is meant to be omniscient
 * here, unlike the agents themselves.
 */
export function resolveWerewolfLayout(
  worldCreatedPayload: Record<string, unknown> | undefined,
  rolesAssignedPayload: Record<string, unknown> | undefined,
): AgentPlacement[] {
  if (!worldCreatedPayload) return [];
  const players = (worldCreatedPayload.players as string[] | undefined) ?? [];
  const roles = (rolesAssignedPayload?.roles as Record<string, StageRole> | undefined) ?? {};
  const radius = 3.6;

  return players.map((agentId, i) => {
    const angle = (i / players.length) * Math.PI * 2;
    const x = Math.sin(angle) * radius;
    const z = -2 - Math.cos(angle) * radius * 0.5;
    return { agentId, role: roles[agentId] ?? "other", position: [x, 0, z] };
  });
}

/**
 * Dispatches to the right layout by inspecting the event history — no
 * template name needs to be threaded through WorldView. Debate/discussion
 * only need world.created; werewolf also needs the separate roles.assigned
 * event since roles aren't public in world.created itself.
 */
export function resolveStageLayout(history: WorldEvent[]): AgentPlacement[] {
  const created = history.find((e) => e.type === "world.created");
  if (!created) return [];
  if ("sides" in created.payload) return resolveDebateLayout(created.payload);
  // human-lab also has "participants", so check its distinctive "scenario" first.
  if ("scenario" in created.payload) return resolveHumanLabLayout(created.payload);
  if ("participants" in created.payload) return resolveDiscussionLayout(created.payload);
  if ("experts" in created.payload) return resolveProblemLayout(created.payload);
  if ("players" in created.payload) {
    const rolesEvent = history.find((e) => e.type === "roles.assigned");
    return resolveWerewolfLayout(created.payload, rolesEvent?.payload);
  }
  return [];
}

export function Stage3D({
  placements,
  agentStates,
  roundLabel,
}: {
  placements: AgentPlacement[];
  agentStates: Record<string, AgentVisualState>;
  roundLabel?: string;
}) {
  return (
    <div className="stage3d">
      <Canvas shadows camera={{ position: [0, 4.5, 7.5], fov: 50 }}>
        <color attach="background" args={["#0f1115"]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 8, 5]} intensity={1.1} castShadow />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[24, 24]} />
          <meshStandardMaterial color="#1c1d24" />
        </mesh>
        {placements.map((placement) => (
          <AgentAvatar
            key={placement.agentId}
            placement={placement}
            visual={agentStates[placement.agentId] ?? { state: "idle" }}
          />
        ))}
        <OrbitControls target={[0, 1, -1.5]} maxPolarAngle={Math.PI / 2.1} />
      </Canvas>
      {placements.length === 0 && (
        <div className="stage-empty">这个世界模板还没有 3D 舞台布局</div>
      )}
      {roundLabel && <div className="round-banner">{roundLabel}</div>}
    </div>
  );
}

function AgentAvatar({ placement, visual }: { placement: AgentPlacement; visual: AgentVisualState }) {
  const bobRef = useRef<Group>(null);
  const dead = visual.dead ?? false;

  useFrame(({ clock }) => {
    if (!bobRef.current) return;
    if (dead) {
      bobRef.current.position.y = 0;
      return;
    }
    const t = clock.getElapsedTime();
    const speed = bobSpeed(visual.state);
    const height = bobHeight(visual.state);
    bobRef.current.position.y = Math.sin(t * speed + placement.position[0]) * height;
  });

  const color = dead ? DEAD_COLOR : ROLE_COLOR[placement.role];
  const emissiveIntensity = dead ? 0 : visual.state === "speaking" ? 0.9 : visual.state === "thinking" ? 0.45 : 0.1;

  return (
    <group position={placement.position}>
      <group ref={bobRef} rotation={dead ? [0, 0, Math.PI / 2.2] : [0, 0, 0]}>
        <mesh position={[0, 1, 0]} castShadow>
          <capsuleGeometry args={[0.35, 0.9, 4, 8]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={emissiveIntensity} transparent opacity={dead ? 0.5 : 1} />
        </mesh>
        <mesh position={[0, 1.75, 0]} castShadow>
          <sphereGeometry args={[0.28, 16, 16]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={emissiveIntensity} transparent opacity={dead ? 0.5 : 1} />
        </mesh>
      </group>

      <Html position={[0, 2.35, 0]} center distanceFactor={8} occlude>
        <div className={`avatar-label${dead ? " dead" : ""}`}>
          {placement.agentId}
          {dead ? " ✝" : ""}
        </div>
      </Html>

      {!dead && visual.state === "thinking" && (
        <Html position={[0, 2.05, 0]} center distanceFactor={8}>
          <div className="avatar-badge thinking">思考中…</div>
        </Html>
      )}

      {!dead && visual.state === "speaking" && visual.text && (
        <Html position={[0, 2.05, 0]} center distanceFactor={6}>
          <div className="speech-bubble">{visual.text}</div>
        </Html>
      )}
    </group>
  );
}

function bobSpeed(state: AvatarState): number {
  if (state === "thinking") return 4;
  if (state === "speaking") return 2.2;
  return 1.2;
}

function bobHeight(state: AvatarState): number {
  if (state === "speaking") return 0.12;
  if (state === "thinking") return 0.06;
  return 0.04;
}
