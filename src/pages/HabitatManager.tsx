import { useState, useEffect } from 'react';
import { Layers, Plus, Trash2, Save, Move3d, X, LayoutTemplate } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Canvas } from '@react-three/fiber';
import { HabitatPlacementScene } from '../components/3d/HabitatPlacementScene';

export default function HabitatManager() {
  const [habitats, setHabitats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingPlacement, setEditingPlacement] = useState<number | null>(null);

  useEffect(() => {
    fetchHabitats();
  }, []);

  const fetchHabitats = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/habitats');
      const data = await res.json();
      setHabitats(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const saveHabitats = async (newHabitats: any[]) => {
    try {
      await fetch('http://localhost:3001/api/habitats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newHabitats)
      });
      setHabitats(newHabitats);
    } catch (e) {
      console.error(e);
    }
  };

  const addHabitat = () => {
    const newId = habitats.length > 0 ? Math.max(...habitats.map(h => h.id)) + 1 : 1;
    const newHabitats = [...habitats, {
      id: newId,
      name: `New Habitat ${newId}`,
      path: '',
      type: 'glb',
      placement: { x: 0, y: 0, z: 0, rotationY: 0 }
    }];
    saveHabitats(newHabitats);
  };

  const updateHabitat = (index: number, field: string, value: any) => {
    const newHabitats = [...habitats];
    
    if (field.startsWith('placement.')) {
      const key = field.split('.')[1];
      newHabitats[index].placement[key] = parseFloat(value) || 0;
    } else {
      newHabitats[index][field] = value;
    }
    setHabitats(newHabitats);
  };

  const removeHabitat = (index: number) => {
    const newHabitats = habitats.filter((_, i) => i !== index);
    saveHabitats(newHabitats);
  };

  if (loading) return <div className="p-10 font-bold text-textMuted">Loading habitats...</div>;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-outline-variant/20">
        <div>
          <h2 className="text-2xl font-bold text-textMain flex items-center gap-3">
            <Layers className="text-primary" size={24} />
            Habitat Manager
          </h2>
          <p className="text-sm text-textMuted mt-1">Manage 3D environments and their default lobster placement.</p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => saveHabitats(habitats)} className="flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-primary/90 transition-colors shadow-sm">
            <Save size={18} /> Save Changes
          </button>
          <button onClick={addHabitat} className="flex items-center gap-2 bg-white text-primary border-2 border-primary/20 px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-primary/5 transition-colors">
            <Plus size={18} /> Add Habitat
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {habitats.map((habitat, index) => (
          <div key={habitat.id} className="bg-white p-6 rounded-2xl shadow-sm border border-outline-variant/20 flex gap-6">
            <div className="flex-1 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-textMuted mb-1.5 uppercase tracking-wider">Habitat Name</label>
                  <input
                    type="text"
                    value={habitat.name}
                    onChange={(e) => updateHabitat(index, 'name', e.target.value)}
                    className="w-full bg-surface border border-outline-variant/50 rounded-xl px-4 py-2 text-sm font-medium focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-textMuted mb-1.5 uppercase tracking-wider">Type</label>
                  <select
                    value={habitat.type}
                    onChange={(e) => updateHabitat(index, 'type', e.target.value)}
                    className="w-full bg-surface border border-outline-variant/50 rounded-xl px-4 py-2 text-sm font-medium focus:ring-2 focus:ring-primary/20 outline-none"
                  >
                    <option value="glb">3D Model (.glb)</option>
                    <option value="pedestal">Default Pedestal</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-textMuted mb-1.5 uppercase tracking-wider">File Path (URL or local path)</label>
                <input
                  type="text"
                  value={habitat.path}
                  onChange={(e) => updateHabitat(index, 'path', e.target.value)}
                  placeholder="/models/habitats/example.glb"
                  className="w-full bg-surface border border-outline-variant/50 rounded-xl px-4 py-2 text-sm font-medium focus:ring-2 focus:ring-primary/20 outline-none"
                />
              </div>
            </div>

            <div className="w-px bg-outline-variant/20 mx-2"></div>

            <div className="w-[300px]">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2 text-xs font-bold text-textMuted uppercase tracking-wider">
                  <Move3d size={14} /> Default Lobster Placement
                </div>
                <button 
                  onClick={() => setEditingPlacement(index)}
                  className="bg-primary/10 text-primary hover:bg-primary/20 transition-colors px-2 py-1 rounded flex items-center gap-1 text-[10px] font-bold uppercase"
                >
                  <LayoutTemplate size={12} /> Visual Editor
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {['x', 'y', 'z', 'rotationY'].map((axis) => (
                  <div key={axis} className="flex items-center bg-surface border border-outline-variant/50 rounded-lg overflow-hidden">
                    <span className="bg-outline-variant/10 text-textMuted font-bold text-xs px-3 py-2 border-r border-outline-variant/50 uppercase">
                      {axis === 'rotationY' ? 'rot' : axis}
                    </span>
                    <input
                      type="number"
                      step={axis === 'rotationY' ? "0.1" : "0.5"}
                      value={habitat.placement?.[axis] ?? 0}
                      onChange={(e) => updateHabitat(index, `placement.${axis}`, e.target.value)}
                      className="w-full bg-transparent px-3 py-2 text-sm font-medium outline-none"
                    />
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={() => removeHabitat(index)}
              className="w-10 h-10 flex items-center justify-center rounded-xl text-error hover:bg-error/10 transition-colors shrink-0 self-center"
            >
              <Trash2 size={18} />
            </button>
          </div>
        ))}
      </div>

      <AnimatePresence>
        {editingPlacement !== null && habitats[editingPlacement] && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-8">
             <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="bg-white rounded-3xl overflow-hidden shadow-2xl w-full max-w-5xl h-[70vh] relative flex flex-col">
                <button onClick={() => { setEditingPlacement(null); saveHabitats(habitats); }} className="absolute top-4 right-4 text-textMuted hover:text-textMain z-10 bg-white/80 backdrop-blur rounded-full p-1"><X size={24}/></button>
                
                <div className="bg-surface border-b border-outline-variant/30 p-6 flex justify-between items-center shrink-0 z-10 shadow-sm relative">
                   <div>
                     <h3 className="font-bold text-xl text-textMain flex items-center gap-2"><Move3d size={20} className="text-primary"/> Visual Placement</h3>
                     <p className="text-xs text-textMuted mt-1">Drag the lobster to set the default spawn point for <span className="font-bold text-textMain">{habitats[editingPlacement].name}</span>.</p>
                   </div>
                   
                   <div className="flex items-center gap-4">
                     <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-border shadow-sm">
                       <span className="text-xs font-bold text-textMuted uppercase">Rot Y</span>
                       <input 
                         type="range" min="-3.14" max="3.14" step="0.1"
                         value={habitats[editingPlacement].placement.rotationY || 0}
                         onChange={(e) => updateHabitat(editingPlacement, 'placement.rotationY', e.target.value)}
                         className="w-24 accent-primary"
                       />
                     </div>
                     <button onClick={() => { setEditingPlacement(null); saveHabitats(habitats); }} className="bg-primary hover:bg-primaryHover text-white font-bold py-2 px-6 rounded-xl transition-colors shadow-sm text-sm">
                        Save Placement
                     </button>
                   </div>
                </div>

                <div className="flex-1 bg-black/5 relative">
                   <Canvas shadows camera={{ position: [0, 4, 8], fov: 45 }}>
                      <HabitatPlacementScene 
                        habitatPath={habitats[editingPlacement].path}
                        habitatType={habitats[editingPlacement].type}
                        placement={habitats[editingPlacement].placement}
                        onPlacementChange={(newPlacement) => {
                           const newHabitats = [...habitats];
                           newHabitats[editingPlacement].placement = newPlacement;
                           setHabitats(newHabitats);
                        }}
                      />
                   </Canvas>
                   <div className="absolute bottom-4 left-4 bg-white/80 backdrop-blur-md px-3 py-1.5 rounded-lg text-xs font-mono text-textMain shadow-sm pointer-events-none">
                      X: {habitats[editingPlacement].placement.x.toFixed(2)} | Y: {habitats[editingPlacement].placement.y.toFixed(2)} | Z: {habitats[editingPlacement].placement.z.toFixed(2)}
                   </div>
                </div>
             </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
