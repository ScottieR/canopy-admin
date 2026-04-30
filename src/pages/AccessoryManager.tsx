import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Save, EyeOff, Sparkles, Sliders, X } from 'lucide-react';
import { AccessoryStudio } from '../components/AccessoryStudio';

interface AccessoriesData {
  items: Record<string, { isVisible: boolean, offset?: [number, number, number] }>;
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
  
  const updateOffset = (axis: 0|1|2, val: number) => {
    if (!data || !editingPath) return;
    const current = data.items[editingPath]?.offset || [0, 0, 0];
    const next: [number, number, number] = [...current] as [number, number, number];
    next[axis] = val;
    setData({
      ...data,
      items: { ...data.items, [editingPath]: { ...data.items[editingPath], offset: next } }
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
          <h1 className="text-3xl font-bold tracking-tight text-textMain mb-2">Cosmetics Catalog</h1>
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
                      onClick={() => toggleVisibility(path)}
                      className={`relative aspect-square rounded-xl flex items-center justify-center cursor-pointer transition overflow-hidden ${isVisible ? "bg-white border-2 border-transparent shadow-sm hover:border-primary/20" : "bg-outline-variant/10 border-2 border-outline-variant/20 opacity-40 hover:opacity-100 mix-blend-luminosity hover:mix-blend-normal"}`}
                    >
                       <img src={`http://localhost:3001${path}`} alt="Accessory" className="w-[80%] h-[80%] object-contain" />
                       {!isVisible && <div className="absolute inset-0 flex items-center justify-center bg-black/5"><EyeOff size={16} className="text-textMain/50" /></div>}
                    </div>
                    <button 
                      onClick={() => setEditingPath(path)}
                      className="absolute -bottom-2 -right-2 bg-white border border-border p-1.5 rounded-full shadow-md text-textMuted hover:text-primary transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Sliders size={12} />
                    </button>
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

      {/* Offset Editing Modal */}
      <AnimatePresence>
        {editingPath && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center p-4">
             <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="bg-white rounded-3xl p-6 shadow-2xl max-w-md w-full relative">
                <button onClick={() => setEditingPath(null)} className="absolute top-4 right-4 text-textMuted hover:text-textMain"><X size={20}/></button>
                <h3 className="font-bold text-xl mb-1 text-textMain">Attachment Offsets</h3>
                <p className="text-xs text-textMuted mb-6 font-mono break-all">{editingPath}</p>
                
                <div className="flex gap-6 mb-6">
                  <div className="w-24 h-24 bg-background border border-border rounded-xl flex items-center justify-center shrink-0">
                    <img src={`http://localhost:3001${editingPath}`} className="w-20 h-20 object-contain" />
                  </div>
                  <div className="flex-1 space-y-4">
                     {(['X', 'Y', 'Z'] as const).map((axis, i) => {
                       const val = data.items[editingPath]?.offset?.[i] || 0;
                       return (
                         <div key={axis}>
                           <div className="flex justify-between text-xs font-bold mb-1">
                             <span>{axis} Axis</span>
                             <span className="font-mono text-primary">{val.toFixed(2)}</span>
                           </div>
                           <input 
                             type="range" min="-5" max="5" step="0.1" 
                             value={val}
                             onChange={(e) => updateOffset(i as 0|1|2, parseFloat(e.target.value))}
                             className="w-full accent-primary"
                           />
                         </div>
                       )
                     })}
                  </div>
                </div>
                
                <button onClick={() => { setEditingPath(null); handleSave(); }} className="w-full bg-primary hover:bg-primaryHover text-white font-bold py-3 rounded-xl transition-colors">
                  Save Placement
                </button>
             </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
