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
  modelPosition = [0, -0.23, 0]
}: {
  robeColor?: string,
  forceAnimation?: string,
  accessories?: string[],
  accessoryData?: any,
  animated?: boolean,
  transformRef?: React.Ref<THREE.Group>,
  transformAccessoryPath?: string,
  modelScale?: number,
  modelPosition?: [number, number, number]
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
    <group ref={groupRef} position={modelPosition} scale={modelScale} dispose={null}>
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
        
        // Simple deterministic random placement around the agent
        const seed = acc.length + i;
        const x = (Math.sin(seed * 1.1) * 3);
        const z = (Math.cos(seed * 1.3) * 3);
        
        const glbPath = acc.startsWith('http') ? acc.replace('.png', '.glb') : `http://localhost:3001${acc.startsWith('/') ? '' : '/'}${acc.replace('.png', '.glb')}`;
        
        // Use global offset if set, otherwise fallback to random base
        const bx = itemData?.offset ? itemData.offset[0] : x;
        const by = itemData?.offset ? itemData.offset[1] : 0;
        const bz = itemData?.offset ? itemData.offset[2] : z;
        
        const isEdited = acc === transformAccessoryPath;
        
        return (
          <SafeAccessoryBoundary key={`decor-${acc}-${i}`} name={glbPath}>
            <AdminDecorModel 
              url={glbPath} 
              position={[bx, by, bz]} 
              rotation={itemData?.rotation || [0, Math.sin(seed) * Math.PI, 0]} 
              scale={itemData?.scale || 0.5} 
              transformRef={isEdited ? transformRef : undefined}
            />
          </SafeAccessoryBoundary>
        );
      })}
    </group>
  );
}

function AdminDecorModel({ url, position, rotation, scale, transformRef }: { url: string, position: [number, number, number], rotation: [number, number, number], scale: number, transformRef?: React.Ref<THREE.Group> }) {
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  return (
    <group position={position} rotation={rotation} scale={scale} ref={transformRef}>
      <primitive object={cloned} />
    </group>
  );
}

import { AttachedAccessory } from '../../../../canopy/src/components/World/AttachedAccessory';

useGLTF.preload("/models/lobsters/BaseLobsterRigged.glb");
