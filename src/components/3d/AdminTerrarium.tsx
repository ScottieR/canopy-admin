import { useMemo } from "react";
import * as THREE from "three";

export function AdminTerrarium({ size = 2.0, height = 0.6, habitatColor = "#95A86A" }) {
  const earthGeometry = useMemo(() => new THREE.BoxGeometry(size, height, size, 1, 1, 1), [size, height]);
  const earthMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: "#A07458", roughness: 1.0, flatShading: true }), []);
  const grassMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: habitatColor, roughness: 0.8, flatShading: true }), [habitatColor]);

  // Adjust position so top is at Y=0
  return (
    <group position={[0, -height / 2, 0]}>
      {/* Earth block */}
      <mesh geometry={earthGeometry} material={earthMaterial} receiveShadow castShadow />
      
      {/* Grass top */}
      <mesh position={[0, height / 2 + 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[size, size]} />
        <primitive object={grassMaterial} attach="material" />
      </mesh>
    </group>
  );
}
