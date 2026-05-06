import { useRef, useMemo, useEffect } from 'react';
import { useGLTF, TransformControls, OrbitControls, Environment, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';

export function HabitatPlacementScene({
  habitatPath,
  habitatType,
  placement,
  onPlacementChange
}: {
  habitatPath: string;
  habitatType: string;
  placement: { x: number, y: number, z: number, rotationY: number };
  onPlacementChange: (p: { x: number, y: number, z: number, rotationY: number }) => void;
}) {
  return (
    <>
      <OrbitControls makeDefault />
      <Environment preset="city" />
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 10, 5]} intensity={1} castShadow />
      
      {/* Habitat */}
      {habitatType === 'glb' && habitatPath ? (
        <HabitatModel path={`${habitatPath}`} />
      ) : (
        <DefaultPedestal />
      )}
      
      {/* Draggable Lobster */}
      <DraggableLobster placement={placement} onPlacementChange={onPlacementChange} />
    </>
  );
}

function HabitatModel({ path }: { path: string }) {
  const { scene } = useGLTF(path);
  const clonedScene = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  return <primitive object={clonedScene} />;
}

function DefaultPedestal() {
  return (
    <group position={[0, 0, 0]}>
      <mesh receiveShadow position={[0, -0.25, 0]}>
        <cylinderGeometry args={[1.5, 1.5, 0.5, 8]} />
        <meshStandardMaterial color="#C8D8E8" roughness={0.9} flatShading />
      </mesh>
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.1, 1.3, 8]} />
        <meshStandardMaterial color="#ffffff" opacity={0.3} transparent />
      </mesh>
    </group>
  );
}

function DraggableLobster({ placement, onPlacementChange }: { 
  placement: { x: number, y: number, z: number, rotationY: number }, 
  onPlacementChange: (p: { x: number, y: number, z: number, rotationY: number }) => void 
}) {
  const { scene, animations } = useGLTF("/models/lobsters/BaseLobsterRigged.glb");
  const clonedScene = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const groupRef = useRef<THREE.Group>(null);
  
  const { actions, names } = useAnimations(animations, groupRef);

  useEffect(() => {
    if (names.length > 0) {
      const action = actions[names.find(n => n.includes("Idle") || n.includes("Breathe")) || names[0]];
      if (action) action.reset().play();
    }
  }, [actions, names]);

  // Transform controls manage their own transform, so we apply the initial rotation manually 
  // and handle translations directly.
  return (
    <TransformControls 
      mode="translate"
      position={[placement.x, placement.y, placement.z]}
      onMouseUp={() => {
        if (groupRef.current) {
          const pos = groupRef.current.position;
          onPlacementChange({ ...placement, x: pos.x, y: pos.y, z: pos.z });
        }
      }}
    >
      <group ref={groupRef} rotation={[0, placement.rotationY, 0]} scale={0.5}>
        <primitive object={clonedScene} />
      </group>
    </TransformControls>
  );
}
