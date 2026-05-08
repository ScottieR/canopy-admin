import React, { useEffect, useRef, useMemo, Component, ReactNode } from "react";
import { useGLTF, useAnimations } from "@react-three/drei";
import * as THREE from "three";
import { SkeletonUtils } from "three-stdlib";

class SafeAccessoryBoundary extends Component<{children: ReactNode, name: string}, {hasError: boolean}> {
  constructor(props: {children: ReactNode, name: string}) {
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
  forceAnimation = "Long_Breathe_and_Look_Around",
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
  onSelectDecor = undefined,
  onDecorTransformChange = undefined
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
  decorPoints?: {x: number, y: number, z: number}[],
  selectedDecorPath?: string | null,
  onSelectDecor?: (path: string) => void,
  onDecorTransformChange?: (path: string, transform: any) => void
}) {
  const groupRef = useRef<THREE.Group>(null);

  // Load the universal rigged body.
  const { scene, animations } = useGLTF("/models/lobsters/BaseLobsterRigged.glb");

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

    const idleAnim = names.find(n => n === "Long_Breathe_and_Look_Around") || names[0];
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

    const action = actions[activeActionName];

    if (action) {
      if (animated) {
        globalAnimationStagger += 0.1;
        action.reset().fadeIn(0.5).play();
        action.time = globalAnimationStagger % action.getClip().duration;
      } else {
        action.stop();
      }
    }

    return () => { if (action) action.fadeOut(0.5); };
  }, [actions, names, forceAnimation]);

  return (
    <group ref={groupRef} position={modelPosition} rotation={[0, modelRotationY, 0]} scale={modelScale} dispose={null}>
      <primitive object={clonedScene} />
      {accessories.map((acc, i) => {
        const itemData = accessoryData?.items?.[acc];
        if (itemData?.type === 'decor') return null; // Don't attach strict decor to the agent body!
        
        console.log(`[AdminGLBAgent] Rendering accessory: ${acc}`, { scale: itemData?.scale, offset: itemData?.offset });
        const isEdited = acc === transformAccessoryPath;
        return (
          <SafeAccessoryBoundary key={`${acc}-${i}`} name={acc}>
            <AttachedAccessory 
              path={acc} 
              accessoryData={accessoryData} 
              clonedSceneRoot={clonedScene} 
              transformRef={isEdited ? transformRef : undefined}
            />
          </SafeAccessoryBoundary>
        );
      })}
      
      {/* Render Decor Items */}
      {accessories.map((acc, i) => {
        const itemData = accessoryData?.items?.[acc];
        if (itemData?.type !== 'decor') return null;
        
        const glbPath = acc.startsWith('http') ? acc.replace('.png', '.glb') : `http://localhost:3001${acc.startsWith('/') ? '' : '/'}${acc.replace('.png', '.glb')}`;
        const transform = decorTransforms[acc];
        
        // 1. Saved transform (prioritized)
        // 2. Global itemData offset
        // 3. Procedural valid decor point (seeded)
        // 4. Fallback random float
        let bx, by, bz;
        if (transform) {
          bx = transform.x; by = transform.y; bz = transform.z;
        } else if (itemData?.offset) {
          bx = itemData.offset[0]; by = itemData.offset[1]; bz = itemData.offset[2];
        } else if (decorPoints && decorPoints.length > 0) {
          const point = decorPoints[(acc.length + i) % decorPoints.length];
          bx = point.x; by = point.y; bz = point.z;
        } else {
          const seed = acc.length + i;
          bx = (Math.sin(seed * 1.1) * 3);
          by = 0;
          bz = (Math.cos(seed * 1.3) * 3);
        }
        
        const rotation = transform ? [transform.rotationX || 0, transform.rotationY || 0, transform.rotationZ || 0] : (itemData?.rotation || [0, Math.sin(acc.length + i) * Math.PI, 0]);
        const scale = transform?.scale || itemData?.scale || 75;
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
              transformRef={isEdited ? transformRef : undefined}
              isSelected={isSelectedDecor}
              onSelect={() => onSelectDecor && onSelectDecor(acc)}
              onTransformChange={(t) => onDecorTransformChange && onDecorTransformChange(acc, t)}
            />
          </SafeAccessoryBoundary>
        );
      })}
    </group>
  );
}

function AdminDecorModel({ url, path, position, rotation, scale, transformRef, isSelected, onSelect, onTransformChange }: { url: string, path: string, position: [number, number, number], rotation: [number, number, number], scale: number, transformRef?: React.Ref<THREE.Group>, isSelected?: boolean, onSelect?: () => void, onTransformChange?: (t: any) => void }) {
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
          mode="translate"
          space="local"
          onMouseUp={() => {
            if (localRef.current && onTransformChange) {
              onTransformChange({
                x: localRef.current.position.x,
                y: localRef.current.position.y,
                z: localRef.current.position.z,
                rotationX: localRef.current.rotation.x,
                rotationY: localRef.current.rotation.y,
                rotationZ: localRef.current.rotation.z,
                scale: localRef.current.scale.x
              });
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
