import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Edges, Html, OrbitControls } from "@react-three/drei";
import { Group, MathUtils } from "three";

export interface TankSize {
  w: number;
  h: number;
  d: number;
}

export interface FishSnapshot {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  behavior: string;
}

const FISH_COLORS = ["#f97316", "#22d3ee", "#a3e635", "#e879f9", "#facc15", "#38bdf8"];

export function Aquarium3D({ tank, fish, tickLabel }: { tank: TankSize; fish: FishSnapshot[]; tickLabel?: string }) {
  return (
    <div className="stage3d">
      <Canvas shadows camera={{ position: [0, tank.h * 0.7, tank.w * 1.25], fov: 50 }}>
        <color attach="background" args={["#0a1a24"]} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[4, 10, 6]} intensity={1} />

        {/* Tank: transparent water volume + wireframe edges, floor at y=0. */}
        <group position={[0, tank.h / 2, 0]}>
          <mesh>
            <boxGeometry args={[tank.w, tank.h, tank.d]} />
            <meshStandardMaterial color="#1d4ed8" transparent opacity={0.08} />
            <Edges color="#3b82f6" />
          </mesh>
        </group>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
          <planeGeometry args={[tank.w, tank.d]} />
          <meshStandardMaterial color="#0c2430" />
        </mesh>

        {fish.map((f, i) => (
          <Fish key={f.id} target={f} color={FISH_COLORS[i % FISH_COLORS.length]} />
        ))}

        <OrbitControls target={[0, tank.h / 2, 0]} />
      </Canvas>
      {fish.length === 0 && <div className="stage-empty">等待鱼群数据...</div>}
      {tickLabel && <div className="round-banner">{tickLabel}</div>}
    </div>
  );
}

function Fish({ target, color }: { target: FishSnapshot; color: string }) {
  const group = useRef<Group>(null);
  // Latest target read inside useFrame without re-subscribing each render.
  const targetRef = useRef(target);
  targetRef.current = target;

  useFrame((_state, delta) => {
    const g = group.current;
    if (!g) return;
    const t = targetRef.current;
    const lerp = Math.min(1, delta * 6);
    g.position.x = MathUtils.lerp(g.position.x, t.x, lerp);
    g.position.y = MathUtils.lerp(g.position.y, t.y, lerp);
    g.position.z = MathUtils.lerp(g.position.z, t.z, lerp);
    g.rotation.y = t.yaw;
  });

  return (
    <group ref={group} position={[target.x, target.y, target.z]}>
      {/* Body: an ellipsoid via a scaled sphere, pointing +z (heading). */}
      <mesh scale={[0.28, 0.28, 0.5]} castShadow>
        <sphereGeometry args={[1, 16, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.25} />
      </mesh>
      {/* Tail fin behind the body. */}
      <mesh position={[0, 0, -0.5]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.22, 0.35, 4]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.25} />
      </mesh>
      <Html position={[0, 0.5, 0]} center distanceFactor={12}>
        <div className="avatar-label">{target.id}</div>
      </Html>
    </group>
  );
}
