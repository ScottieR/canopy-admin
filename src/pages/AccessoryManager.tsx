import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Save, Eye, EyeOff } from 'lucide-react';

interface AccessoriesData {
  items: Record<string, { isVisible: boolean }>;
  defaults: Record<string, string[]>;
}

const ARCHETYPES = ["Coder", "Strategist", "Accountant", "Assistant", "Researcher", "Tutor"];

export default function AccessoryManager() {
  const [data, setData] = useState<AccessoriesData | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"catalog" | "defaults">("catalog");
  const [selectedArchetype, setSelectedArchetype] = useState(ARCHETYPES[0]);

  useEffect(() => {
    fetch('http://localhost:3001/api/accessories')
      .then(r => r.json())
      .then(d => {
         // Fallback initialization if any items are missing or structure is warped
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
    const current = data.items[path]?.isVisible !== false; // defaults to true if undefined
    setData({
      ...data,
      items: { ...data.items, [path]: { isVisible: !current } }
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

  // Pre-calculate all available items. We can assume items in data.items maps the 150 count.
  const allAccessoryPaths = Object.keys(data.items);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      
      <div className="flex justify-between items-end border-b border-outline-variant/30 pb-6 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-textMain mb-2">Cosmetics Catalog</h1>
          <p className="text-textMuted font-medium">Curate the master accessory set and build archetype loadouts.</p>
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
      </div>

      {activeTab === "catalog" && (
        <div className="bg-surface/50 border border-outline-variant/30 rounded-3xl p-6 backdrop-blur-md shadow-sm">
          <div className="mb-6 flex justify-between items-center">
             <p className="text-sm font-medium text-textMuted">Click an item to toggle its visibility across the Canopy platform.</p>
             <div className="text-sm font-bold text-textMain bg-white px-3 py-1 rounded-full shadow-sm">
                Visible: {allAccessoryPaths.filter(p => data.items[p]?.isVisible !== false).length} / {allAccessoryPaths.length}
             </div>
          </div>
          
          <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 gap-3">
             {allAccessoryPaths.map(path => {
                const isVisible = data.items[path]?.isVisible !== false;
                return (
                  <div 
                    key={path} 
                    onClick={() => toggleVisibility(path)}
                    className={`relative aspect-square rounded-xl flex items-center justify-center cursor-pointer transition overflow-hidden group ${isVisible ? "bg-white border-2 border-transparent shadow-sm hover:border-primary/20" : "bg-outline-variant/10 border-2 border-outline-variant/20 opacity-40 hover:opacity-100 mix-blend-luminosity hover:mix-blend-normal"}`}
                  >
                     <img src={`http://localhost:3001${path}`} alt="Accessory" className="w-[80%] h-[80%] object-contain" />
                     {!isVisible && <div className="absolute inset-0 flex items-center justify-center bg-black/5"><EyeOff size={16} className="text-textMain/50" /></div>}
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
                // If it's globally hidden, we shouldn't really equip it, but let's gray it out
                const isGloballyVisible = data.items[path]?.isVisible !== false;
                const isDefault = data.defaults[selectedArchetype]?.includes(path) || false;

                if (!isGloballyVisible && !isDefault) return null; // hide completely if totally irrelevant

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

    </motion.div>
  );
}
