import { useTexture, Billboard } from "@react-three/drei";
import * as THREE from "three";

export function SafeBillboard({ url, position = [0, 0, 0] }: { url: string; position?: [number, number, number] }) {
  const texture = useTexture(url);
  return (
    <Billboard position={position} follow={true} lockX={false} lockY={false} lockZ={false}>
      <mesh>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={texture} transparent side={THREE.DoubleSide} />
      </mesh>
    </Billboard>
  );
}
