import { useState, useEffect, Suspense } from 'react';
import { Layers, Plus, Trash2, Save, Move3d, X, Image as ImageIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Canvas } from '@react-three/fiber';
import { HabitatPlacementScene } from '../components/3d/HabitatPlacementScene';

export default function HabitatManager() {
  const [habitats, setHabitats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingPlacement, setEditingPlacement] = useState<number | null>(null);
  const [placementMode, setPlacementMode] = useState<'lobster' | 'paint' | 'erase'>('lobster');

  const fetchHabitats = () => {
    fetch('/api/habitats')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setHabitats(data);
        setLoading(false);
      })
      .catch(err => {
        console.warn("Could not load habitats:", err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchHabitats();
  }, []);

  const saveHabitats = async (newHabitats: any[]) => {
    try {
      await fetch('/api/habitats', {
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
      newHabitats[index] = {
        ...newHabitats[index],
        placement: {
          ...(newHabitats[index].placement || {}),
          [key]: parseFloat(value) || 0
        }
      };
    } else {
      newHabitats[index] = {
        ...newHabitats[index],
        [field]: value
      };
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mt-6">
        {habitats.map((habitat, index) => (
          <motion.div 
            key={habitat.id} 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-3xl border border-border shadow-sm overflow-hidden flex flex-col group cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => setEditingPlacement(index)}
          >
            <div className="h-48 w-full bg-surface relative flex items-center justify-center border-b border-border/50">
               {habitat.path && habitat.type === 'glb' ? (
                 <>
                   <img 
                     src={habitat.path.startsWith('http') ? habitat.path.replace('.glb', '.png') : `http://localhost:3001${habitat.path.startsWith('/') ? '' : '/'}${habitat.path.replace('.glb', '.png')}`}
                     alt={habitat.name}
                     className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                     onError={(e) => { (e.target as any).style.display = 'none'; }}
                   />
                   <div className="absolute inset-0 flex items-center justify-center text-outline-variant" style={{ zIndex: -1 }}>
                      <ImageIcon size={32} />
                   </div>
                 </>
               ) : (
                 <div className="text-outline-variant">
                    <ImageIcon size={32} />
                 </div>
               )}
            </div>
            
            <div className="p-5 flex-1 flex flex-col border-t border-border/50">
              <h3 className="font-extrabold text-textMain text-lg truncate">{habitat.name}</h3>
              <p className="text-xs font-medium text-textMuted mt-1 truncate" title={habitat.path}>{habitat.path || 'No model path defined'}</p>
              
              <div className="mt-auto pt-4 flex items-center justify-between">
                 <div className="text-[10px] font-bold text-textMuted uppercase bg-backgroundAlt px-2 py-1 rounded-md">
                   {habitat.type === 'glb' ? '3D Model' : 'Pedestal'}
                 </div>
                 <div className="text-[10px] font-bold text-textMuted uppercase">
                   Pts: {habitat.decorPoints?.length || 0}
                 </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <AnimatePresence>
        {editingPlacement !== null && habitats[editingPlacement] && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-8">
             <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="bg-white rounded-3xl overflow-hidden shadow-2xl w-full max-w-6xl h-[85vh] relative flex flex-col">
                <button onClick={() => { setEditingPlacement(null); fetchHabitats(); }} className="absolute top-4 right-4 text-textMuted hover:text-textMain z-10 bg-white/80 backdrop-blur rounded-full p-1"><X size={24}/></button>
                
                <div className="bg-surface border-b border-outline-variant/30 p-6 flex justify-between items-center shrink-0 z-10 shadow-sm relative">
                   <div>
                     <h3 className="font-bold text-xl text-textMain flex items-center gap-2"><Move3d size={20} className="text-primary"/> Editing {habitats[editingPlacement].name}</h3>
                     <p className="text-xs text-textMuted mt-1">Configure model path, default spawn, and paint valid decor surface areas.</p>
                   </div>
                   
                   <div className="flex items-center gap-4">
                     <button onClick={() => removeHabitat(editingPlacement)} className="text-error hover:bg-error/10 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-colors">
                        <Trash2 size={16} /> Delete
                     </button>
                     <button onClick={() => { setEditingPlacement(null); saveHabitats(habitats); }} className="bg-primary hover:bg-primaryHover text-white font-bold py-2 px-6 rounded-xl transition-colors shadow-sm text-sm">
                        Save & Close
                     </button>
                   </div>
                </div>

                <div className="flex-1 flex flex-row relative overflow-hidden bg-white">
                   {/* Left Panel: Properties */}
                   <div className="w-80 border-r border-border p-6 flex flex-col gap-6 overflow-y-auto bg-background">
                      <div>
                        <label className="block text-[10px] font-bold text-textMuted mb-2 uppercase tracking-wider">Habitat Name</label>
                        <input
                          type="text"
                          value={habitats[editingPlacement].name}
                          onChange={(e) => updateHabitat(editingPlacement, 'name', e.target.value)}
                          className="w-full bg-white border border-border rounded-xl px-4 py-2 text-sm font-bold focus:ring-2 focus:ring-primary/20 outline-none shadow-sm text-textMain"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-[10px] font-bold text-textMuted mb-2 uppercase tracking-wider">Model Type</label>
                        <select
                          value={habitats[editingPlacement].type}
                          onChange={(e) => updateHabitat(editingPlacement, 'type', e.target.value)}
                          className="w-full bg-white border border-border rounded-xl px-4 py-2 text-sm font-bold focus:ring-2 focus:ring-primary/20 outline-none shadow-sm text-textMain"
                        >
                          <option value="glb">3D Model (.glb)</option>
                          <option value="pedestal">Default Pedestal</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-textMuted mb-2 uppercase tracking-wider">File Path (URL or local path)</label>
                        <input
                          type="text"
                          value={habitats[editingPlacement].path}
                          onChange={(e) => updateHabitat(editingPlacement, 'path', e.target.value)}
                          placeholder="/models/habitats/example.glb"
                          className="w-full bg-white border border-border rounded-xl px-4 py-2 text-xs font-mono focus:ring-2 focus:ring-primary/20 outline-none shadow-sm text-textMain"
                        />
                      </div>

                      <div className="pt-6 border-t border-border">
                        <label className="block text-[10px] font-bold text-textMuted mb-3 uppercase tracking-wider flex justify-between items-center">
                          Default Lobster Placement
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                          {['x', 'y', 'z', 'rotationY'].map((axis) => (
                            <div key={axis} className="flex items-center bg-white border border-border rounded-lg overflow-hidden shadow-sm">
                              <span className="bg-backgroundAlt text-textMuted font-bold text-[10px] px-2 py-2 border-r border-border w-10 text-center uppercase">
                                {axis === 'rotationY' ? 'rot' : axis}
                              </span>
                              <input
                                type="number"
                                step={axis === 'rotationY' ? "0.1" : "0.5"}
                                value={habitats[editingPlacement].placement?.[axis] ?? 0}
                                onChange={(e) => updateHabitat(editingPlacement, `placement.${axis}`, e.target.value)}
                                className="w-full bg-transparent px-2 py-2 text-xs font-mono outline-none text-textMain"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                   </div>

                   {/* Right Panel: Visual Editor */}
                   <div className="flex-1 bg-black/5 relative flex flex-col">
                      <div className="absolute top-4 left-4 right-4 z-10 flex justify-between items-start pointer-events-none">
                         <div className="flex items-center bg-white/90 backdrop-blur shadow-sm p-1 rounded-xl pointer-events-auto border border-border/50">
                            <button 
                              onClick={() => setPlacementMode('lobster')}
                              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${placementMode === 'lobster' ? 'bg-primary shadow-sm text-white' : 'text-textMuted hover:text-textMain'}`}
                            >
                              Spawn Point
                            </button>
                            <button 
                              onClick={() => setPlacementMode('paint')}
                              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${placementMode === 'paint' ? 'bg-primary shadow-sm text-white' : 'text-textMuted hover:text-textMain'}`}
                            >
                              Paint Decor
                            </button>
                            <button 
                              onClick={() => setPlacementMode('erase')}
                              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${placementMode === 'erase' ? 'bg-error shadow-sm text-white' : 'text-textMuted hover:text-textMain'}`}
                            >
                              Erase
                            </button>
                         </div>
                         
                         <div className="flex items-center gap-2 bg-white/90 backdrop-blur px-3 py-2 rounded-xl border border-border/50 shadow-sm pointer-events-auto">
                           <span className="text-xs font-bold text-textMuted uppercase tracking-wider">Lobster Y-Rotation</span>
                           <input 
                             type="range" min="-3.14" max="3.14" step="0.1"
                             value={habitats[editingPlacement].placement?.rotationY || 0}
                             onChange={(e) => updateHabitat(editingPlacement, 'placement.rotationY', e.target.value)}
                             className="w-32 accent-primary"
                             disabled={placementMode !== 'lobster'}
                           />
                         </div>
                      </div>

                      <Canvas shadows camera={{ position: [0, 4, 8], fov: 45 }}>
                         <Suspense fallback={null}>
                           <HabitatPlacementScene 
                             habitatPath={habitats[editingPlacement].path}
                             habitatType={habitats[editingPlacement].type}
                             placement={habitats[editingPlacement].placement}
                             decorPoints={habitats[editingPlacement].decorPoints || []}
                             placementMode={placementMode}
                             onPlacementChange={(newPlacement) => {
                                const newHabitats = [...habitats];
                                newHabitats[editingPlacement] = {
                                  ...newHabitats[editingPlacement],
                                  placement: newPlacement
                                };
                                setHabitats(newHabitats);
                             }}
                             onDecorPointsChange={(newPoints) => {
                                const newHabitats = [...habitats];
                                newHabitats[editingPlacement] = {
                                  ...newHabitats[editingPlacement],
                                  decorPoints: newPoints
                                };
                                setHabitats(newHabitats);
                             }}
                           />
                         </Suspense>
                      </Canvas>

                      <div className="absolute bottom-4 left-4 bg-white/80 backdrop-blur-md px-3 py-1.5 rounded-lg text-xs font-mono text-textMain shadow-sm pointer-events-none border border-border/50">
                         Lobster Spawn: [{habitats[editingPlacement].placement?.x?.toFixed(2)}, {habitats[editingPlacement].placement?.y?.toFixed(2)}, {habitats[editingPlacement].placement?.z?.toFixed(2)}]
                      </div>
                      <div className="absolute bottom-4 right-4 bg-white/80 backdrop-blur-md px-3 py-1.5 rounded-lg text-xs font-bold text-textMain shadow-sm pointer-events-none border border-border/50">
                         Decor Points Painted: {(habitats[editingPlacement].decorPoints || []).length}
                      </div>
                   </div>
                </div>
             </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
