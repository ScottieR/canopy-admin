import { useState, useEffect } from 'react';
import { Layers, Plus, Trash2, Save, Move3d } from 'lucide-react';
import { motion } from 'framer-motion';

export default function HabitatManager() {
  const [habitats, setHabitats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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
              <div className="flex items-center gap-2 text-xs font-bold text-textMuted mb-4 uppercase tracking-wider">
                <Move3d size={14} /> Default Lobster Placement
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
    </motion.div>
  );
}
