import { useEffect, useRef, useMemo } from "react";
import { useGLTF, useAnimations } from "@react-three/drei";
import * as THREE from "three";
import { SkeletonUtils } from "three-stdlib";

// Maintain a module-level stagger so each agent drops into the scene exactly 100ms out of phase
let globalAnimationStagger = 0;

export function AdminGLBAgent({ 
  robeColor, 
  forceAnimation = "Long_Breathe_and_Look_Around" 
}: { 
  robeColor?: string, 
  forceAnimation?: string 
}) {
  const groupRef = useRef<THREE.Group>(null);
  
  // Load the universal rigged body.
  const { scene, animations } = useGLTF("http://localhost:3001/agents/BaseLobsterRigged.glb");

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
      globalAnimationStagger += 0.1;
      action.reset().fadeIn(0.5).play();
      action.time = globalAnimationStagger % action.getClip().duration;
    }

    return () => { if (action) action.fadeOut(0.5); };
  }, [actions, names, forceAnimation]);

  return (
    <group ref={groupRef} position={[0, -0.23, 0]} scale={0.5} dispose={null}>
      <primitive object={clonedScene} />
    </group>
  );
}

useGLTF.preload("http://localhost:3001/agents/BaseLobsterRigged.glb");
