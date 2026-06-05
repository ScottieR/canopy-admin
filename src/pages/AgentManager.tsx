import { useState, useEffect, useMemo, Component, Suspense } from 'react';
import type { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X, BookOpen, ToggleRight, ToggleLeft, Edit3, Check, Sparkles, Search } from 'lucide-react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, useGLTF, Environment } from '@react-three/drei';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { AdminGLBAgent } from '../components/3d/AdminGLBAgent';
import { AccessoryStudio } from '../components/AccessoryStudio';
import RAW_AGENT_TYPE_INFO from '../../../shared/agents.json';
import BookSearch from '../components/BookSearch';
import { resolveAssetUrl } from '../utils/assetBaseUrl';

const SWATCHES = [
  { name: 'Sage', color: '#BFCB75', robeColor: '#A5B55A', accentColor: '#E5EEAF', habitatColor: '#D8E38E' },
  { name: 'Ocean', color: '#5A9BB5', robeColor: '#4A859E', accentColor: '#96D0EA', habitatColor: '#6CAECA' },
  { name: 'Terra Cotta', color: '#D68971', robeColor: '#BF725A', accentColor: '#F5B8A4', habitatColor: '#E6A08A' },
  { name: 'Midnight', color: '#3A425A', robeColor: '#2C334A', accentColor: '#7A86A8', habitatColor: '#4A5573' },
  { name: 'Lavender', color: '#A592B5', robeColor: '#8C7A9E', accentColor: '#DCCCEB', habitatColor: '#BCAAD1' },
  { name: 'Slate', color: '#7E868C', robeColor: '#636C73', accentColor: '#B4BEC4', habitatColor: '#98A3AB' },
  { name: 'Canopy Core', color: '#218380', robeColor: '#176664', accentColor: '#4BC0BC', habitatColor: '#D2D6C8' },
  { name: 'Sand', color: '#D6C8A3', robeColor: '#BFB18A', accentColor: '#F5EAC4', habitatColor: '#E6DAAB' }
];

class ModelErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(_error: any) {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return <div className="flex flex-col items-center justify-center h-full text-textMuted font-medium p-6 text-center">
        <p className="font-bold text-lg mb-2">3D Asset Server Offline</p>
        <p className="text-sm">Make sure to run <code>node server.js</code> in the admin directory to load models.</p>
      </div>;
    }
    return this.props.children;
  }
}

