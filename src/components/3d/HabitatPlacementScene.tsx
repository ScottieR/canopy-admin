import { useRef, useMemo, useEffect } from 'react';
import { useGLTF, TransformControls, OrbitControls, Environment, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';

export function HabitatPlacementScene({
  habitatPath,
  habitatType,
  placement,
  decorPoints,
  placementMode,
  onPlacementChange,
  onDecorPointsChange
}: {
  habitatPath: string;
  habitatType: string;
  placement: { x: number, y: number, z: number, rotationY: number };
  decorPoints: { x: number, y: number, z: number }[];
  placementMode: 'lobster' | 'paint' | 'erase';
  onPlacementChange: (p: { x: number, y: number, z: number, rotationY: number }) => void;
  onDecorPointsChange: (pts: { x: number, y: number, z: number }[]) => void;
}) {
  return (
    <>
      <OrbitControls makeDefault enabled={placementMode === 'lobster'} />
      <Environment preset="city" />
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 10, 5]} intensity={1} castShadow />
      
      {/* Habitat */}
      {habitatType === 'glb' && habitatPath ? (
        <HabitatModel 
          path={habitatPath} 
          decorPoints={decorPoints} 
          placementMode={placementMode} 
          onDecorPointsChange={onDecorPointsChange} 
        />
      ) : (
        <DefaultPedestal />
      )}
      
      {/* Draggable Lobster */}
      {placementMode === 'lobster' && (
        <DraggableLobster placement={placement} onPlacementChange={onPlacementChange} />
      )}
    </>
  );
}

import { useState } from 'react';

function HabitatModel({ path, decorPoints, placementMode, onDecorPointsChange }: { path: string, decorPoints: { x: number, y: number, z: number }[], placementMode: 'lobster' | 'paint' | 'erase', onDecorPointsChange: (pts: { x: number, y: number, z: number }[]) => void }) {
  const { scene } = useGLTF(path.startsWith('http') ? path : `http://localhost:3001${path.startsWith('/') ? '' : '/'}${path}`);
  const clonedScene = useMemo(() => {
    const clone = SkeletonUtils.clone(scene);
    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());

    const maxDim = Math.max(size.x, size.z);
    const targetScale = maxDim > 0 ? (2.2 / maxDim) * 2 : 2;
    clone.scale.set(targetScale, targetScale, targetScale);
    clone.updateMatrixWorld(true);

    const raycaster = new THREE.Raycaster();
    raycaster.set(new THREE.Vector3(0, 50, 0), new THREE.Vector3(0, -1, 0));
    const intersects = raycaster.intersectObject(clone, true);
    if (intersects.length > 0) {
      clone.position.y = -intersects[0].point.y;
    } else {
      clone.position.y = -(box.max.y * targetScale);
    }
    
    // Convert materials to unlit so they match perfectly
    clone.traverse((child: any) => {
      if (child.isMesh && child.material) {
        if (child.material.map) {
          const safeMap = child.material.map.clone();
          safeMap.needsUpdate = true;
          child.material = new THREE.MeshBasicMaterial({ map: safeMap });
        }
      }
    });

    return clone;
  }, [scene]);
  const [isDrawing, setIsDrawing] = useState(false);

  const handleInteract = (point: THREE.Vector3) => {
    if (placementMode === 'paint') {
      const isTooClose = decorPoints.some(p => {
        const dist = Math.sqrt(Math.pow(p.x - point.x, 2) + Math.pow(p.y - point.y, 2) + Math.pow(p.z - point.z, 2));
        return dist < 0.15;
      });
      if (!isTooClose) {
        onDecorPointsChange([...decorPoints, { x: point.x, y: point.y, z: point.z }]);
      }
    } else if (placementMode === 'erase') {
      const newPts = decorPoints.filter(p => {
        const dist = Math.sqrt(Math.pow(p.x - point.x, 2) + Math.pow(p.y - point.y, 2) + Math.pow(p.z - point.z, 2));
        return dist >= 0.3; // larger erase radius
      });
      if (newPts.length < decorPoints.length) {
        onDecorPointsChange(newPts);
      }
    }
  };

  return (
    <group>
      <primitive 
        object={clonedScene} 
        onPointerDown={(e: any) => {
          if (placementMode !== 'lobster') {
            e.stopPropagation();
            setIsDrawing(true);
            handleInteract(e.point);
          }
        }}
        onPointerUp={() => setIsDrawing(false)}
        onPointerOut={() => setIsDrawing(false)}
        onPointerMove={(e: any) => {
          if (isDrawing && placementMode !== 'lobster') {
            e.stopPropagation();
            handleInteract(e.point);
          }
        }}
      />
      {decorPoints.map((p, i) => (
        <mesh key={i} position={[p.x, p.y, p.z]}>
          <sphereGeometry args={[0.08, 8, 8]} />
          <meshBasicMaterial color="#FFAB91" opacity={0.8} transparent />
        </mesh>
      ))}
    </group>
  );
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
      onMouseUp={() => {
        if (groupRef.current) {
          const pos = groupRef.current.position;
          onPlacementChange({ ...placement, x: pos.x, y: pos.y, z: pos.z });
        }
      }}
    >
      <group ref={groupRef} position={[placement.x || 0, placement.y || 0, placement.z || 0]} rotation={[0, placement.rotationY || 0, 0]} scale={0.5}>
        <primitive object={clonedScene} />
      </group>
    </TransformControls>
  );
}
