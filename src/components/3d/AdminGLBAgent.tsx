import React, { useEffect, useRef, useMemo, Component, ReactNode } from "react";
import { useGLTF, useAnimations } from "@react-three/drei";
import * as THREE from "three";
import { SkeletonUtils } from "three-stdlib";

class SafeAccessoryBoundary extends Component<{ children: ReactNode, name: string }, { hasError: boolean }> {
  constructor(props: { children: ReactNode, name: string }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(_error: any) {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      console.warn(`SafeAccessoryBoundary caught error for ${this.props.name}`);
      return null;
    }
    return this.props.children;
  }
}

// Maintain a module-level stagger so each agent drops into the scene exactly 100ms out of phase
let globalAnimationStagger = 0;

export function AdminGLBAgent({
  robeColor,
  forceAnimation = "Breathe",
  accessories = [],
  accessoryData = null,
  animated = true,
  transformRef,
  transformAccessoryPath,
  modelScale = 0.5,
  modelPosition = [0, -0.23, 0],
  modelRotationY = 0,
  decorTransforms = {},
  decorPoints = [],
  selectedDecorPath = null,
  transformMode = 'translate',
  onSelectDecor = undefined,
  onDecorTransformChange = undefined,
  onSelectAccessory = undefined,
  accessoryBehaviors = {},
  onDraggingDecor = undefined
}: {
  robeColor?: string,
  forceAnimation?: string,
  accessories?: string[],
  accessoryData?: any,
  animated?: boolean,
  transformRef?: React.Ref<THREE.Group>,
  transformAccessoryPath?: string,
  modelScale?: number,
  modelPosition?: [number, number, number],
  modelRotationY?: number,
  decorTransforms?: Record<string, any>,
  decorPoints?: { x: number, y: number, z: number }[],
  selectedDecorPath?: string | null,
  transformMode?: 'translate' | 'rotate' | 'scale',
  onSelectDecor?: (path: string) => void,
  onDecorTransformChange?: (path: string, transform: any) => void,
  onSelectAccessory?: (path: string) => void,
  accessoryBehaviors?: Record<string, 'wearable' | 'decor'>,
  onDraggingDecor?: (dragging: boolean) => void
}) {
  const groupRef = useRef<THREE.Group>(null);

  // Load the universal rigged body.
  const { scene, animations } = useGLTF("/models/lobsters/BaseLobsterRigged.glb?v=2");

  // Clone efficiently so each preview gets its own distinct colored materials
  const clonedScene = useMemo(() => {
    const clone = SkeletonUtils.clone(scene);
    clone.traverse((node: any) => {
      if (node.isMesh && node.material) {
        node.material = node.material.clone();
      }
    });
    return clone;
  }, [scene]);

  // Dynamically colorize the outfit in-place so we don't break the animation mixer bindings!
  useEffect(() => {
    if (clonedScene && robeColor) {
      try {
        const linearColor = new THREE.Color(robeColor);
        linearColor.convertSRGBToLinear();

        clonedScene.traverse((node: any) => {
          if (node.userData?.isAccessory) return;
          if (node.isMesh && node.material && !node.name.toLowerCase().includes("eye")) {
            if (Array.isArray(node.material)) {
              node.material.forEach((mat: any) => {
                if (mat) {
                  mat.map = null;
                  mat.color.copy(linearColor);
                  mat.needsUpdate = true;
                }
              });
            } else if (node.material) {
              node.material.map = null;
              node.material.color.copy(linearColor);
              node.material.needsUpdate = true;
            }
          }
        });
      } catch (e) {
        console.warn("Could not apply robeColor to mesh:", e);
      }
    }
  }, [clonedScene, robeColor]);

  // Bind animations to our cloned instance
  const { actions, names } = useAnimations(animations, groupRef);

  useEffect(() => {
    if (names.length === 0) return;

    const idleAnim = names.find(n => n === "Breathe") || names[0];
    let activeActionName = idleAnim;

    if (forceAnimation && names.includes(forceAnimation)) {
      activeActionName = forceAnimation;
    } else if (forceAnimation) {
      const fuzzy = names.find(n => n.includes("Breathe") || n.includes("Idle"));
      if (fuzzy) activeActionName = fuzzy;
    }

    // Hard fallback patch just in case
    if (!actions[activeActionName]) {
      activeActionName = names[0];
    }

    console.log(`[AdminGLBAgent] Animation Effect triggered. forceAnimation: ${forceAnimation} test, activeActionName: ${activeActionName}, available: ${names.join(", ")}`);

    const action = actions[activeActionName];

    // Explicitly stop all other actions to prevent cross-contamination or stuck weights
    Object.values(actions).forEach((a) => {
      if (a && a !== action) {
        a.stop();
        a.setEffectiveWeight(0);
      }
    });

    console.log(`[AdminGLBAgent] Playing clip: ${action ? action.getClip().name : 'none'} for action: ${activeActionName}`);

    if (action) {
      if (animated) {
        globalAnimationStagger += 0.1;
        // Don't use fadeIn/fadeOut here as rapid React re-renders can cause weight interpolation bugs
        action.reset().setEffectiveWeight(1).play();
        action.time = globalAnimationStagger % action.getClip().duration;
      } else {
        action.stop();
      }
    }

    return () => { if (action) action.stop(); };
  }, [actions, names, forceAnimation, animated]);

  return (
    <>
      <group ref={groupRef} position={modelPosition} rotation={[0, modelRotationY, 0]} scale={modelScale} dispose={null}>
        <primitive object={clonedScene} />
        {accessories.map((acc, i) => {
          const itemData = accessoryData?.items?.[acc];
          const behavior = accessoryBehaviors?.[acc] || itemData?.type || 'accessory';
          if (behavior === 'decor') return null; // Don't attach strict decor to the agent body!

          console.log(`[AdminGLBAgent] Rendering accessory: ${acc}`, { scale: itemData?.scale, offset: itemData?.offset });
          const isEdited = acc === transformAccessoryPath;
          return (
            <SafeAccessoryBoundary key={`${acc}-${i}`} name={acc}>
              <group onClick={(e) => { e.stopPropagation(); if (onSelectAccessory) onSelectAccessory(acc); }} onPointerOver={() => { document.body.style.cursor = onSelectAccessory ? 'pointer' : 'auto'; }} onPointerOut={() => { document.body.style.cursor = 'auto'; }}>
                <AttachedAccessory
                  path={acc}
                  accessoryData={accessoryData}
                  clonedSceneRoot={clonedScene}
                  transformRef={isEdited ? transformRef : undefined}
                />
              </group>
            </SafeAccessoryBoundary>
          );
        })}
      </group>

      {/* Render Decor Items in World Space */}
      <group>
        {accessories.map((acc, i) => {
          const itemData = accessoryData?.items?.[acc];
          const behavior = accessoryBehaviors?.[acc] || itemData?.type || 'accessory';
          if (behavior !== 'decor') return null;

          const glbPath = acc.startsWith('http') ? acc.replace('.png', '.glb') : `http://localhost:3001${acc.startsWith('/') ? '' : '/'}${acc.replace('.png', '.glb')}`;
          const transform = decorTransforms[acc];

          // 1. Saved transform (prioritized)
          // 2. Procedural valid decor point (seeded)
          // 3. Fallback random float
          let bx, by, bz;
          if (transform) {
            bx = transform.x; by = transform.y; bz = transform.z;
          } else if (decorPoints && decorPoints.length > 0) {
            const point = decorPoints[(acc.length + i) % decorPoints.length];
            bx = point.x; by = point.y; bz = point.z;
          } else {
            const seed = acc.length + i;
            bx = (Math.sin(seed * 1.1) * 3);
            by = 0;
            bz = (Math.cos(seed * 1.3) * 3);
          }

          const rotation = transform ? [transform.rotationX || 0, transform.rotationY || 0, transform.rotationZ || 0] : (itemData?.decorRotation || itemData?.rotation || [0, Math.sin(acc.length + i) * Math.PI, 0]);
          // Decor is placed in world space (or scaled lobster space), whereas accessories are placed on bones
          // The standard rig bones have a scale of ~0.01, so an accessory scale of 75 looks like 0.75. 
          // We multiply the decor scale by 0.01 here so they are consistent sizes.
          const baseScale = transform?.scale || itemData?.scale || 75;
          // Apply modelScale visually so decor matches the lobster preview size
          const scale = baseScale * 0.01 * modelScale;
          const isEdited = acc === transformAccessoryPath;
          const isSelectedDecor = acc === selectedDecorPath;

          return (
            <SafeAccessoryBoundary key={`decor-${acc}-${i}`} name={glbPath}>
              <AdminDecorModel
                url={glbPath}
                path={acc}
                position={[bx, by, bz]}
                rotation={rotation as any}
                scale={scale}
                transformMode={transformMode}
                transformRef={isEdited ? transformRef : undefined}
                isSelected={isSelectedDecor}
                modelScale={modelScale}
                onSelect={() => onSelectDecor && onSelectDecor(acc)}
                onTransformChange={(t) => onDecorTransformChange && onDecorTransformChange(acc, t)}
                onDraggingChanged={onDraggingDecor}
              />
            </SafeAccessoryBoundary>
          );
        })}
      </group>
    </>
  );
}