function HabitatPreview({ habitatId, habitats }: { habitatId?: string | null, habitats: any[] }) {
  const habitat = habitats.find(h => h.id?.toString() === habitatId?.toString());
  if (!habitat || !habitat.path) return null;
  const { scene } = useGLTF(resolveAssetUrl(habitat.path)) as any;

  const clonedScene = useMemo(() => {
    const clone = SkeletonUtils.clone(scene);
    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());

    // 1. Same logic as TerrariumBase, but we multiply by 2 because AdminGLBAgent is scale 0.5 (2x the main app's 0.25)
    const maxDim = Math.max(size.x, size.z);
    const targetScale = maxDim > 0 ? (2.2 / maxDim) * 2 : 2;
    clone.scale.set(targetScale, targetScale, targetScale);
    clone.updateMatrixWorld(true);

    // 2. Procedural floor snapping (same as WorldScene)
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

  return <primitive object={clonedScene} />;
}

export default function AgentManager() {
  const [rawJSON, setRawJSON] = useState<Record<string, any>>(RAW_AGENT_TYPE_INFO);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<any>(null);
  const [editingOriginalId, setEditingOriginalId] = useState<string | null>(null);
  const [globalLibrary, setGlobalLibrary] = useState<any[]>([]);
  const [globalHabitats, setGlobalHabitats] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'identity' | 'accessories' | 'knowledge' | 'files'>('identity');
  const [globalAccessories, setGlobalAccessories] = useState<any>({ items: {} });
  const [accessorySearch, setAccessorySearch] = useState("");
  const [selectedDecor, setSelectedDecor] = useState<string | null>(null);
  const [isDraggingDecor, setIsDraggingDecor] = useState(false);
  const [showSuggested, setShowSuggested] = useState(false);
  const [decorTransformMode, setDecorTransformMode] = useState<'translate' | 'rotate' | 'scale'>('translate');

  useEffect(() => {
    fetch('/api/agents')
      .then(res => res.json())
      .then(data => setRawJSON(data))
      .catch(err => console.warn("Local API server not running, using static JSON import.", err));

    fetch('/api/library')
      .then(res => res.json())
      .then(data => setGlobalLibrary(Array.isArray(data) ? data : []))
      .catch(err => console.warn("Could not load global library.", err));

    fetch('/api/accessories', { cache: 'no-store' })
      .then(res => res.json())
      .then(data => setGlobalAccessories(data))
      .catch(err => console.warn("Could not load accessories library.", err));

    fetch('/api/habitats')
      .then(res => res.json())
      .then(data => setGlobalHabitats(Array.isArray(data) ? data : []))
      .catch(err => console.warn("Could not load habitats.", err));
  }, [isModalOpen]);

  const agents = Object.entries(rawJSON).map(([key, val]) => ({
    id: key,
    name: key,
    role: val.description,
    image: val.image || '',
    library: val.library || [],
    permissions: val.permissions || { calendar: true, files: true, web: true, email: false },
    status: val.suggest_in_onboarding ? 'Active' : 'Archived',
    suggest_in_onboarding: val.suggest_in_onboarding ?? true,
    recommended_isolated: val.recommended_isolated ?? false,
    color: val.color || '#218380',
    robeColor: val.robeColor || '#218380',
    accentColor: val.accentColor || '#cccccc',
    habitatColor: val.habitatColor || '#D2D6C8',
    habitatLabel: val.habitatLabel || 'The Void',
    habitatId: val.habitatId,
    manual_order: val.manual_order,
    popularity: val.popularity || 0,
    accessories: val.accessories || [],
    soul_template: val.soul_template || '',
    identity_template: val.identity_template || '',
    ...val
  })).sort((a: any, b: any) => {
    // Active / visible first
    if (a.suggest_in_onboarding && !b.suggest_in_onboarding) return -1;
    if (!a.suggest_in_onboarding && b.suggest_in_onboarding) return 1;

    const aOrder = a.manual_order;
    const bOrder = b.manual_order;
    if (aOrder != null && bOrder != null) return aOrder - bOrder;
    if (aOrder != null) return -1;
    if (bOrder != null) return 1;
    return (b.popularity || 0) - (a.popularity || 0);
  });

  const openModal = (agent: any = null) => {
    if (agent) {
      setEditingOriginalId(agent.id);
      setEditingAgent({ ...agent });
    } else {
      setEditingOriginalId(null);
      setEditingAgent({
        id: 'New Agent',
        role: '',
        suggest_in_onboarding: true,
        recommended_isolated: false,
        color: SWATCHES[0].color,
        robeColor: SWATCHES[0].robeColor,
        accentColor: SWATCHES[0].accentColor,
        habitatColor: SWATCHES[0].habitatColor,
        accessories: [],
        library: [],
        soul_template: '',
        identity_template: ''
      });
    }
    setActiveTab('identity');
    setAccessorySearch('');
    setShowSuggested(false);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setEditingAgent(null);
    setEditingOriginalId(null);
    setIsModalOpen(false);
  };

  const handleSave = async () => {
    if (!editingAgent) return;
    const newJSON = { ...rawJSON };

    // If they changed the ID, we need to delete the old key
    if (editingOriginalId && editingOriginalId !== editingAgent.id) {
      delete newJSON[editingOriginalId];
    }

    newJSON[editingAgent.id] = {
      ...(editingOriginalId ? newJSON[editingOriginalId] : {}),
      description: editingAgent.role,
      image: editingAgent.image,
      suggest_in_onboarding: editingAgent.suggest_in_onboarding,
      recommended_isolated: editingAgent.recommended_isolated,
      library: editingAgent.library,
      readwise_enabled: editingAgent.readwise_enabled,
      color: editingAgent.color,
      robeColor: editingAgent.robeColor,
      accentColor: editingAgent.accentColor,
      habitatColor: editingAgent.habitatColor,
      habitatLabel: editingAgent.habitatLabel,
      habitatId: editingAgent.habitatId,
      manual_order: editingAgent.manual_order,
      popularity: editingAgent.popularity,
      accessories: editingAgent.accessories,
      soul_template: editingAgent.soul_template,
      identity_template: editingAgent.identity_template,
      visual_identity: editingAgent.visual_identity
    };

    try {
      await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newJSON)
      });
      setRawJSON(newJSON);
      closeModal();
    } catch (err) {
      console.error("Failed to save via API, falling back to local state mock:", err);
      setRawJSON(newJSON);
      closeModal();
      alert("Note: Saved to UI only. Start 'node server.js' to persist changes to the shared/agents.json file!");
    }
  };

  return (
    <div className="space-y-6 flex flex-col h-full max-w-7xl mx-auto">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-textMain mb-2">Agent Templates</h1>
          <p className="text-textMuted font-medium">Manage global recommended personalities and their default settings.</p>
        </div>
        <button
          onClick={() => openModal()}
          className="flex items-center gap-2 bg-primary hover:bg-primaryHover text-white px-5 py-3 rounded-xl font-bold transition-all shadow-lg shadow-primary/30 active:scale-95"
        >
          <Plus size={20} className="stroke-[3px]" />
          Create Template
        </button>
      </div>

      {/* Agents Row List */}
      <div className="bg-white rounded-3xl border border-border shadow-sm overflow-hidden mt-6">
        <table className="w-full text-left">
          <thead className="bg-backgroundAlt border-b border-border">
            <tr>
              <th className="px-6 py-4 font-bold text-textMuted text-xs uppercase tracking-wider">Agent Role</th>
              <th className="px-6 py-4 font-bold text-textMuted text-xs uppercase tracking-wider">Accessories</th>
              <th className="px-6 py-4 font-bold text-textMuted text-xs uppercase tracking-wider">Visibility</th>
              <th className="px-6 py-4 font-bold text-textMuted text-xs uppercase tracking-wider text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {agents.map(agent => (
              <motion.tr
                key={agent.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="hover:bg-backgroundAlt/50 transition-colors group cursor-pointer"
                onClick={() => openModal(agent)}
              >
                <td className="px-6 py-4 flex items-center gap-4">
                  {/* 3D Preview Thumbnail */}
                  <div className="w-16 h-16 rounded-xl overflow-hidden relative border border-border shadow-inner" style={{ backgroundColor: agent.habitatColor || '#D6A3B9' }}>
                    {agent.image ? (
                      <img src={agent.image.startsWith('http') ? agent.image : `${IMG_BASE}${agent.image}`} alt={agent.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full" style={{ backgroundColor: agent.robeColor }}></div>
                    )}
                  </div>
                  <div>
                    <h3 className="font-extrabold text-textMain text-lg">{agent.id}</h3>
                    <p className="text-sm font-medium text-textMuted max-w-sm truncate" title={agent.role}>{agent.role || 'No description'}</p>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="flex gap-1.5 flex-wrap">
                    {agent.accessories && agent.accessories.length > 0 ? (
                      agent.accessories.map((acc: string, i: number) => (
                        <div key={i} className="w-8 h-8 rounded border border-border bg-white shadow-sm flex items-center justify-center p-0.5">
                          <img src={acc} className="w-full h-full object-contain" />
                        </div>
                      ))
                    ) : (
                      <span className="text-xs font-bold text-textMuted/50 uppercase tracking-wider">None</span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className={`inline-flex px-3 py-1 rounded-lg text-xs font-bold ${agent.suggest_in_onboarding ? 'bg-primary/10 text-primary' : 'bg-black/5 text-textMuted'}`}>
                    {agent.suggest_in_onboarding ? 'Visible' : 'Hidden'}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <button className="text-textMuted group-hover:text-primary transition-colors p-2 bg-transparent hover:bg-white rounded-lg border border-transparent group-hover:border-border shadow-sm opacity-0 group-hover:opacity-100 flex items-center gap-2 ml-auto">
                    <Edit3 size={16} className="stroke-[3px]" /> Edit
                  </button>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Editor Modal - SPLIT PANE STUDIO */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-textMain/40 backdrop-blur-sm"
              onClick={closeModal}
            />
            <motion.div
              initial={{ opacity: 0, y: 30, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              className="bg-background w-full max-w-7xl rounded-3xl shadow-2xl z-10 overflow-hidden flex h-[85vh]"
            >

              {/* LEFT PANE - THE 3D CANVAS */}
              <div className="flex-1 bg-backgroundAlt relative overflow-hidden flex flex-col border-r border-border shadow-xl z-20">
                <div className="absolute top-4 left-4 z-10 flex flex-col gap-3">
                  <div className="bg-white/80 backdrop-blur-sm px-4 py-2 rounded-xl border border-border shadow-sm">
                    <p className="font-bold text-textMain text-sm">3D Template Sandbox</p>
                  </div>
                  {selectedDecor && (
                    <div className="flex gap-1.5 bg-white/40 backdrop-blur-md p-1.5 rounded-2xl border border-white/50 shadow-lg">
                      {(["translate", "rotate", "scale"] as const).map(m => (
                        <button
                          key={m}
                          onClick={() => setDecorTransformMode(m)}
                          className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all border ${decorTransformMode === m ? "bg-primary text-white border-primary shadow-md" : "bg-white/80 text-textMuted border-white hover:bg-white"
                            }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex-1" style={{ backgroundColor: editingAgent?.color || '#F5E6D8' }}>
                  <ModelErrorBoundary>
                    <Canvas camera={{ position: [2.5, 2, 2.5], fov: 40 }} shadows>
                      <OrbitControls makeDefault enabled={!isDraggingDecor} />
                      <Suspense fallback={null}>
                        <Environment preset="city" />
                        <ambientLight intensity={0.5} />
                        <directionalLight position={[5, 5, 5]} intensity={1} castShadow />

                        {/* Habitat Preview */}
                        <HabitatPreview habitatId={editingAgent?.habitatId} habitats={globalHabitats} />

                        {/* Agent with fully attached 3D accessories */}
                        {(() => {
                          const habitat = globalHabitats.find(h => h.id?.toString() === editingAgent?.habitatId?.toString());
                          const placement = habitat?.placement;
                          const pos: [number, number, number] = placement ? [placement.x, placement.y, placement.z] : [0, -0.23, 0];
                          const rotY = placement?.rotationY || 0;

                          return (
                            <AdminGLBAgent
                              animated={false}
                              robeColor={editingAgent?.robeColor || '#888888'}
                              accessories={editingAgent?.accessories || []}
                              accessoryData={globalAccessories}
                              onSelectAccessory={(path) => window.open(`/accessories?edit=${encodeURIComponent(path)}`, '_blank')}
                              modelPosition={pos}
                              modelRotationY={rotY}
                              decorPoints={habitat?.decorPoints || []}
                              decorTransforms={editingAgent?.visual_identity?.decorTransforms || {}}
                              selectedDecorPath={selectedDecor}
                              transformMode={decorTransformMode}
                              onSelectDecor={setSelectedDecor}
                              onDraggingDecor={setIsDraggingDecor}
                              accessoryBehaviors={editingAgent?.visual_identity?.accessoryBehaviors || {}}
                              onDecorTransformChange={(path: string, transform: any) => {
                                setEditingAgent({
                                  ...editingAgent,
                                  visual_identity: {
                                    ...(editingAgent.visual_identity || {}),
                                    decorTransforms: {
                                      ...(editingAgent.visual_identity?.decorTransforms || {}),
                                      [path]: transform
                                    }
                                  }
                                });
                              }}
                            />
                          );
                        })()}
                      </Suspense>
                    </Canvas>
                  </ModelErrorBoundary>
                </div>
              </div>

              {/* RIGHT PANE - CONTROLS */}
              <div className="w-[500px] bg-white flex flex-col relative z-10">
                <div className="flex items-center justify-between p-5 border-b border-border bg-backgroundAlt/30">
                  <div className="flex-1">
                    <input
                      type="text"
                      value={editingAgent?.id || ''}
                      onChange={(e) => setEditingAgent({ ...editingAgent, id: e.target.value })}
                      className="text-xl font-bold text-textMain bg-transparent border-none outline-none w-full"
                      placeholder="Agent Role ID"
                    />
                  </div>
                  <button onClick={closeModal} className="text-textMuted hover:text-textMain p-1.5 rounded-full transition-colors">
                    <X size={20} className="stroke-[3px]" />
                  </button>
                </div>

                {/* TABS */}
                <div className="flex border-b border-border">
                  {['identity', 'accessories', 'files', 'knowledge'].map(tab => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab as any)}
                      className={`flex-1 py-3 text-sm font-bold border-b-2 transition-colors capitalize ${activeTab === tab ? 'border-primary text-primary' : 'border-transparent text-textMuted hover:text-textMain'}`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                <div className="p-6 overflow-y-auto flex-1 bg-white space-y-6 pb-20">

                  {activeTab === 'identity' && (
                    <div className="space-y-6 animate-fade-in">
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-textMain">Role Description</label>
                        <textarea
                          value={editingAgent?.role || ''}
                          onChange={(e) => setEditingAgent({ ...editingAgent, role: e.target.value })}
                          className="w-full bg-background border border-border rounded-xl px-4 py-3 text-textMain font-medium focus:outline-none resize-none h-24"
                          placeholder="A detailed description of what this agent does..."
                        />
                      </div>

                      <div className="space-y-4 pt-2 border-t border-border">
                        <div>
                          <h3 className="text-sm font-bold text-textMain mb-1">Color Swatch</h3>
                          <p className="text-xs text-textMuted">Select a curated palette for this archetype.</p>
                        </div>
                        <div className="grid grid-cols-4 gap-3">
                          {SWATCHES.map((swatch) => {
                            const isActive = editingAgent?.robeColor === swatch.robeColor && editingAgent?.color === swatch.color;
                            return (
                              <button
                                key={swatch.name}
                                onClick={() => setEditingAgent({
                                  ...editingAgent,
                                  color: swatch.color,
                                  robeColor: swatch.robeColor,
                                  accentColor: swatch.accentColor,
                                  habitatColor: swatch.habitatColor
                                })}
                                className={`flex flex-col items-center gap-2 p-2 rounded-xl border-2 transition-all ${isActive ? 'border-primary bg-primary/5 shadow-sm' : 'border-border hover:border-black/20 hover:bg-black/5'}`}
                              >
                                <div className="w-12 h-12 rounded-full shadow-inner overflow-hidden flex relative">
                                  <div className="w-1/2 h-full" style={{ backgroundColor: swatch.robeColor }}></div>
                                  <div className="w-1/2 h-full" style={{ backgroundColor: swatch.color }}></div>
                                  {isActive && (
                                    <div className="absolute inset-0 bg-black/10 flex items-center justify-center">
                                      <Check className="text-white" size={16} strokeWidth={4} />
                                    </div>
                                  )}
                                </div>
                                <span className="text-[10px] font-bold text-textMuted uppercase tracking-wider">{swatch.name}</span>
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      <div className="space-y-4 pt-4 border-t border-border">
                        <div>
                          <h3 className="text-sm font-bold text-textMain mb-1">Base Habitat</h3>
                          <p className="text-xs text-textMuted">Select the 3D environment layout.</p>
                        </div>
                        <select
                          value={editingAgent?.habitatId || ''}
                          onChange={(e) => {
                            const selected = globalHabitats.find(h => h.id.toString() === e.target.value);
                            setEditingAgent({
                              ...editingAgent,
                              habitatId: selected ? selected.id : null,
                              habitatLabel: selected ? selected.name : ''
                            });
                          }}
                          className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm font-bold text-textMain focus:outline-none"
                        >
                          <option value="">Select Habitat...</option>
                          {globalHabitats.map(h => (
                            <option key={h.id} value={h.id}>{h.name}</option>
                          ))}
                        </select>
                      </div>

                      <div className="flex gap-4 pt-4 border-t border-border">
                        <div className="flex-1 flex items-center justify-between bg-primary/5 border border-primary/20 p-4 rounded-xl">
                          <div>
                            <h4 className="text-textMain font-bold text-sm">Onboarding</h4>
                            <p className="text-textMuted text-xs font-medium mt-1">Suggest role.</p>
                          </div>
                          <button onClick={() => setEditingAgent({ ...editingAgent, suggest_in_onboarding: !editingAgent.suggest_in_onboarding })} className={`transition-colors ${editingAgent?.suggest_in_onboarding ? 'text-primary' : 'text-textMuted'}`}>
                            {editingAgent?.suggest_in_onboarding ? <ToggleRight size={36} /> : <ToggleLeft size={36} />}
                          </button>
                        </div>

                        <div className="flex-1 flex items-center justify-between bg-[#D4A04A]/10 border border-[#D4A04A]/30 p-4 rounded-xl">
                          <div>
                            <h4 className="text-textMain font-bold text-sm">Isolation</h4>
                            <p className="text-textMuted text-xs font-medium mt-1">Sandbox by default.</p>
                          </div>
                          <button onClick={() => setEditingAgent({ ...editingAgent, recommended_isolated: !editingAgent.recommended_isolated })} className={`transition-colors ${editingAgent?.recommended_isolated ? 'text-[#D4A04A]' : 'text-textMuted'}`}>
                            {editingAgent?.recommended_isolated ? <ToggleRight size={36} /> : <ToggleLeft size={36} />}
                          </button>
                        </div>

                        <div className="w-1/3 flex items-center justify-between bg-primary/5 border border-primary/20 p-4 rounded-xl">
                          <div>
                            <h4 className="text-textMain font-bold text-sm">Order</h4>
                            <p className="text-textMuted text-xs font-medium mt-1">Display priority.</p>
                          </div>
                          <input
                            type="number"
                            min="1"
                            value={editingAgent?.manual_order ?? ''}
                            onChange={(e) => setEditingAgent({ ...editingAgent, manual_order: e.target.value ? parseInt(e.target.value, 10) : undefined })}
                            className="w-16 bg-white border border-border rounded-lg px-2 py-1 text-sm font-bold text-center focus:outline-none"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === 'accessories' && (
                    <div className="space-y-6 animate-fade-in">
                      {/* AI Studio */}
                      <AccessoryStudio onAddAccessory={(path) => {
                        const ex = editingAgent?.accessories || [];
                        if (!ex.includes(path)) {
                          setEditingAgent({ ...editingAgent, accessories: [...ex, path] });
                        }
                      }} />

                      {/* Currently Selected Accessories */}
                      <div className="pt-4 border-t border-border">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-textMain font-bold text-sm">Applied Accessories</h4>
                          <span className="text-xs font-bold text-textMuted bg-background border border-border px-2 py-0.5 rounded-full">
                            {(editingAgent?.accessories || []).length} Applied
                          </span>
                        </div>
                        {(editingAgent?.accessories || []).length > 0 ? (
                          <div className="flex flex-col gap-2">
                            {(editingAgent?.accessories || []).map((path: string) => {
                              const item = globalAccessories.items?.[path] || {};
                              const behaviors = editingAgent?.visual_identity?.accessoryBehaviors || {};
                              const currentBehavior = behaviors[path] || item.type || 'accessory';

                              return (
                                <div key={path} className="flex items-center gap-3 p-2 bg-background border border-border rounded-xl">
                                  <div className="w-12 h-12 bg-white rounded-lg flex-shrink-0 flex items-center justify-center p-1 border border-border/50">
                                    <img src={path.startsWith('http') ? path : `${IMG_BASE}${path}`} alt="accessory" className="w-full h-full object-contain" />
                                  </div>
                                  <div className="flex-1">
                                    <p className="text-sm font-bold text-textMain leading-tight">{item.name || path.split('/').pop()}</p>
                                    <p className="text-[10px] text-textMuted uppercase tracking-wider mt-0.5 font-bold">
                                      {item.type === 'both' ? 'Hybrid Item' : (item.type === 'decor' ? 'Habitat Decor' : 'Wearable')}
                                    </p>
                                  </div>

                                  {item.type === 'both' && (
                                    <div className="flex items-center bg-backgroundAlt rounded-lg p-1 mr-2 border border-border/50">
                                      <button
                                        onClick={() => {
                                          const newBehaviors = { ...behaviors, [path]: 'accessory' };
                                          setEditingAgent({
                                            ...editingAgent,
                                            visual_identity: { ...editingAgent?.visual_identity, accessoryBehaviors: newBehaviors }
                                          });
                                        }}
                                        className={`px-3 py-1 text-[10px] font-bold rounded-md transition-colors ${currentBehavior !== 'decor' ? 'bg-primary text-white shadow-sm' : 'text-textMuted hover:bg-black/5'}`}
                                      >
                                        Wear
                                      </button>
                                      <button
                                        onClick={() => {
                                          const newBehaviors = { ...behaviors, [path]: 'decor' };
                                          setEditingAgent({
                                            ...editingAgent,
                                            visual_identity: { ...editingAgent?.visual_identity, accessoryBehaviors: newBehaviors }
                                          });
                                        }}
                                        className={`px-3 py-1 text-[10px] font-bold rounded-md transition-colors ${currentBehavior === 'decor' ? 'bg-primary text-white shadow-sm' : 'text-textMuted hover:bg-black/5'}`}
                                      >
                                        Place
                                      </button>
                                    </div>
                                  )}

                                  <button
                                    onClick={() => {
                                      const current = editingAgent?.accessories || [];
                                      setEditingAgent({ ...editingAgent, accessories: current.filter((p: string) => p !== path) });
                                    }}
                                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 hover:text-red-500 text-textMuted transition-colors flex-shrink-0"
                                  >
                                    <X size={16} strokeWidth={3} />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="w-full border-2 border-dashed border-border rounded-xl p-4 text-center">
                            <p className="text-xs font-bold text-textMuted">No accessories applied yet.</p>
                          </div>
                        )}
                      </div>

                      {/* Curated/Global List */}
                      <div className="pt-4 border-t border-border">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-textMain font-bold text-sm">Global Accessory Collection</h4>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setShowSuggested(!showSuggested)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${showSuggested ? 'bg-primary text-white' : 'bg-primary/10 text-primary hover:bg-primary/20'}`}
                            >
                              <Sparkles size={12} className="inline mr-1" />
                              Suggested
                            </button>
                            <div className="relative">
                              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-textMuted" />
                              <input
                                type="text"
                                placeholder="Search accessories..."
                                value={accessorySearch}
                                onChange={(e) => setAccessorySearch(e.target.value)}
                                className="pl-8 pr-3 py-1.5 rounded-lg border border-border text-xs focus:outline-none focus:border-primary w-48"
                              />
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-4 gap-2 max-h-[300px] overflow-y-auto pr-2">
                          {Object.entries(globalAccessories.items || {})
                            .filter(([path, item]: [string, any]) => {
                              if (item.isVisible === false) return false;

                              if (editingAgent?.accessories?.includes(path)) return false;

                              let matchesSearch = true;
                              if (accessorySearch) {
                                const searchLower = accessorySearch.toLowerCase();
                                matchesSearch =
                                  path.toLowerCase().includes(searchLower) ||
                                  (item.name && item.name.toLowerCase().includes(searchLower)) ||
                                  (item.labels && item.labels.some((l: string) => l.toLowerCase().includes(searchLower)));
                              }

                              let matchesSuggested = true;
                              if (showSuggested && editingAgent?.role) {
                                const roleLower = editingAgent.role.toLowerCase();
                                const hasMatchingLabel = item.labels && item.labels.some((l: string) => roleLower.includes(l.toLowerCase()));
                                const isAttached = editingAgent?.accessories?.includes(path);
                                matchesSuggested = hasMatchingLabel || isAttached;
                              }

                              return matchesSearch && matchesSuggested;
                            })
                            .map(([path, item]) => {
                              const isAttached = editingAgent?.accessories?.includes(path);
                              return (
                                <button
                                  key={path}
                                  title={(item as any).name || path}
                                  onClick={() => {
                                    const current = editingAgent?.accessories || [];
                                    if (isAttached) {
                                      setEditingAgent({ ...editingAgent, accessories: current.filter((p: string) => p !== path) });
                                    } else {
                                      setEditingAgent({ ...editingAgent, accessories: [...current, path] });
                                    }
                                  }}
                                  className={`aspect-square rounded-lg border-2 overflow-hidden transition-all duration-200 relative group ${isAttached ? 'border-primary ring-2 ring-primary/20 shadow-md bg-primary/5 z-10' : 'border-border bg-white hover:border-black/20'}`}
                                >
                                  <img src={path.startsWith('http') ? path : `${IMG_BASE}${path}`} alt="accessory" className="w-full h-full object-contain p-1" />
                                  {isAttached && <span className="absolute bottom-1 right-1 w-2.5 h-2.5 rounded-full bg-primary ring-2 ring-white" />}

                                  {/* Type Badge */}
                                  {(item as any).type && (
                                    <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/50 text-white text-[8px] font-bold uppercase tracking-wider backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity">
                                      {(item as any).type}
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === 'files' && (
                    <div className="space-y-6 animate-fade-in">
                      <div className="space-y-2">
                        <div>
                          <h3 className="text-sm font-bold text-textMain">Identity Prompt (<code className="text-primary text-xs">identity.md</code>)</h3>
                          <p className="text-xs text-textMuted">The core personality injected directly into the system prompt.</p>
                        </div>
                        <textarea
                          value={editingAgent?.identity_template || ''}
                          onChange={(e) => setEditingAgent({ ...editingAgent, identity_template: e.target.value })}
                          className="w-full bg-background border border-border rounded-xl p-4 text-textMain font-mono text-xs focus:outline-none min-h-[150px] resize-y"
                          placeholder="You are a helpful assistant..."
                        />
                      </div>

                      <div className="space-y-2 pt-4 border-t border-border">
                        <div>
                          <h3 className="text-sm font-bold text-textMain">Soul Prompt (<code className="text-primary text-xs">soul.md</code>)</h3>
                          <p className="text-xs text-textMuted">The inner monologue and advanced tool-use reasoning instructions.</p>
                        </div>
                        <textarea
                          value={editingAgent?.soul_template || ''}
                          onChange={(e) => setEditingAgent({ ...editingAgent, soul_template: e.target.value })}
                          className="w-full bg-background border border-border rounded-xl p-4 text-textMain font-mono text-xs focus:outline-none min-h-[150px] resize-y"
                          placeholder="Internal reasoning instructions..."
                        />
                      </div>
                    </div>
                  )}

                  {activeTab === 'knowledge' && (
                    <div className="space-y-8 animate-fade-in">
                      <div className="space-y-3">
                        <label className="text-sm font-bold text-textMain">Search & Add Books to Knowledge Base</label>
                        <p className="text-xs text-textMuted mb-2">Books added here will be saved to the global library and automatically tagged for {editingAgent?.id}.</p>
                        <BookSearch onAdd={async (newBooks) => {
                          const customizedBooks = newBooks.map(b => ({
                            ...b,
                            recommendedAgents: [editingAgent.id]
                          }));

                          const existingKeys = new Set(globalLibrary.map(b => b.key));
                          const toAdd = customizedBooks.filter(b => !existingKeys.has(b.key));

                          const updatedLibrary = globalLibrary.map(b => {
                            if (newBooks.some(nb => nb.key === b.key)) {
                              if (!b.recommendedAgents?.includes(editingAgent.id)) {
                                return { ...b, recommendedAgents: [...(b.recommendedAgents || []), editingAgent.id] };
                              }
                            }
                            return b;
                          });

                          const finalLibrary = [...updatedLibrary, ...toAdd];

                          try {
                            await fetch('/api/library', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify(finalLibrary)
                            });
                            setGlobalLibrary(finalLibrary);
                          } catch (err) {
                            console.error("Failed to save library updates", err);
                          }
                        }} />
                      </div>

                      <div className="space-y-3">
                        <label className="text-sm font-bold text-textMain">Currently Assigned Books ({globalLibrary.filter(b => b.recommendedAgents?.includes(editingAgent?.id)).length})</label>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {globalLibrary.map(book => {
                            const isAssigned = book.recommendedAgents?.includes(editingAgent?.id);
                            if (!isAssigned) return null;

                            return (
                              <div key={book.key} className="p-4 border border-primary bg-primary/5 rounded-xl flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-14 bg-background border border-border rounded overflow-hidden flex-shrink-0">
                                    {book.coverUrl ? <img src={book.coverUrl} className="w-full h-full object-cover" /> : <BookOpen size={16} className="m-auto mt-4 text-textMuted/40" />}
                                  </div>
                                  <div>
                                    <p className="font-bold text-textMain text-sm truncate max-w-[150px]" title={book.title}>{book.title}</p>
                                    <p className="text-xs font-medium text-textMuted">{book.author}</p>
                                  </div>
                                </div>
                                <button onClick={async () => {
                                  const updatedLibrary = globalLibrary.map(b => {
                                    if (b.key === book.key) {
                                      return { ...b, recommendedAgents: b.recommendedAgents.filter((a: string) => a !== editingAgent.id) };
                                    }
                                    return b;
                                  });
                                  setGlobalLibrary(updatedLibrary);
                                  try {
                                    await fetch('/api/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedLibrary) });
                                  } catch (e) { console.error(e); }
                                }} className="text-textMuted hover:text-[#D96C3B] p-2" title="Unassign from agent">
                                  <X size={16} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                </div>

                <div className="absolute bottom-0 left-0 right-0 p-5 border-t border-border bg-white flex justify-end gap-3 z-20">
                  <button onClick={closeModal} className="px-5 py-2.5 rounded-xl text-sm font-bold text-textMuted hover:bg-backgroundAlt hover:shadow-sm border border-transparent">Cancel</button>
                  <button onClick={handleSave} className="px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-primary hover:bg-primaryHover shadow-lg shadow-primary/20 active:scale-95">Save Template</button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
