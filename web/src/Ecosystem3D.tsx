import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { Group, MathUtils } from "three";
import type { CreatureSnapshot } from "./world/replay";

const PREDATOR_COLOR = "#ef4444";
const PREY_COLOR = "#4ade80";

/**
 * Top-down-ish field of creatures: predators are larger red spheres, prey
 * smaller green ones; positions lerp toward the latest world.tick snapshot,
 * and a creature simply disappears when it's no longer in the snapshot
 * (eaten / starved).
 */
export function Ecosystem3D({
  field,
  creatures,
  counts,
  tickLabel,
}: {
  field: number;
  creatures: CreatureSnapshot[];
  counts: { predators: number; prey: number };
  tickLabel?: string;
}) {
  return (
    <div className="stage3d">
      <Canvas shadows camera={{ position: [0, field * 0.9, field * 0.9], fov: 50 }}>
        <color attach="background" args={["#0d1510"]} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[6, 12, 4]} intensity={1} castShadow />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[field, field]} />
          <meshStandardMaterial color="#14311f" />
        </mesh>
        {creatures.map((c) => (
          <Creature key={c.id} target={c} />
        ))}
        <OrbitControls target={[0, 0, 0]} maxPolarAngle={Math.PI / 2.1} />
      </Canvas>
      {creatures.length === 0 && <div className="stage-empty">等待生态数据...</div>}
      <div className="round-banner">
        {tickLabel} · 🦊 {counts.predators} · 🐇 {counts.prey}
      </div>
    </div>
  );
}

function Creature({ target }: { target: CreatureSnapshot }) {
  const group = useRef<Group>(null);
  const targetRef = useRef(target);
  targetRef.current = target;
  const isPredator = target.type === "predator";
  const r = isPredator ? 0.45 : 0.28;
  const color = isPredator ? PREDATOR_COLOR : PREY_COLOR;

  useFrame((_s, delta) => {
    const g = group.current;
    if (!g) return;
    const t = targetRef.current;
    const lerp = Math.min(1, delta * 6);
    g.position.x = MathUtils.lerp(g.position.x, t.x, lerp);
    g.position.z = MathUtils.lerp(g.position.z, t.z, lerp);
  });

  return (
    <group ref={group} position={[target.x, r, target.z]}>
      <mesh castShadow>
        <sphereGeometry args={[r, 16, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} />
      </mesh>
      <Html position={[0, r + 0.3, 0]} center distanceFactor={14}>
        <div className="avatar-label">{target.id}</div>
      </Html>
    </group>
  );
}