function AdminDecorModel({ url, path, position, rotation, scale, transformRef, transformMode = 'translate', isSelected, onSelect, onTransformChange, onDraggingChanged, modelScale = 0.5 }: { url: string, path: string, position: [number, number, number], rotation: [number, number, number], scale: number, transformRef?: React.Ref<THREE.Group>, transformMode?: 'translate' | 'rotate' | 'scale', isSelected?: boolean, onSelect?: () => void, onTransformChange?: (t: any) => void, onDraggingChanged?: (b: boolean) => void, modelScale?: number }) {
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => {
    const clone = SkeletonUtils.clone(scene);
    clone.traverse((node: any) => { node.userData = { ...node.userData, isAccessory: true }; });
    const box = new THREE.Box3().setFromObject(clone);
    const size = new THREE.Vector3();
    box.getSize(size);

    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0) {
      const scaleFactor = 1.0 / maxDim;
      clone.scale.setScalar(scaleFactor);

      const scaledBox = new THREE.Box3().setFromObject(clone);
      const center = new THREE.Vector3();
      scaledBox.getCenter(center);

      clone.position.x = -center.x;
      clone.position.z = -center.z;
      clone.position.y = -scaledBox.min.y;
    }
    return clone;
  }, [scene]);
  const localRef = useRef<THREE.Group>(null);

  return (
    <>
      <group
        position={position}
        rotation={rotation}
        scale={scale}
        ref={(node) => {
          localRef.current = node as THREE.Group;
          if (transformRef) {
            if (typeof transformRef === 'function') transformRef(node as THREE.Group);
            else (transformRef as any).current = node;
          }
        }}
        onClick={(e) => { e.stopPropagation(); if (onSelect) onSelect(); }}
      >
        <primitive object={cloned} />
      </group>
      {isSelected && localRef.current && (
        <TransformControls
          object={localRef.current}
          mode={transformMode}
          space="local"
          onDraggingChanged={(e) => onDraggingChanged && onDraggingChanged(e.value)}
          onChange={() => {
            if (localRef.current && onTransformChange) {
              const currentPos = localRef.current.position;
              // Add a small threshold to avoid excessive React state updates while rendering
              if (Math.abs(currentPos.x - position[0]) > 0.001 || Math.abs(currentPos.y - position[1]) > 0.001 || Math.abs(currentPos.z - position[2]) > 0.001) {
                onTransformChange({
                  x: currentPos.x,
                  y: currentPos.y,
                  z: currentPos.z,
                  rotationX: localRef.current.rotation.x,
                  rotationY: localRef.current.rotation.y,
                  rotationZ: localRef.current.rotation.z,
                  scale: (localRef.current.scale.x * 100) / (modelScale / 0.5)
                });
              }
            }
          }}
        />
      )}
    </>
  );
}

import { TransformControls } from '@react-three/drei';

import { AttachedAccessory } from '../../../../canopy/src/components/World/AttachedAccessory';

useGLTF.preload("/models/lobsters/BaseLobsterRigged.glb");
