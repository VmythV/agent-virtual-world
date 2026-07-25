import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import type { Group } from "three";
import type { AgentVisualState, AvatarState } from "./types";
import type { AgentPlacement, StageRole } from "./world/layout";

export type { AgentPlacement, StageRole } from "./world/layout";
export {
  resolveDebateLayout,
  resolveDiscussionLayout,
  resolveProblemLayout,
  resolveHumanLabLayout,
  resolveWerewolfLayout,
  resolveStageLayout,
} from "./world/layout";

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
  bidder: "#2dd4bf",
  auctioneer: "#f59e0b",
  prosecution: "#3b82f6",
  defense: "#ef4444",
  witness: "#94a3b8",
  builder: "#22d3ee",
  player: "#a855f7",
  buyer: "#3b82f6",
  seller: "#ef4444",
  member: "#818cf8",
  solver: "#f59e0b",
  researcher: "#2dd4bf",
  lead: "#f59e0b",
};

const DEAD_COLOR = "#4b5563";

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
