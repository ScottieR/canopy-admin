import React, { useEffect, useMemo, useState } from 'react';
import { useGLTF } from '@react-three/drei';
import { createPortal } from '@react-three/fiber';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { resolveAssetUrl } from '../../utils/assetBaseUrl';

export function AttachedAccessory({
  path,
  accessoryData,
  clonedSceneRoot,
  transformRef
}: {
  path: string;
  accessoryData: any;
  clonedSceneRoot: THREE.Object3D;
  transformRef?: React.Ref<THREE.Group>;
}) {
  const glbPath = path.replace('.png', '.glb');
  const { scene } = useGLTF(resolveAssetUrl(glbPath));

  const clonedAcc = useMemo(() => {
    const clone = SkeletonUtils.clone(scene);
    clone.traverse(node => {
      node.userData = { ...node.userData, isAccessory: true };
      if (node instanceof THREE.Mesh) {
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach((mat: any) => {
          if (mat && mat.map) {
            mat.map.generateMipmaps = false;
            mat.map.minFilter = THREE.LinearFilter;
            mat.map.needsUpdate = true;
          }
          mat.transparent = false;
          mat.alphaTest = 0;
          mat.depthWrite = true;
          mat.needsUpdate = true;
        });
      }
    });

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

  const itemData = accessoryData?.items?.[path];
  if (!itemData) return null;

  const boneName = itemData.bone || 'Head';
  const [targetBone, setTargetBone] = useState<THREE.Object3D | null>(null);

  useEffect(() => {
    let found: THREE.Object3D | null = null;
    clonedSceneRoot.traverse((node: any) => {
      let normalizedBone = boneName.toLowerCase().replace(/[._-]/g, '');
      if (normalizedBone === 'handl') normalizedBone = 'lefthand';
      if (normalizedBone === 'handr') normalizedBone = 'righthand';
      const normalizedNodeName = node.name.toLowerCase().replace(/[._-]/g, '');
      if (node.isBone) {
        if (normalizedNodeName === normalizedBone) {
          found = node;
        } else if (!found && normalizedNodeName.includes(normalizedBone)) {
          found = node;
        }
      }
    });
    setTargetBone(found);
  }, [clonedSceneRoot, boneName]);

  if (!targetBone) return null;

  const offset = itemData.offset || [0, 0, 0];
  const rotation = itemData.rotation || [0, 0, 0];
  const scale = itemData.scale || 1;

  return createPortal(
    <group>
      <group position={offset as any} rotation={rotation as any} scale={[scale, scale, scale]} ref={transformRef}>
        <primitive object={clonedAcc} />
      </group>
    </group>,
    targetBone
  );
}
