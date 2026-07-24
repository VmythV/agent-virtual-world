import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import type { Group } from "three";
import type { AgentVisualState, AvatarState } from "./types";

export type StageRole = "pro" | "con" | "judge" | "other";

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
};

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
 * Dispatches to the right layout purely from which keys are present in the
 * world.created payload (no template name needed) — stays event-driven, so
 * adding a template doesn't require threading its id through WorldView.
 */
export function resolveStageLayout(worldCreatedPayload: Record<string, unknown> | undefined): AgentPlacement[] {
  if (!worldCreatedPayload) return [];
  if ("sides" in worldCreatedPayload) return resolveDebateLayout(worldCreatedPayload);
  if ("participants" in worldCreatedPayload) return resolveDiscussionLayout(worldCreatedPayload);
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

  useFrame(({ clock }) => {
    if (!bobRef.current) return;
    const t = clock.getElapsedTime();
    const speed = bobSpeed(visual.state);
    const height = bobHeight(visual.state);
    bobRef.current.position.y = Math.sin(t * speed + placement.position[0]) * height;
  });

  const color = ROLE_COLOR[placement.role];
  const emissiveIntensity = visual.state === "speaking" ? 0.9 : visual.state === "thinking" ? 0.45 : 0.1;

  return (
    <group position={placement.position}>
      <group ref={bobRef}>
        <mesh position={[0, 1, 0]} castShadow>
          <capsuleGeometry args={[0.35, 0.9, 4, 8]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={emissiveIntensity} />
        </mesh>
        <mesh position={[0, 1.75, 0]} castShadow>
          <sphereGeometry args={[0.28, 16, 16]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={emissiveIntensity} />
        </mesh>
      </group>

      <Html position={[0, 2.35, 0]} center distanceFactor={8} occlude>
        <div className="avatar-label">{placement.agentId}</div>
      </Html>

      {visual.state === "thinking" && (
        <Html position={[0, 2.05, 0]} center distanceFactor={8}>
          <div className="avatar-badge thinking">思考中…</div>
        </Html>
      )}

      {visual.state === "speaking" && visual.text && (
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
