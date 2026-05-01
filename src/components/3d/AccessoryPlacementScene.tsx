import { useEffect, useRef, useMemo } from 'react';
import { createPortal } from '@react-three/fiber';
import { useGLTF, useAnimations, TransformControls, OrbitControls, Environment } from '@react-three/drei';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';

export function AccessoryPlacementScene({
  accessoryGlbPath,
  offset,
  boneName,
  onOffsetChange
}: {
  accessoryGlbPath: string | null;
  offset: [number, number, number];
  boneName: string;
  onOffsetChange: (offset: [number, number, number]) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  
  // Base Lobster
  const { scene: lobsterScene, animations } = useGLTF("http://localhost:3001/models/lobsters/BaseLobsterRigged.glb");
  const clonedLobster = useMemo(() => SkeletonUtils.clone(lobsterScene), [lobsterScene]);
  const { actions, names } = useAnimations(animations, groupRef);

  useEffect(() => {
    if (names.length > 0) {
      // Find a gentle idle animation
      const animName = names.find(n => n.includes("Idle") || n.includes("Breathe")) || names[0];
      const action = actions[animName];
      if (action) {
        action.reset().play();
      }
    }
  }, [actions, names]);

  // Find the target bone
  const targetBone = useMemo(() => {
    let found: THREE.Object3D | null = null;
    clonedLobster.traverse((node: any) => {
      if (node.isBone && node.name.toLowerCase().includes(boneName.toLowerCase())) {
         found = node;
      }
    });
    return found || clonedLobster; // Fallback to root if bone not found
  }, [clonedLobster, boneName]);

  return (
    <>
      <OrbitControls makeDefault />
      <Environment preset="city" />
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 5, 5]} intensity={1} />
      
      <group ref={groupRef} position={[0, -1, 0]}>
        <primitive object={clonedLobster} />
        
        {accessoryGlbPath && targetBone && (
           <AccessoryObject 
             glbPath={accessoryGlbPath} 
             parent={targetBone} 
             offset={offset} 
             onOffsetChange={onOffsetChange} 
           />
        )}
      </group>
    </>
  );
}

function AccessoryObject({ glbPath, parent, offset, onOffsetChange }: { glbPath: string, parent: THREE.Object3D, offset: [number, number, number], onOffsetChange: (o: [number, number, number]) => void }) {
  const { scene } = useGLTF(glbPath);
  const clonedScene = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const groupRef = useRef<THREE.Group>(null);

  // We portal the accessory into the specific bone of the rigged lobster
  return createPortal(
    <group position={offset as any} ref={groupRef}>
       <TransformControls 
         mode="translate"
         onMouseUp={() => {
           if (groupRef.current) {
             const pos = groupRef.current.position;
             onOffsetChange([pos.x, pos.y, pos.z]);
           }
         }}
       >
         <primitive object={clonedScene} />
       </TransformControls>
    </group>,
    parent
  );
}

useGLTF.preload("http://localhost:3001/models/lobsters/BaseLobsterRigged.glb");
