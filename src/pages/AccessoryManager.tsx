import { useState, useEffect, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Save, EyeOff, Sparkles, X, Loader2, ArrowRight, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { AccessoryStudio } from '../components/AccessoryStudio';
import { AccessoryPlacementScene } from '../components/3d/AccessoryPlacementScene';
import { Canvas } from '@react-three/fiber';
import React from 'react';

const IMG_BASE = 'http://localhost:3001';

class ErrorBoundary extends React.Component<{ fallback: React.ReactNode, children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true };
  }
  componentDidCatch(error: any, errorInfo: any) {
    console.error("3D Canvas Error:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

interface AccessoriesData {
  items: Record<string, { 
    isVisible: boolean, 
    offset?: [number, number, number], 
    bone?: string,
    name?: string,
    description?: string,
    labels?: string[],
    type?: 'accessory' | 'decor' | 'both'
  }>;
  defaults: Record<string, string[]>;
  boneDefaults?: Record<string, { offset: [number, number, number], rotation: [number, number, number], scale: number }>;
}

const ARCHETYPES = [
  "Accountant", "Architect", "Artist", "Assistant", "Business Strategist",
  "Chef", "Coach", "Coder", "Custom", "Editor", "Educator", "Engineer",
  "Fashion Stylist", "Interior Designer", "Investment Manager", "Kids Coordinator",
  "Marketing Guru", "Media Advisor", "Musician", "Negotiator", "Relationship Guru",
  "Researcher", "STR Manager", "Strategist", "Therapist", "Trainer",
  "Travel Agent", "Tutor"
];

export default function AccessoryManager() {
  const [data, setData] = useState<AccessoriesData | null>(null);
  const [agents, setAgents] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"catalog" | "studio" | "anchors">("catalog");
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [editingBone, setEditingBone] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [animated, setAnimated] = useState(false);
  const [isEditingAccessory, setIsEditingAccessory] = useState(true);
  const [transformMode, setTransformMode] = useState<"translate" | "rotate" | "scale">("translate");
  const [searchTerm, setSearchTerm] = useState("");
  const [personaFilter, setPersonaFilter] = useState<string>("All");

  useEffect(() => {
    Promise.all([
      fetch('/api/accessories', { cache: 'no-store' }).then(r => r.json()),
      fetch('/api/agents').then(r => r.json())
    ]).then(([accData, agentsData]) => {
      if (!accData.items) accData.items = {};
      if (!accData.defaults) accData.defaults = {};
      if (!accData.boneDefaults) accData.boneDefaults = {};
      setData(accData as AccessoriesData);
      const agentsArray = Object.entries(agentsData).map(([name, data]: [string, any]) => ({
        id: name,
        name: name,
        accessories: data.accessories || [],
        ...data
      }));
      setAgents(agentsArray);
    }).catch(console.error);
  }, []);

  const handleSave = async (overrideData?: AccessoriesData | any) => {
    const dataToSave = overrideData || data;
    if (!dataToSave) return;
    setSaving(true);
    try {
      await fetch('/api/accessories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dataToSave)
      });
      setTimeout(() => setSaving(false), 500);
    } catch (e) {
      console.error("Failed to save accessories config:", e);
      setSaving(false);
    }
  };

  const toggleVisibility = (path: string) => {
    if (!data) return;
    const current = data.items[path]?.isVisible !== false;
    setData({
      ...data,
      items: { ...data.items, [path]: { ...data.items[path], isVisible: !current } }
    });
  };

  const updateOffset = (path: string, index: number, delta: number) => {
    if (!data) return;
    const currentOffset = [...(data.items[path]?.offset || [0, 0, 0])] as [number, number, number];
    currentOffset[index] = parseFloat((currentOffset[index] + delta).toFixed(3));
    setData({
      ...data,
      items: { ...data.items, [path]: { ...data.items[path], offset: currentOffset } }
    });
  };

  if (!data) {
    return <div className="p-10 flex justify-center text-textMuted">Loading Catalog...</div>;
  }

  const allAccessoryPaths = Object.keys(data.items);
  
  const filteredPaths = allAccessoryPaths.filter(path => {
    const item = data.items[path];
    const matchesSearch = !searchTerm || 
      item.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.labels?.some((l: string) => l.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesPersona = personaFilter === "All" || (data.defaults[personaFilter]?.includes(path));
    
    return matchesSearch && matchesPersona;
  });

  const agentsUsingSelected = editingPath ? agents.filter(a => a.accessories?.includes(editingPath)) : [];
  const agentsNotUsingSelected = editingPath ? agents.filter(a => !a.accessories?.includes(editingPath)) : [];

  const toggleAgentAccessory = async (agentId: string, add: boolean) => {
    if (!editingPath) return;
    const newAgents = [...agents];
    const agentIndex = newAgents.findIndex(a => a.id === agentId);
    if (agentIndex === -1) return;
    
    const agent = { ...newAgents[agentIndex] };
    if (!agent.accessories) agent.accessories = [];
    
    if (add && !agent.accessories.includes(editingPath)) {
      agent.accessories = [...agent.accessories, editingPath];
    } else if (!add && agent.accessories.includes(editingPath)) {
      agent.accessories = agent.accessories.filter((a: string) => a !== editingPath);
    }
    
    newAgents[agentIndex] = agent;
    setAgents(newAgents);
    
    try {
      const agentsObj = newAgents.reduce((acc, a) => {
        const { id, name, ...rest } = a;
        acc[id] = rest;
        return acc;
      }, {} as any);
      
      await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agentsObj)
      });
    } catch (e) {
      console.error("Failed to save agent accessories", e);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      
      <div className="flex justify-between items-end border-b border-outline-variant/30 pb-6 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-textMain mb-2">Agent Styling</h1>
          <p className="text-textMuted font-medium">Curate the master accessory set, generate 3D models, and build archetype loadouts.</p>
        </div>
        <button 
          onClick={handleSave}
          disabled={saving}
          className="bg-primary text-white font-bold h-10 px-6 rounded-xl flex items-center gap-2 hover:bg-primary/90 transition shadow-sm disabled:opacity-50"
        >
          <Save size={16} />
          {saving ? "Saving..." : "Publish Vault"}
        </button>
      </div>

      <div className="flex justify-between items-center mb-4">
        <div className="flex gap-4">
          <button 
            className={`px-4 py-2 font-bold rounded-xl transition ${activeTab === "catalog" ? "bg-white text-primary shadow-sm" : "text-textMuted hover:bg-white/50"}`}
            onClick={() => setActiveTab("catalog")}
          >
            All Accessories
          </button>
          <button 
            className={`px-4 py-2 font-bold rounded-xl flex items-center gap-2 transition ${activeTab === "studio" ? "bg-primary text-white shadow-sm" : "text-textMuted hover:bg-white/50"}`}
            onClick={() => setActiveTab("studio")}
          >
            <Sparkles size={16} />
            Generation Studio
          </button>
          <button 
            className={`px-4 py-2 font-bold rounded-xl transition ${activeTab === "anchors" ? "bg-white text-primary shadow-sm" : "text-textMuted hover:bg-white/50"}`}
            onClick={() => setActiveTab("anchors")}
          >
            Global Anchors
          </button>
        </div>

        {activeTab === "catalog" && (
          <div className="flex gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-textMuted" size={14} />
              <input 
                type="text" 
                placeholder="Search accessories..." 
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="bg-white border border-border rounded-xl pl-9 pr-4 py-2 text-xs focus:outline-none focus:border-primary w-64 shadow-sm"
              />
            </div>
            <select 
              value={personaFilter}
              onChange={e => setPersonaFilter(e.target.value)}
              className="bg-white border border-border rounded-xl px-4 py-2 text-xs font-bold text-textMain focus:outline-none focus:border-primary shadow-sm"
            >
              <option value="All">All Personas</option>
              {ARCHETYPES.map(arch => <option key={arch} value={arch}>{arch} Defaults</option>)}
            </select>
          </div>
        )}
      </div>

      {activeTab === "catalog" && (
        <div className="bg-surface/50 border border-outline-variant/30 rounded-3xl p-6 backdrop-blur-md shadow-sm min-h-[400px]">
          <div className="mb-6 flex justify-between items-center">
             <p className="text-sm font-medium text-textMuted">
               {personaFilter !== "All" ? `Showing defaults for ${personaFilter}` : "Showing all visible accessories."}
             </p>
             <div className="text-sm font-bold text-textMain bg-white px-3 py-1 rounded-full shadow-sm">
                Visible: {filteredPaths.filter(p => data.items[p]?.isVisible !== false).length} / {filteredPaths.length}
             </div>
          </div>
          
          {filteredPaths.length > 0 ? (
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-4">
               {filteredPaths.map(path => {
                  const isVisible = data.items[path]?.isVisible !== false;
                  return (
                    <div key={path} className="relative group">
                      <div 
                        onClick={() => setEditingPath(path)}
                        className={`relative aspect-square rounded-xl flex items-center justify-center cursor-pointer transition overflow-hidden ${isVisible ? "bg-white border-2 border-transparent shadow-sm hover:border-primary/20" : "bg-outline-variant/10 border-2 border-outline-variant/20 opacity-40 hover:opacity-100 mix-blend-luminosity hover:mix-blend-normal"}`}
                      >
                         <img src={path.startsWith('http') ? path : `${IMG_BASE}${path}`} alt="Accessory" className="w-[80%] h-[80%] object-contain" />
                         {!isVisible && <div className="absolute inset-0 flex items-center justify-center bg-black/5"><EyeOff size={16} className="text-textMain/50" /></div>}
                         <div className="absolute bottom-1 left-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 backdrop-blur-md rounded-md py-1 px-1.5 border border-border text-[8px] font-bold text-center truncate">
                            {data.items[path]?.name || "Unnamed"}
                         </div>
                      </div>
                    </div>
                  )
               })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-textMuted">
              <Search size={32} className="mb-2 opacity-20" />
              <p className="font-medium">No accessories match your search or filters.</p>
            </div>
          )}
        </div>
      )}

      {activeTab === "studio" && (
         <div className="bg-white border border-outline-variant/30 rounded-3xl p-6 shadow-sm max-w-2xl">
           <h3 className="font-bold text-lg mb-4 text-textMain">3D Accessory Generation</h3>
           <AccessoryStudio onAddAccessory={(path, metadata) => {
              setData(prev => {
                if (!prev) return prev;
                const newData = {
                  ...prev,
                  items: { 
                    ...prev.items, 
                    [path]: { 
                      isVisible: true, 
                      offset: [0,0,0],
                      name: metadata?.name || "New Accessory",
                      description: metadata?.description || "",
                      labels: ["New"]
                    } 
                  }
                };
                handleSave(newData);
                return newData;
              });
              alert("Added to catalog!");
           }} />
         </div>
      )}

      {activeTab === "anchors" && (
        <div className="bg-surface/50 border border-outline-variant/30 rounded-3xl p-6 backdrop-blur-md shadow-sm min-h-[400px]">
          <h3 className="font-bold text-lg mb-4 text-textMain">Bone Global Anchors</h3>
          <p className="text-sm text-textMuted mb-6 max-w-2xl">
            Set the default attachment point for each bone. When a new accessory is assigned to a bone, it will originate from this anchor point before applying its individual offset.
          </p>
          
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
             {["Head", "Spine", "Hand_R", "Hand_L", "Root"].map(bone => (
               <div 
                 key={bone}
                 onClick={() => setEditingBone(bone)}
                 className="bg-white border border-border rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer hover:border-primary/30 transition shadow-sm"
               >
                 <span className="font-bold text-textMain mb-1">{bone}</span>
                 <span className="text-[10px] text-textMuted">Click to edit</span>
               </div>
             ))}
          </div>
        </div>
      )}

      {/* Detail & 3D Placement Modal */}
      <AnimatePresence>
        {editingPath && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-8">
             <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="bg-white rounded-3xl overflow-hidden shadow-2xl w-full max-w-7xl h-[85vh] relative flex">
                <button onClick={() => { setEditingPath(null); handleSave(); }} className="absolute top-4 right-4 text-textMuted hover:text-textMain z-10 p-2"><X size={24}/></button>
                
                {/* Left Pane: Config & Usage */}
                <div className="w-1/3 bg-surface border-r border-outline-variant/30 p-8 flex flex-col overflow-y-auto custom-scrollbar">
                   <h3 className="font-bold text-2xl mb-1 text-textMain">Accessory Identity</h3>
                   <p className="text-[10px] text-textMuted mb-8 font-mono opacity-50 truncate">{editingPath}</p>
                   
                   <div className="space-y-4 mb-8">
                      <div>
                        <label className="text-[10px] font-bold text-textMuted uppercase mb-1 block tracking-widest">Asset Name</label>
                        <input 
                          type="text"
                          value={data.items[editingPath]?.name || ""}
                          onChange={(e) => {
                             setData({ ...data, items: { ...data.items, [editingPath]: { ...data.items[editingPath], name: e.target.value } } });
                          }}
                          className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-sm font-bold text-textMain focus:outline-none focus:border-primary shadow-sm"
                          placeholder="e.g. Tactical Visor"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-textMuted uppercase mb-1 block tracking-widest">Description</label>
                        <textarea 
                          value={data.items[editingPath]?.description || ""}
                          onChange={(e) => {
                             setData({ ...data, items: { ...data.items, [editingPath]: { ...data.items[editingPath], description: e.target.value } } });
                          }}
                          rows={2}
                          className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-xs text-textMain focus:outline-none focus:border-primary shadow-sm resize-none"
                          placeholder="What is this item for?"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-textMuted uppercase mb-1 block tracking-widest">Labels (Comma separated)</label>
                        <input 
                          key={editingPath + "-labels"}
                          type="text"
                          defaultValue={data.items[editingPath]?.labels?.join(', ') || ""}
                          onBlur={(e) => {
                             const labels = e.target.value.split(',').map(l => l.trim()).filter(l => l !== "");
                             setData({ ...data, items: { ...data.items, [editingPath]: { ...data.items[editingPath], labels } } });
                          }}
                          className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-xs text-textMain focus:outline-none focus:border-primary shadow-sm"
                          placeholder="Tech, Vision, Tactical..."
                        />
                      </div>
                   </div>

                    <AccessoryBakeAction 
                      path={editingPath} 
                      onBakeComplete={() => setVersion(v => v + 1)} 
                    />

                   <div className="space-y-6">
                      <div className="bg-white/50 rounded-2xl p-4 border border-border/50">
                        <label className="text-[10px] font-bold text-textMuted uppercase mb-3 block tracking-widest">Active On Agents</label>
                        <div className="flex flex-wrap gap-2">
                           {agentsUsingSelected.length > 0 ? (
                             agentsUsingSelected.map(agent => (
                               <div key={agent.id} className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-primary shadow-sm relative group cursor-pointer" onClick={() => toggleAgentAccessory(agent.id, false)}>
                                 <span className="text-xs font-bold text-primary">{agent.name}</span>
                                 <span className="opacity-0 group-hover:opacity-100 absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5 shadow transition-opacity"><X size={10} /></span>
                               </div>
                             ))
                           ) : (
                             <p className="text-xs text-textMuted italic">No agents currently wearing this accessory.</p>
                           )}
                        </div>
                        
                        <div className="mt-4 pt-4 border-t border-border/50">
                          <label className="text-[10px] font-bold text-textMuted uppercase mb-3 block tracking-widest">Add To Agent</label>
                          <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto custom-scrollbar pr-2">
                            {agentsNotUsingSelected.map(agent => (
                              <button 
                                key={agent.id} 
                                onClick={() => toggleAgentAccessory(agent.id, true)}
                                className="text-[10px] font-bold bg-black/5 hover:bg-black/10 text-textMuted hover:text-textMain px-2.5 py-1 rounded-md transition"
                              >
                                + {agent.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <label className="text-[10px] font-bold text-textMuted uppercase mb-2 block tracking-widest">Global Status</label>
                          <button 
                            onClick={() => toggleVisibility(editingPath)}
                            className={`w-full text-xs font-bold py-3 rounded-xl transition shadow-sm border ${data.items[editingPath]?.isVisible !== false ? 'bg-white border-border text-textMain hover:bg-black/5' : 'bg-primary/10 border-primary/20 text-primary hover:bg-primary/20'}`}
                          >
                            {data.items[editingPath]?.isVisible !== false ? "Visible in Catalog" : "Hidden in Catalog"}
                          </button>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-textMuted uppercase mb-2 block tracking-widest">Asset Type</label>
                          <select 
                             value={data.items[editingPath]?.type || "accessory"}
                             onChange={(e) => {
                               if (!data) return;
                               setData({
                                 ...data,
                                 items: { ...data.items, [editingPath]: { ...data.items[editingPath], type: e.target.value as any } }
                               });
                             }}
                             className="w-full bg-white border border-border rounded-xl px-3 py-2.5 text-xs font-bold text-textMain focus:outline-none focus:border-primary shadow-sm"
                          >
                             <option value="accessory">Wearable Accessory</option>
                             <option value="decor">Environment Decor</option>
                             <option value="both">Both</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-textMuted uppercase mb-2 block tracking-widest">Bone Link</label>
                          <select 
                             value={data.items[editingPath]?.bone || "Head"}
                             onChange={(e) => {
                               if (!data) return;
                               setData({
                                 ...data,
                                 items: { ...data.items, [editingPath]: { ...data.items[editingPath], bone: e.target.value } }
                               });
                             }}
                             className="w-full bg-white border border-border rounded-xl px-3 py-2.5 text-xs font-bold text-textMain focus:outline-none focus:border-primary shadow-sm"
                          >
                             <option value="Head">Head</option>
                             <option value="Spine">Spine (Back)</option>
                             <option value="Hand_R">Right Hand</option>
                             <option value="Hand_L">Left Hand</option>
                             <option value="Root">Root (Floor)</option>
                          </select>
                        </div>
                      </div>

                      <div className="bg-white/50 rounded-2xl p-5 border border-border/50">
                        <label className="text-[10px] font-bold text-textMuted uppercase mb-4 block tracking-widest">Precision Placement</label>
                        
                        <div className="flex items-center justify-between gap-4 mb-6 pt-2 border-t border-border/10 mt-2">
                           <label className="text-[10px] font-bold text-textMuted uppercase tracking-wider shrink-0">Scale</label>
                           <div className="flex items-center gap-3 flex-1">
                              <input 
                                type="range" min="0.01" max="1.5" step="0.01"
                                value={data.items[editingPath]?.scale || 0.25}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value);
                                  setData({ ...data, items: { ...data.items, [editingPath]: { ...data.items[editingPath], scale: val } } });
                                }}
                                className="flex-1 accent-primary h-1 bg-primary/10 rounded-lg appearance-none cursor-pointer"
                              />
                              <input 
                                type="number" step="0.01"
                                value={data.items[editingPath]?.scale || 0.25}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value);
                                  setData({ ...data, items: { ...data.items, [editingPath]: { ...data.items[editingPath], scale: val } } });
                                }}
                                className="w-16 bg-white border border-border/50 rounded-lg px-2 py-1.5 text-xs font-mono text-center focus:ring-1 focus:ring-primary outline-none"
                              />
                           </div>
                        </div>

                        <div className="space-y-6">
                           <div>
                             <label className="text-[10px] font-bold text-textMuted uppercase mb-2 block tracking-widest">Position (X, Y, Z)</label>
                             <div className="space-y-3">
                                {[
                                  { label: 'X (Left/Right)', index: 0 },
                                  { label: 'Y (Up/Down)', index: 1 },
                                  { label: 'Z (Forward/Back)', index: 2 }
                                ].map((axis) => (
                                  <div key={axis.index} className="flex items-center justify-between gap-4">
                                    <span className="text-[10px] font-medium text-textMuted w-24">{axis.label}</span>
                                    <div className="flex items-center gap-1">
                                      <button onClick={() => updateOffset(editingPath, axis.index, -0.5)} className="p-1.5 bg-white border border-border rounded-lg hover:bg-black/5 transition"><ChevronLeft size={12}/></button>
                                      <input 
                                        type="number" step="0.5"
                                        value={Number((data.items[editingPath]?.offset?.[axis.index] || 0).toFixed(2))}
                                        onChange={(e) => {
                                          const val = parseFloat(e.target.value);
                                          if (isNaN(val)) return;
                                          const currentOff = data.items[editingPath]?.offset || [0,0,0];
                                          const newOff = [...currentOff];
                                          newOff[axis.index] = val;
                                          setData({ ...data, items: { ...data.items, [editingPath]: { ...data.items[editingPath], offset: newOff as [number,number,number] } } });
                                        }}
                                        className="w-16 text-center font-mono text-[10px] font-bold bg-white border border-border rounded-lg py-1 shadow-inner outline-none focus:ring-1 focus:ring-primary"
                                      />
                                      <button onClick={() => updateOffset(editingPath, axis.index, 0.5)} className="p-1.5 bg-white border border-border rounded-lg hover:bg-black/5 transition"><ChevronRight size={12}/></button>
                                    </div>
                                  </div>
                                ))}
                             </div>
                           </div>

                           <div>
                             <label className="text-[10px] font-bold text-textMuted uppercase mb-2 block tracking-widest">Rotation (Degrees)</label>
                             <div className="space-y-3">
                                {[
                                  { label: 'Pitch (X)', index: 0 },
                                  { label: 'Yaw (Y)', index: 1 },
                                  { label: 'Roll (Z)', index: 2 }
                                ].map((axis) => {
                                  const rad = data.items[editingPath]?.rotation?.[axis.index] || 0;
                                  const deg = (rad * 180) / Math.PI;
                                  const updateRot = (deltaDeg: number) => {
                                    if (!data) return;
                                    const currentRot = data.items[editingPath]?.rotation || [0,0,0];
                                    const newRot = [...currentRot];
                                    newRot[axis.index] = currentRot[axis.index] + (deltaDeg * Math.PI) / 180;
                                    setData({ ...data, items: { ...data.items, [editingPath]: { ...data.items[editingPath], rotation: newRot } } });
                                  };
                                  return (
                                    <div key={axis.index} className="flex items-center justify-between gap-4">
                                      <span className="text-[10px] font-medium text-textMuted w-24">{axis.label}</span>
                                      <div className="flex items-center gap-1">
                                        <button onClick={() => updateRot(-5)} className="p-1.5 bg-white border border-border rounded-lg hover:bg-black/5 transition"><ChevronLeft size={12}/></button>
                                        <div className="relative">
                                          <input 
                                            type="number" step="5"
                                            value={Number(deg.toFixed(0))}
                                            onChange={(e) => {
                                              const val = parseFloat(e.target.value);
                                              if (isNaN(val)) return;
                                              const currentRot = data.items[editingPath]?.rotation || [0,0,0];
                                              const newRot = [...currentRot];
                                              newRot[axis.index] = (val * Math.PI) / 180;
                                              setData({ ...data, items: { ...data.items, [editingPath]: { ...data.items[editingPath], rotation: newRot } } });
                                            }}
                                            className="w-16 text-center font-mono text-[10px] font-bold bg-white border border-border rounded-lg py-1 shadow-inner outline-none focus:ring-1 focus:ring-primary"
                                          />
                                          <span className="absolute right-2 top-1.5 text-[10px] text-textMuted pointer-events-none">°</span>
                                        </div>
                                        <button onClick={() => updateRot(5)} className="p-1.5 bg-white border border-border rounded-lg hover:bg-black/5 transition"><ChevronRight size={12}/></button>
                                      </div>
                                    </div>
                                  );
                                })}
                             </div>
                           </div>
                        </div>
                      </div>

                      <button onClick={() => { setEditingPath(null); handleSave(); }} className="w-full bg-primary hover:bg-primary/90 text-white font-bold py-4 rounded-2xl transition-all shadow-lg hover:shadow-primary/20">
                        Save Changes
                      </button>
                   </div>
                </div>

                {/* Right Pane: 3D Scene */}
                <div className="flex-1 bg-[#F8F6F4] relative">
                   <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,0,0,0.03)_1px,transparent_1px)] bg-[length:24px_24px]" />
                   <ErrorBoundary key={editingPath} fallback={<div className="absolute inset-0 flex flex-col items-center justify-center p-10 text-center"><Sparkles size={32} className="text-primary mb-4 opacity-20" /><h4 className="text-textMain font-bold mb-2">3D Staging Offline</h4><p className="text-xs text-textMuted max-w-xs">The 3D preview encountered an error (likely a missing asset). You can still edit metadata, or try baking the accessory again.</p></div>}>
                     <Canvas shadows camera={{ position: [2.5, 2, 2.5], fov: 40 }} gl={{ shadowMapType: 1 }}>
                        <Suspense fallback={null}>
                          <AccessoryPlacementScene 
                            key={`${editingPath}-${version}`}
                            accessoryGlbPath={editingPath.startsWith('http') ? editingPath.replace('.png', '.glb') : `${IMG_BASE}${editingPath.replace('.png', '.glb')}?v=${version}`}
                            boneName={data.items[editingPath]?.bone || "Head"}
                            offset={data.items[editingPath]?.offset || [0, 0, 0]}
                            rotation={data.items[editingPath]?.rotation || [0, 0, 0]}
                            scale={data.items[editingPath]?.scale || 75}
                            animated={animated}
                            isEditingAccessory={isEditingAccessory}
                            transformMode={transformMode}
                            onOffsetChange={(newOffset) => {
                               setData(prev => {
                                 if (!prev) return prev;
                                 return {
                                   ...prev,
                                   items: { ...prev.items, [editingPath]: { ...prev.items[editingPath], offset: newOffset } }
                                 };
                               });
                            }}
                            onRotationChange={(newRotation) => {
                               setData(prev => {
                                 if (!prev) return prev;
                                 return {
                                   ...prev,
                                   items: { ...prev.items, [editingPath]: { ...prev.items[editingPath], rotation: newRotation } }
                                 };
                               });
                            }}
                            onScaleChange={(newScale) => {
                               setData(prev => {
                                 if (!prev) return prev;
                                 return {
                                   ...prev,
                                   items: { ...prev.items, [editingPath]: { ...prev.items[editingPath], scale: newScale } }
                                 };
                               });
                            }}
                          />
                        </Suspense>
                     </Canvas>
                   </ErrorBoundary>
                   <div className="absolute top-6 left-6 flex flex-col gap-3">
                     <button 
                       onClick={() => setIsEditingAccessory(!isEditingAccessory)}
                       className={`bg-white/80 backdrop-blur-xl border border-white px-4 py-2 rounded-2xl text-[10px] font-bold shadow-xl uppercase tracking-widest self-start transition-all ${isEditingAccessory ? 'text-primary ring-2 ring-primary/20' : 'text-textMuted hover:text-textMain'}`}
                     >
                       Lock Camera (Move Accessory): {isEditingAccessory ? 'ON' : 'OFF'}
                     </button>
                     
                     {isEditingAccessory && (
                       <div className="flex gap-1.5 bg-white/40 backdrop-blur-md p-1.5 rounded-2xl border border-white/50 shadow-lg">
                         {(["translate", "rotate", "scale"] as const).map(m => (
                           <button 
                             key={m}
                             onClick={() => setTransformMode(m)}
                             className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all border ${
                               transformMode === m ? "bg-primary text-white border-primary shadow-md" : "bg-white/80 text-textMuted border-white hover:bg-white"
                             }`}
                           >
                             {m}
                           </button>
                         ))}
                       </div>
                     )}
                   </div>

                   <div className="absolute top-6 right-16">
                     <button 
                       onClick={() => setAnimated(!animated)}
                       className={`bg-white/80 backdrop-blur-xl border border-white px-4 py-2 rounded-2xl text-[10px] font-bold shadow-xl uppercase tracking-widest transition-all ${animated ? 'text-green-600 ring-2 ring-green-600/20' : 'text-textMuted hover:text-textMain'}`}
                     >
                       Animation: {animated ? 'ON' : 'OFF'}
                     </button>
                   </div>
                   <div className="absolute bottom-6 right-6 bg-white/80 backdrop-blur-xl border border-white px-4 py-3 rounded-2xl text-[10px] font-mono text-textMain shadow-xl">
                      OFFSET: {data.items[editingPath]?.offset?.map(v => v.toFixed(3)).join(' , ') || "0.000 , 0.000 , 0.000"}
                   </div>
                </div>
             </motion.div>
          </motion.div>
        )}

        {editingBone && data && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-8">
             <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="bg-white rounded-3xl overflow-hidden shadow-2xl w-full max-w-7xl h-[85vh] relative flex">
                <button onClick={() => { setEditingBone(null); handleSave(); }} className="absolute top-4 right-4 text-textMuted hover:text-textMain z-10 p-2"><X size={24}/></button>
                
                {/* Left Pane: Config & Usage */}
                <div className="w-1/3 bg-surface border-r border-outline-variant/30 p-8 flex flex-col overflow-y-auto custom-scrollbar">
                   <h3 className="font-bold text-2xl mb-1 text-textMain">Global Anchor</h3>
                   <p className="text-[10px] text-textMuted mb-8 font-mono opacity-50 uppercase tracking-widest">{editingBone}</p>
                   
                   <div className="flex-1">
                      <div className="bg-white/50 rounded-2xl p-5 border border-border/50">
                        <label className="text-[10px] font-bold text-textMuted uppercase mb-4 block tracking-widest">Base Transform</label>

                           <div>
                             <label className="text-[10px] font-bold text-textMuted uppercase mb-2 block tracking-widest">Position (X, Y, Z)</label>
                             <div className="space-y-3">
                                {[
                                  { label: 'X (Left/Right)', index: 0 },
                                  { label: 'Y (Up/Down)', index: 1 },
                                  { label: 'Z (Forward/Back)', index: 2 }
                                ].map((axis) => {
                                  const getDefaultForBone = (b: string): [number,number,number] => {
                                    if (b.toLowerCase().includes('head')) return [0, 45, 10];
                                    if (b.toLowerCase().includes('hand_r')) return [-25, 10, 15];
                                    if (b.toLowerCase().includes('hand_l')) return [25, 10, 15];
                                    return [0, 0, 0];
                                  };
                                  const updateOffset = (delta: number) => {
                                    const current = data.boneDefaults?.[editingBone]?.offset || getDefaultForBone(editingBone);
                                    const newOff = [...current];
                                    newOff[axis.index] += delta;
                                    setData({ ...data, boneDefaults: { ...data.boneDefaults, [editingBone]: { ...(data.boneDefaults?.[editingBone] || {rotation:[0,0,0], scale:0.3}), offset: newOff as [number,number,number] } } });
                                  };
                                  return (
                                    <div key={axis.index} className="flex items-center justify-between gap-4">
                                      <span className="text-[10px] font-medium text-textMuted w-24">{axis.label}</span>
                                      <div className="flex items-center gap-1">
                                        <button onClick={() => updateOffset(-0.1)} className="p-1.5 bg-white border border-border rounded-lg hover:bg-black/5 transition"><ChevronLeft size={12}/></button>
                                        <input 
                                          type="number" step="0.1"
                                          value={Number((data.boneDefaults?.[editingBone]?.offset?.[axis.index] ?? getDefaultForBone(editingBone)[axis.index]).toFixed(2))}
                                          onChange={(e) => {
                                            const val = parseFloat(e.target.value);
                                            if (isNaN(val)) return;
                                            const current = data.boneDefaults?.[editingBone]?.offset || getDefaultForBone(editingBone);
                                            const newOff = [...current];
                                            newOff[axis.index] = val;
                                            setData({ ...data, boneDefaults: { ...data.boneDefaults, [editingBone]: { ...(data.boneDefaults?.[editingBone] || {rotation:[0,0,0], scale:0.3}), offset: newOff as [number,number,number] } } });
                                          }}
                                          className="w-16 text-center font-mono text-[10px] font-bold bg-white border border-border rounded-lg py-1 shadow-inner outline-none focus:ring-1 focus:ring-primary"
                                        />
                                        <button onClick={() => updateOffset(0.1)} className="p-1.5 bg-white border border-border rounded-lg hover:bg-black/5 transition"><ChevronRight size={12}/></button>
                                      </div>
                                    </div>
                                  );
                                })}
                             </div>
                         </div>
                      </div>
                      
                      <div className="mt-8">
                         <button onClick={() => { setEditingBone(null); handleSave(); }} className="w-full bg-primary hover:bg-primary/90 text-white font-bold py-4 rounded-2xl transition-all shadow-lg hover:shadow-primary/20">
                           Save Anchor
                         </button>
                      </div>
                   </div>
                </div>

                {/* Right Pane: 3D Scene */}
                <div className="flex-1 bg-[#F8F6F4] relative">
                   <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,0,0,0.03)_1px,transparent_1px)] bg-[length:24px_24px]" />
                   <ErrorBoundary key={editingBone} fallback={<div className="absolute inset-0 flex flex-col items-center justify-center p-10 text-center"><Sparkles size={32} className="text-primary mb-4 opacity-20" /><h4 className="text-textMain font-bold mb-2">3D Staging Offline</h4></div>}>
                     <Canvas shadows camera={{ position: [2.5, 2, 2.5], fov: 40 }} gl={{ shadowMapType: 1 }}>
                        <Suspense fallback={null}>
                          <AccessoryPlacementScene 
                            key={`anchor-${editingBone}`}
                            accessoryGlbPath={null}
                            boneName={editingBone}
                            offset={data.boneDefaults?.[editingBone]?.offset || [0, 0, 0]}
                            rotation={data.boneDefaults?.[editingBone]?.rotation || [0, 0, 0]}
                            scale={data.boneDefaults?.[editingBone]?.scale || 0.3}
                            animated={animated}
                            isAnchorMode={true}
                            isEditingAccessory={true}
                            transformMode={transformMode}
                            onOffsetChange={(newOffset) => {
                               setData(prev => {
                                 if (!prev) return prev;
                                 return {
                                   ...prev,
                                   boneDefaults: { ...prev.boneDefaults, [editingBone]: { ...(prev.boneDefaults?.[editingBone] || {rotation:[0,0,0], scale:0.3}), offset: newOffset } }
                                 };
                               });
                            }}
                            onRotationChange={(newRotation) => {
                               setData(prev => {
                                 if (!prev) return prev;
                                 return {
                                   ...prev,
                                   boneDefaults: { ...prev.boneDefaults, [editingBone]: { ...(prev.boneDefaults?.[editingBone] || {offset:[0,0,0], scale:0.3}), rotation: newRotation } }
                                 };
                               });
                            }}
                            onScaleChange={(newScale) => {
                               setData(prev => {
                                 if (!prev) return prev;
                                 return {
                                   ...prev,
                                   boneDefaults: { ...prev.boneDefaults, [editingBone]: { ...(prev.boneDefaults?.[editingBone] || {offset:[0,0,0], rotation:[0,0,0]}), scale: newScale } }
                                 };
                               });
                            }}
                          />
                        </Suspense>
                     </Canvas>
                   </ErrorBoundary>
                   {/* UI overlay removed for anchor view */}

                   <div className="absolute top-6 right-16">
                     <button 
                       onClick={() => setAnimated(!animated)}
                       className={`bg-white/80 backdrop-blur-xl border border-white px-4 py-2 rounded-2xl text-[10px] font-bold shadow-xl uppercase tracking-widest transition-all ${animated ? 'text-green-600 ring-2 ring-green-600/20' : 'text-textMuted hover:text-textMain'}`}
                     >
                       Animation: {animated ? 'ON' : 'OFF'}
                     </button>
                   </div>
                </div>
             </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function AccessoryBakeAction({ path, onBakeComplete }: { path: string, onBakeComplete: () => void }) {
  const [bakingState, setBakingState] = useState<"idle" | "starting" | "meshing" | "done" | "failed">("idle");
  const [progress, setProgress] = useState(0);
  const [glbExists, setGlbExists] = useState<boolean | null>(null);

  useEffect(() => {
    // Check if glb exists
    const glbUrl = path.startsWith('http') ? path.replace('.png', '.glb') : `${IMG_BASE}${path.replace('.png', '.glb')}`;
    fetch(glbUrl, { method: 'HEAD' })
      .then(res => {
         setGlbExists(res.ok);
         if (res.ok) setBakingState("done");
      })
      .catch(() => setGlbExists(false));
  }, [path]);

  const handleBake = async () => {
    setBakingState("starting");
    console.log("[BAKE] Initiating Meshy task for:", path);
    try {
      const imageUrl = `${path}`;
      const res = await fetch("/api/meshy-task", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      
      const taskId = data.taskId;
      console.log("[BAKE] Task started. Task ID:", taskId);
      setBakingState("meshing");
      
      // Poll
      const poll = setInterval(async () => {
        console.log("[BAKE] Polling status for task:", taskId);
        const checkRes = await fetch(`/api/meshy-check/${taskId}`);
        const checkData = await checkRes.json();
        if (checkData.progress) setProgress(checkData.progress);
        
        if (checkData.status === "SUCCEEDED") {
          clearInterval(poll);
          setProgress(100);
          setBakingState("done");
          setGlbExists(true);
          onBakeComplete();
        } else if (checkData.status === "FAILED") {
          clearInterval(poll);
          setBakingState("failed");
        }
      }, 3000);
      
    } catch (e: any) {
      console.error("[BAKE] Fatal error:", e);
      alert("Failed to bake to 3D: " + e.message);
      setBakingState("failed");
    }
  };

  return (
    <div className="bg-primary/5 border border-primary/20 rounded-2xl p-5 mb-4">
       <div className="flex items-center gap-2 mb-2">
         <Sparkles size={18} className="text-primary" />
         <h4 className="text-textMain font-bold text-sm">Meshy 3D Generation</h4>
       </div>
       {glbExists === true || bakingState === "done" ? (
         <p className="text-xs text-green-600 font-bold mb-4">✅ 3D Model Available</p>
       ) : (
         <>
            <p className="text-xs text-textMuted mb-4">No 3D asset found for this accessory. Bake it to enable dynamic attachment.</p>
            {bakingState === "meshing" && (
              <div className="mb-4">
                <div className="flex justify-between text-[10px] font-bold text-primary mb-1 uppercase tracking-wider">
                  <span>Meshy Baking</span>
                  <span>{progress}%</span>
                </div>
                <div className="w-full h-1.5 bg-primary/10 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    className="h-full bg-primary"
                  />
                </div>
              </div>
            )}
          </>
       )}
       
       <button 
          onClick={handleBake}
          disabled={bakingState !== "idle" && bakingState !== "failed" && bakingState !== "done"}
          className="bg-white text-black font-bold text-xs px-3 py-2.5 rounded-lg w-full flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 border border-border hover:bg-black/5 transition"
        >
          {bakingState === "starting" ? "Sending to Meshy..." :
           bakingState === "meshing" ? <><Loader2 size={12} className="animate-spin" /> Baking in Progress...</> :
           bakingState === "done" ? "Regenerate 3D Model" :
           <>Bake to 3D <ArrowRight size={12} /></>}
        </button>
    </div>
  );
}
