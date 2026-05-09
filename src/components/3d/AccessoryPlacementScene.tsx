import { useEffect, useRef, useMemo, useState } from 'react';
import { createPortal, useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations, TransformControls, OrbitControls, Environment, Center, Resize } from '@react-three/drei';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';

import { AttachedAccessory } from '../../../../canopy/src/components/World/AttachedAccessory';
import { AdminGLBAgent } from './AdminGLBAgent';

export function AccessoryPlacementScene({
  accessoryGlbPath,
  offset,
  rotation = [0, 0, 0],
  decorRotation = [0, 0, 0],
  scale = 0.25,
  type = 'accessory',
  boneName,
  onOffsetChange,
  onRotationChange,
  onScaleChange,
  animated = false,
  isEditingAccessory = false,
  isAnchorMode = false,
  boneDefaults,
  transformMode = "translate"
}: {
  accessoryGlbPath: string | null;
  offset: [number, number, number];
  rotation?: [number, number, number];
  decorRotation?: [number, number, number];
  scale: number;
  type?: 'accessory' | 'decor' | 'both';
  boneName: string;
  onOffsetChange: (offset: [number, number, number]) => void;
  onRotationChange: (rotation: [number, number, number]) => void;
  onScaleChange: (scale: number) => void;
  animated?: boolean;
  isEditingAccessory?: boolean;
  isAnchorMode?: boolean;
  boneDefaults?: Record<string, { offset: [number, number, number], rotation: [number, number, number], scale: number }>;
  transformMode?: "translate" | "rotate" | "scale";
}) {
  const groupRef = useRef<THREE.Group>(null);
  const [orbitEnabled, setOrbitEnabled] = useState(true);

  // Base Lobster
  const { scene: lobsterScene, animations } = useGLTF("/models/lobsters/BaseLobsterRigged.glb");
  const clonedLobster = useMemo(() => SkeletonUtils.clone(lobsterScene), [lobsterScene]);
  const { actions, names } = useAnimations(animations, groupRef);

  useEffect(() => {
    if (names.length > 0) {
      const animName = names.find(n => n.includes("Idle") || n.includes("Breathe")) || names[0];
      const action = actions[animName];
      if (action) {
        if (animated) {
          action.reset().fadeIn(0.5).play();
        } else {
          action.stop();
        }
      }
    }
  }, [actions, names, animated]);

  const [target, setTarget] = useState<THREE.Group | null>(null);

  // Find the target bone
  const targetBone = useMemo(() => {
    let found: THREE.Object3D | null = null;
    clonedLobster.traverse((node: any) => {
      let b = boneName.toLowerCase().replace(/[._-]/g, '');
      if (b === 'handl') b = 'lefthand';
      if (b === 'handr') b = 'righthand';
      const normalizedNodeName = node.name.toLowerCase().replace(/[._-]/g, '');
      if (node.isBone && normalizedNodeName.includes(b)) {
        found = node;
      }
    });
    return found || clonedLobster;
  }, [clonedLobster, boneName]);

  return (
    <>
      <OrbitControls makeDefault enabled={orbitEnabled} />
      <Environment preset="city" />
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 5, 5]} intensity={1} />

      <group ref={groupRef} position={[0, -1, 0]}>
        {!isAnchorMode && accessoryGlbPath && (
          <AdminGLBAgent
            animated={animated}
            modelScale={0.5}
            modelPosition={[0, -0.23, 0]}
            transformRef={setTarget}
            transformAccessoryPath={accessoryGlbPath.replace('.glb', '.png')}
            accessories={[accessoryGlbPath.replace('.glb', '.png')]}
            accessoryData={{
              items: {
                [accessoryGlbPath.replace('.glb', '.png')]: {
                  bone: boneName,
                  offset,
                  rotation,
                  decorRotation,
                  scale,
                  type
                }
              },
              boneDefaults
            }}
          />
        )}

        {isAnchorMode && (
          <>
            <primitive object={clonedLobster} />
            {targetBone && (
              <AnchorMarker
                parent={targetBone}
                offset={offset}
                rotation={rotation}
                scale={scale}
                mode={transformMode}
                isEditingAccessory={isEditingAccessory}
                onOffsetChange={onOffsetChange}
                onRotationChange={onRotationChange}
                onScaleChange={onScaleChange}
                onDraggingChanged={(isDragging) => setOrbitEnabled(!isDragging)}
              />
            )}
          </>
        )}

        {isEditingAccessory && target && (
          <TransformControls
            object={target}
            mode={transformMode}
            space="local"
            onChange={() => {
              const pos = target.position;
              const rot = target.rotation;
              const s = target.scale.x;
              onOffsetChange([pos.x, pos.y, pos.z]);
              onRotationChange([rot.x, rot.y, rot.z]);
              onScaleChange(s);
            }}
            onDraggingChanged={(e) => {
              const isDragging = !!e?.value;
              setOrbitEnabled(!isDragging);
            }}
          />
        )}
      </group>
    </>
  );
}


function AnchorMarker({ parent, offset, rotation, scale, mode, isEditingAccessory, onOffsetChange, onRotationChange, onScaleChange, onDraggingChanged }: {
  parent: THREE.Object3D,
  offset: [number, number, number],
  rotation: [number, number, number],
  scale: number,
  mode: "translate" | "rotate" | "scale",
  isEditingAccessory?: boolean,
  onOffsetChange: (o: [number, number, number]) => void,
  onRotationChange: (r: [number, number, number]) => void,
  onScaleChange: (s: number) => void,
  onDraggingChanged: (isDragging: boolean) => void
}) {
  const [target, setTarget] = useState<THREE.Group | null>(null);

  const stateRef = useRef({ target, onOffsetChange, onRotationChange, onScaleChange });
  useEffect(() => {
    stateRef.current = { target, onOffsetChange, onRotationChange, onScaleChange };
  }, [target, onOffsetChange, onRotationChange, onScaleChange]);

  useEffect(() => {
    if (target) {
      target.position.set(...offset);
      target.rotation.set(...rotation);
      target.scale.set(scale, scale, scale);
    }
  }, [offset, rotation, scale, target]);

  return (
    <>
      {isEditingAccessory && target && (
        <TransformControls
          object={target}
          mode={mode}
          space="local"
          size={3}
          onChange={(e) => {
            const { target: t, onOffsetChange: oc, onRotationChange: rc, onScaleChange: sc } = stateRef.current;
            if (t) {
              const pos = t.position;
              const rot = t.rotation;
              const s = t.scale.x;
              oc([pos.x, pos.y, pos.z]);
              rc([rot.x, rot.y, rot.z]);
              sc(s);
            }
          }}
          onObjectChange={(e) => {
            const { target: t, onOffsetChange: oc, onRotationChange: rc, onScaleChange: sc } = stateRef.current;
            if (t) {
              const pos = t.position;
              oc([pos.x, pos.y, pos.z]);
            }
          }}
          onDraggingChanged={(e) => {
            const isDragging = !!e?.value;
            onDraggingChanged(isDragging);
          }}
        />
      )}
      {createPortal(
        <group >
          <group position={offset as any} rotation={rotation as any} scale={[scale, scale, scale]} ref={setTarget}>
            <axesHelper args={[2]} />
          </group>
        </group>,
        parent
      )}
    </>
  );
}

useGLTF.preload("/models/lobsters/BaseLobsterRigged.glb");
