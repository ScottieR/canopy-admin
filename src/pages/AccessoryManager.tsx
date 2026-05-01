import { useState, useEffect, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Save, EyeOff, Sparkles, X, Loader2, ArrowRight } from 'lucide-react';
import { AccessoryStudio } from '../components/AccessoryStudio';
import { AccessoryPlacementScene } from '../components/3d/AccessoryPlacementScene';
import { Canvas } from '@react-three/fiber';

interface AccessoriesData {
  items: Record<string, { isVisible: boolean, offset?: [number, number, number], bone?: string }>;
  defaults: Record<string, string[]>;
}

const ARCHETYPES = ["Coder", "Strategist", "Accountant", "Assistant", "Researcher", "Tutor"];

export default function AccessoryManager() {
  const [data, setData] = useState<AccessoriesData | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"catalog" | "defaults" | "studio">("catalog");
  const [selectedArchetype, setSelectedArchetype] = useState(ARCHETYPES[0]);
  const [editingPath, setEditingPath] = useState<string | null>(null);

  useEffect(() => {
    fetch('http://localhost:3001/api/accessories')
      .then(r => r.json())
      .then(d => {
         if (!d.items) d.items = {};
         if (!d.defaults) d.defaults = {};
         setData(d as AccessoriesData);
      })
      .catch(console.error);
  }, []);

  const handleSave = async () => {
    if (!data) return;
    setSaving(true);
    try {
      await fetch('http://localhost:3001/api/accessories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
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

  const toggleDefault = (path: string) => {
    if (!data) return;
    const roleDefaults = data.defaults[selectedArchetype] || [];
    const isDefault = roleDefaults.includes(path);
    
    let newDefaults;
    if (isDefault) {
      newDefaults = roleDefaults.filter(p => p !== path);
    } else {
      newDefaults = [...roleDefaults, path];
    }
    
    setData({
      ...data,
      defaults: { ...data.defaults, [selectedArchetype]: newDefaults }
    });
  };
  
  if (!data) {
    return <div className="p-10 flex justify-center text-textMuted">Loading Catalog...</div>;
  }

  const allAccessoryPaths = Object.keys(data.items);

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

      <div className="flex gap-4 mb-4">
        <button 
          className={`px-4 py-2 font-bold rounded-xl transition ${activeTab === "catalog" ? "bg-white text-primary shadow-sm" : "text-textMuted hover:bg-white/50"}`}
          onClick={() => setActiveTab("catalog")}
        >
          Global Catalog Visibility
        </button>
        <button 
          className={`px-4 py-2 font-bold rounded-xl transition ${activeTab === "defaults" ? "bg-white text-primary shadow-sm" : "text-textMuted hover:bg-white/50"}`}
          onClick={() => setActiveTab("defaults")}
        >
          Archetype Defaults
        </button>
        <button 
          className={`px-4 py-2 font-bold rounded-xl flex items-center gap-2 transition ${activeTab === "studio" ? "bg-primary text-white shadow-sm" : "text-textMuted hover:bg-white/50"}`}
          onClick={() => setActiveTab("studio")}
        >
          <Sparkles size={16} />
          Generation Studio
        </button>
      </div>

      {activeTab === "catalog" && (
        <div className="bg-surface/50 border border-outline-variant/30 rounded-3xl p-6 backdrop-blur-md shadow-sm">
          <div className="mb-6 flex justify-between items-center">
             <p className="text-sm font-medium text-textMuted">Click an item to toggle its visibility across the Canopy platform. Click the settings icon to adjust 3D attachment offsets.</p>
             <div className="text-sm font-bold text-textMain bg-white px-3 py-1 rounded-full shadow-sm">
                Visible: {allAccessoryPaths.filter(p => data.items[p]?.isVisible !== false).length} / {allAccessoryPaths.length}
             </div>
          </div>
          
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-4">
             {allAccessoryPaths.map(path => {
                const isVisible = data.items[path]?.isVisible !== false;
                return (
                  <div key={path} className="relative group">
                    <div 
                      onClick={() => setEditingPath(path)}
                      className={`relative aspect-square rounded-xl flex items-center justify-center cursor-pointer transition overflow-hidden ${isVisible ? "bg-white border-2 border-transparent shadow-sm hover:border-primary/20" : "bg-outline-variant/10 border-2 border-outline-variant/20 opacity-40 hover:opacity-100 mix-blend-luminosity hover:mix-blend-normal"}`}
                    >
                       <img src={`http://localhost:3001${path}`} alt="Accessory" className="w-[80%] h-[80%] object-contain" />
                       {!isVisible && <div className="absolute inset-0 flex items-center justify-center bg-black/5"><EyeOff size={16} className="text-textMain/50" /></div>}
                    </div>
                  </div>
                )
             })}
          </div>
        </div>
      )}

      {activeTab === "defaults" && (
        <div className="bg-surface/50 border border-outline-variant/30 rounded-3xl p-6 backdrop-blur-md shadow-sm">
           <div className="flex gap-4 mb-6 border-b border-outline-variant/20 pb-4 overflow-x-auto">
             {ARCHETYPES.map(arch => (
               <button 
                  key={arch}
                  onClick={() => setSelectedArchetype(arch)}
                  className={`px-4 py-2 font-bold rounded-lg text-sm transition whitespace-nowrap ${selectedArchetype === arch ? "bg-primary/10 text-primary border border-primary/20" : "bg-white text-textMuted border border-transparent shadow-sm hover:text-textMain"}`}
               >
                  {arch} Set
               </button>
             ))}
           </div>

           <p className="text-sm font-medium text-textMuted mb-6">Select which items should immediately equip when a new <span className="font-bold text-textMain">{selectedArchetype}</span> agent is created.</p>

           <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 gap-3">
             {allAccessoryPaths.map(path => {
                const isGloballyVisible = data.items[path]?.isVisible !== false;
                const isDefault = data.defaults[selectedArchetype]?.includes(path) || false;

                if (!isGloballyVisible && !isDefault) return null;

                return (
                  <div 
                    key={path} 
                    onClick={() => toggleDefault(path)}
                    className={`relative aspect-square rounded-xl flex items-center justify-center cursor-pointer transition overflow-hidden ${isDefault ? "bg-primary/5 border-2 border-primary shadow-sm" : "bg-white border-2 border-transparent shadow-sm hover:border-primary/20 opacity-60 hover:opacity-100"}`}
                  >
                     <img src={`http://localhost:3001${path}`} alt="Accessory" className="w-[80%] h-[80%] object-contain" />
                     {isDefault && <div className="absolute top-1 right-1 w-2 h-2 bg-primary rounded-full" />}
                  </div>
                )
             })}
          </div>
        </div>
      )}

      {activeTab === "studio" && (
         <div className="bg-white border border-outline-variant/30 rounded-3xl p-6 shadow-sm max-w-2xl">
           <h3 className="font-bold text-lg mb-4 text-textMain">3D Accessory Generation</h3>
           <AccessoryStudio onAddAccessory={(path) => {
              setData(prev => {
                if (!prev) return prev;
                return {
                  ...prev,
                  items: { ...prev.items, [path]: { isVisible: true, offset: [0,0,0] } }
                };
              });
              alert("Added to catalog!");
           }} />
         </div>
      )}

      {/* Detail & 3D Placement Modal */}
      <AnimatePresence>
        {editingPath && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-8">
             <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="bg-white rounded-3xl overflow-hidden shadow-2xl w-full max-w-6xl h-[80vh] relative flex">
                <button onClick={() => { setEditingPath(null); handleSave(); }} className="absolute top-4 right-4 text-textMuted hover:text-textMain z-10"><X size={24}/></button>
                
                {/* Left Pane: 2D & Bake */}
                <div className="w-1/3 bg-surface border-r border-outline-variant/30 p-8 flex flex-col">
                   <h3 className="font-bold text-2xl mb-2 text-textMain">Accessory Detail</h3>
                   <p className="text-xs text-textMuted mb-8 font-mono break-all">{editingPath}</p>
                   
                   <div className="aspect-square bg-white border border-border rounded-2xl flex items-center justify-center mb-6 shadow-sm overflow-hidden p-4">
                     <img src={`http://localhost:3001${editingPath}`} className="w-full h-full object-contain" />
                   </div>

                   <AccessoryBakeAction path={editingPath} onBakeComplete={() => {
                     // Force re-render of 3D scene
                     setEditingPath(editingPath);
                   }} />

                   <div className="mt-auto space-y-4">
                      <div>
                        <label className="text-xs font-bold text-textMuted uppercase mb-1 block">Attachment Bone</label>
                        <select 
                           value={data.items[editingPath]?.bone || "Head"}
                           onChange={(e) => {
                             if (!data) return;
                             setData({
                               ...data,
                               items: { ...data.items, [editingPath]: { ...data.items[editingPath], bone: e.target.value } }
                             });
                           }}
                           className="w-full bg-white border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary"
                        >
                           <option value="Head">Head</option>
                           <option value="Spine">Spine (Back)</option>
                           <option value="Hand_R">Right Hand</option>
                           <option value="Hand_L">Left Hand</option>
                           <option value="Root">Root (Floor)</option>
                        </select>
                      </div>

                      <button 
                        onClick={() => toggleVisibility(editingPath)}
                        className={`w-full font-bold py-3 rounded-xl transition-colors shadow-sm border-2 ${data.items[editingPath]?.isVisible !== false ? 'bg-white border-border text-textMuted hover:bg-black/5' : 'bg-primary/10 border-primary/20 text-primary hover:bg-primary/20'}`}
                      >
                        {data.items[editingPath]?.isVisible !== false ? "Hide Globally" : "Show Globally"}
                      </button>

                      <button onClick={() => { setEditingPath(null); handleSave(); }} className="w-full bg-primary hover:bg-primaryHover text-white font-bold py-3 rounded-xl transition-colors shadow-md">
                        Save Placement
                      </button>
                   </div>
                </div>

                {/* Right Pane: 3D Scene */}
                <div className="flex-1 bg-black/5 relative">
                   <Canvas shadows camera={{ position: [0, 1.5, 4], fov: 45 }}>
                      <Suspense fallback={null}>
                        <AccessoryPlacementScene 
                          accessoryGlbPath={`http://localhost:3001${editingPath.replace('.png', '.glb')}`}
                          boneName={data.items[editingPath]?.bone || "Head"}
                          offset={data.items[editingPath]?.offset || [0, 0, 0]}
                          onOffsetChange={(newOffset) => {
                             if (!data) return;
                             setData({
                                ...data,
                                items: { ...data.items, [editingPath]: { ...data.items[editingPath], offset: newOffset } }
                             });
                          }}
                        />
                      </Suspense>
                   </Canvas>
                   <div className="absolute top-4 left-4 bg-white/80 backdrop-blur-md px-3 py-1.5 rounded-lg text-xs font-mono text-textMain shadow-sm">
                      Offset: {data.items[editingPath]?.offset?.map(v => v.toFixed(2)).join(', ') || "0.00, 0.00, 0.00"}
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
  const [glbExists, setGlbExists] = useState<boolean | null>(null);

  useEffect(() => {
    // Check if glb exists
    fetch(`http://localhost:3001${path.replace('.png', '.glb')}`, { method: 'HEAD' })
      .then(res => {
         setGlbExists(res.ok);
         if (res.ok) setBakingState("done");
      })
      .catch(() => setGlbExists(false));
  }, [path]);

  const handleBake = async () => {
    setBakingState("starting");
    try {
      const imageUrl = `http://localhost:3001${path}`;
      const res = await fetch("http://localhost:3001/api/meshy-task", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      
      const taskId = data.taskId;
      setBakingState("meshing");
      
      // Poll
      const poll = setInterval(async () => {
        const checkRes = await fetch(`http://localhost:3001/api/meshy-check/${taskId}`);
        const checkData = await checkRes.json();
        if (checkData.status === "SUCCEEDED") {
          clearInterval(poll);
          setBakingState("done");
          setGlbExists(true);
          onBakeComplete();
        } else if (checkData.status === "FAILED") {
          clearInterval(poll);
          setBakingState("failed");
        }
      }, 3000);
      
    } catch (e: any) {
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
         <p className="text-xs text-textMuted mb-4">No 3D asset found for this accessory. Bake it to enable dynamic attachment.</p>
       )}
       
       <button 
          onClick={handleBake}
          disabled={bakingState !== "idle" && bakingState !== "failed"}
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
