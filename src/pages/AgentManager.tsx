import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Edit2, X, Shield, BookOpen, ToggleRight, ToggleLeft } from 'lucide-react';
import { Canvas } from '@react-three/fiber';
import { AdminGLBAgent } from '../components/3d/AdminGLBAgent';
import { AdminTerrarium } from '../components/3d/AdminTerrarium';
import { SafeBillboard } from '../components/3d/SafeBillboard';
import { AccessoryStudio } from '../components/AccessoryStudio';
import RAW_AGENT_TYPE_INFO from '../../../shared/agents.json';
import BookSearch from '../components/BookSearch';

export default function AgentManager() {
  const [rawJSON, setRawJSON] = useState<Record<string, any>>(RAW_AGENT_TYPE_INFO);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<any>(null);
  const [globalLibrary, setGlobalLibrary] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'identity' | 'accessories' | 'knowledge'>('identity');
  const [globalAccessories, setGlobalAccessories] = useState<any>({ items: {} });

  useEffect(() => {
    fetch('http://localhost:3001/api/agents')
      .then(res => res.json())
      .then(data => setRawJSON(data))
      .catch(err => console.warn("Local API server not running, using static JSON import.", err));

    fetch('http://localhost:3001/api/library')
      .then(res => res.json())
      .then(data => setGlobalLibrary(Array.isArray(data) ? data : []))
      .catch(err => console.warn("Could not load global library.", err));

    fetch('http://localhost:3001/accessories/accessories.json')
      .then(res => res.json())
      .then(data => setGlobalAccessories(data))
      .catch(err => console.warn("Could not load accessories library.", err));
  }, [isModalOpen]);

  const agents = Object.entries(rawJSON).map(([key, val]) => ({
    id: key,
    name: key,
    role: val.description,
    image: val.image || 'https://images.unsplash.com/photo-1544377193-33dce4d95d0c?q=80&w=250&auto=format&fit=crop&sepia=1',
    library: val.library || [], 
    permissions: val.permissions || { calendar: true, files: true, web: true, email: false }, 
    status: val.suggest_in_onboarding ? 'Active' : 'Archived',
    suggest_in_onboarding: val.suggest_in_onboarding ?? true,
    color: val.color || '#218380',
    robeColor: val.robeColor || '#218380',
    accentColor: val.accentColor || '#cccccc',
    habitatColor: val.habitatColor || '#D2D6C8',
    habitatLabel: val.habitatLabel || 'The Void',
    manual_order: val.manual_order,
    popularity: val.popularity || 0,
    accessories: val.accessories || [],
    ...val
  })).sort((a: any, b: any) => {
    const aOrder = a.manual_order;
    const bOrder = b.manual_order;
    if (aOrder != null && bOrder != null) return aOrder - bOrder;
    if (aOrder != null) return -1;
    if (bOrder != null) return 1;
    return (b.popularity || 0) - (a.popularity || 0);
  });

  const openModal = (agent: any = null) => {
    setEditingAgent(agent);
    setActiveTab('identity');
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setEditingAgent(null);
    setIsModalOpen(false);
  };

  const handleSave = async () => {
    if (!editingAgent) return;
    const newJSON = { ...rawJSON };
    newJSON[editingAgent.id] = {
      ...newJSON[editingAgent.id],
      description: editingAgent.role,
      image: editingAgent.image,
      suggest_in_onboarding: editingAgent.suggest_in_onboarding,
      library: editingAgent.library,
      readwise_enabled: editingAgent.readwise_enabled,
      color: editingAgent.color,
      robeColor: editingAgent.robeColor,
      accentColor: editingAgent.accentColor,
      habitatColor: editingAgent.habitatColor,
      habitatLabel: editingAgent.habitatLabel,
      manual_order: editingAgent.manual_order,
      popularity: editingAgent.popularity,
      accessories: editingAgent.accessories
    };
    
    try {
      await fetch('http://localhost:3001/api/agents', {
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
    <div className="space-y-6 flex flex-col h-full">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-textMain mb-2">Agent Templates</h1>
          <p className="text-textMuted font-medium">Manage global recommended personalities and their default permissions.</p>
        </div>
        <button 
          onClick={() => openModal()}
          className="flex items-center gap-2 bg-primary hover:bg-primaryHover text-white px-5 py-3 rounded-xl font-bold transition-all shadow-lg shadow-primary/30 active:scale-95"
        >
          <Plus size={20} className="stroke-[3px]" />
          Create Template
        </button>
      </div>

      {/* Agents Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mt-10">
        {agents.map(agent => (
          <div key={agent.id} className="flex flex-col">
            <h3 className="text-center font-bold text-textMain mb-3 text-lg">{agent.name}</h3>
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={() => openModal(agent)}
              className="group bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all flex flex-col border border-border h-full cursor-pointer"
            >
            <div className={`h-64 w-full overflow-hidden relative flex items-center justify-center`} style={{ backgroundColor: agent.habitatColor || '#D6A3B9' }}>
               <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent z-10" />
              {agent.image ? (
                 <img src={agent.image.startsWith('http') ? agent.image : `http://localhost:3001${agent.image}`} alt={agent.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 relative z-0" />
              ) : (
                <div className="w-20 h-20 rounded-full" style={{ backgroundColor: agent.robeColor, boxShadow: "0 10px 20px rgba(0,0,0,0.1)" }}></div>
              )}
              
              <div className="absolute top-3 right-3 z-20 flex gap-2">
                <span className={`px-2.5 py-1 rounded-lg text-xs font-bold backdrop-blur-md bg-white/90 shadow-sm ${agent.suggest_in_onboarding ? 'text-primary' : 'text-[#D96C3B]'}`}>
                  {agent.suggest_in_onboarding ? 'Visible' : 'Hidden'}
                </span>
              </div>
            </div>
            
            <div className="p-6 flex-1 flex flex-col pt-5">
              <p className="text-textMuted text-sm font-medium mb-6 leading-relaxed line-clamp-2 text-center" title={agent.role}>{agent.role}</p>
              
              <div className={`mt-auto space-y-3`}>
                <div className="flex items-start gap-2">
                  <BookOpen size={16} className="text-primary mt-0.5 shrink-0" />
                  <div className="flex flex-wrap gap-1.5">
                    {agent.library.map((book: any, i: number) => (
                      <span key={i} className="text-xs px-2 py-1 bg-backgroundAlt border border-border rounded-lg text-textMuted font-medium">
                        {typeof book === 'string' ? book : book.title}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Shield size={16} className="text-primary shrink-0" />
                  <div className="flex gap-2">
                    {Object.entries(agent.permissions || {}).map(([key, val]) => (
                      val ? <span key={key} className="text-xs font-semibold text-textMain capitalize">{key}</span> : null
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
          </div>
        ))}
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
              className="bg-background w-full max-w-6xl rounded-3xl shadow-2xl z-10 overflow-hidden flex h-[85vh]"
            >
              
              {/* LEFT PANE - THE 3D CANVAS */}
              <div className="flex-1 bg-backgroundAlt relative overflow-hidden flex flex-col">
                 <div className="absolute top-4 left-4 z-10 bg-white/80 backdrop-blur-sm px-4 py-2 rounded-xl border border-border shadow-sm">
                   <p className="font-bold text-textMain text-sm">3D Template Sandbox</p>
                 </div>
                 
                 <div className="flex-1" style={{ backgroundColor: editingAgent?.color || '#F5E6D8' }}>
                   <Canvas camera={{ position: [2.5, 2, 2.5], fov: 40 }} shadows orthographic>
                      <ambientLight intensity={1.5} />
                      <directionalLight position={[5, 8, 5]} intensity={2.5} castShadow />
                      
                      {/* Terrarium */}
                      <AdminTerrarium habitatColor={editingAgent?.habitatColor || '#D2D6C8'} size={2.5} />
                      
                      {/* Agent */}
                      <AdminGLBAgent robeColor={editingAgent?.robeColor || '#888888'} />
                      
                      {/* Accessories */}
                      {editingAgent?.accessories?.map((path: string, i: number) => (
                        <SafeBillboard
                          key={path}
                          url={path.startsWith('http') ? path : `http://localhost:3001${path}`}
                          position={[(i - ((editingAgent?.accessories?.length || 1) - 1) / 2) * 1.2, 1.5, 0]}
                        />
                      ))}
                   </Canvas>
                 </div>
              </div>
              
              {/* RIGHT PANE - CONTROLS */}
              <div className="w-[450px] bg-white border-l border-border flex flex-col">
                <div className="flex items-center justify-between p-5 border-b border-border bg-backgroundAlt/30">
                  <h2 className="text-xl font-bold text-textMain">{editingAgent?.id ? editingAgent.id : 'New Template'}</h2>
                  <button onClick={closeModal} className="text-textMuted hover:text-textMain p-1.5 rounded-full transition-colors">
                    <X size={20} className="stroke-[3px]" />
                  </button>
                </div>
                
                {/* TABS */}
                <div className="flex border-b border-border">
                  {['identity', 'accessories', 'knowledge'].map(tab => (
                    <button 
                      key={tab} 
                      onClick={() => setActiveTab(tab as any)}
                      className={`flex-1 py-3 text-sm font-bold border-b-2 transition-colors capitalize ${activeTab === tab ? 'border-primary text-primary' : 'border-transparent text-textMuted hover:text-textMain'}`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                <div className="p-6 overflow-y-auto flex-1 bg-white space-y-6">
                  
                  {activeTab === 'identity' && (
                    <div className="space-y-6 animate-fade-in">
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-textMain">Role Description</label>
                        <input 
                          type="text" 
                          value={editingAgent?.role || ''} 
                          onChange={(e) => setEditingAgent({ ...editingAgent, role: e.target.value })}
                          className="w-full bg-background border border-border rounded-xl px-4 py-3 text-textMain font-medium focus:outline-none" 
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-textMain">Agent Image</label>
                        <div className="flex gap-4 items-center">
                          {editingAgent?.image && (
                            <img src={editingAgent.image.startsWith('http') ? editingAgent.image : `http://localhost:3001${editingAgent.image}`} className="w-16 h-16 rounded-xl object-cover border border-border shrink-0" />
                          )}
                          <input 
                            type="file" 
                            accept="image/*"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              const formData = new FormData();
                              formData.append('image', file);
                              try {
                                const res = await fetch('http://localhost:3001/api/upload-agent-image', {
                                  method: 'POST',
                                  body: formData
                                });
                                const data = await res.json();
                                if (data.success) {
                                  setEditingAgent({ ...editingAgent, image: data.imagePath });
                                }
                              } catch (err) {
                                console.error(err);
                              }
                            }}
                            className="w-full bg-background border border-border rounded-xl px-4 py-2 text-sm text-textMain font-medium focus:outline-none" 
                          />
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-xs font-bold text-textMain uppercase tracking-wide">Base Config</label>
                          <div className="flex gap-2">
                            <input type="color" value={editingAgent?.color || '#000000'} onChange={(e) => setEditingAgent({ ...editingAgent, color: e.target.value })} className="w-8 h-8 rounded border border-border p-0.5 cursor-pointer" />
                            <input type="text" value={editingAgent?.color || ''} onChange={(e) => setEditingAgent({ ...editingAgent, color: e.target.value })} className="flex-1 bg-white border border-border rounded-lg px-2 text-xs font-medium focus:outline-none" />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-bold text-textMain uppercase tracking-wide">Robe Override</label>
                          <div className="flex gap-2">
                            <input type="color" value={editingAgent?.robeColor || '#000000'} onChange={(e) => setEditingAgent({ ...editingAgent, robeColor: e.target.value })} className="w-8 h-8 rounded border border-border p-0.5 cursor-pointer" />
                            <input type="text" value={editingAgent?.robeColor || ''} onChange={(e) => setEditingAgent({ ...editingAgent, robeColor: e.target.value })} className="flex-1 bg-white border border-border rounded-lg px-2 text-xs font-medium focus:outline-none" />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-bold text-textMain uppercase tracking-wide">Accent Detail</label>
                          <div className="flex gap-2">
                            <input type="color" value={editingAgent?.accentColor || '#000000'} onChange={(e) => setEditingAgent({ ...editingAgent, accentColor: e.target.value })} className="w-8 h-8 rounded border border-border p-0.5 cursor-pointer" />
                            <input type="text" value={editingAgent?.accentColor || ''} onChange={(e) => setEditingAgent({ ...editingAgent, accentColor: e.target.value })} className="flex-1 bg-white border border-border rounded-lg px-2 text-xs font-medium focus:outline-none" />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-bold text-textMain uppercase tracking-wide">Habitat Ground</label>
                          <div className="flex gap-2">
                            <input type="color" value={editingAgent?.habitatColor || '#000000'} onChange={(e) => setEditingAgent({ ...editingAgent, habitatColor: e.target.value })} className="w-8 h-8 rounded border border-border p-0.5 cursor-pointer" />
                            <input type="text" value={editingAgent?.habitatColor || ''} onChange={(e) => setEditingAgent({ ...editingAgent, habitatColor: e.target.value })} className="flex-1 bg-white border border-border rounded-lg px-2 text-xs font-medium focus:outline-none" />
                          </div>
                        </div>
                      </div>
                      
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-textMain uppercase tracking-wide">Habitat Label</label>
                        <input type="text" value={editingAgent?.habitatLabel || ''} onChange={(e) => setEditingAgent({ ...editingAgent, habitatLabel: e.target.value })} className="w-full bg-white border border-border rounded-lg px-3 py-2 text-xs font-medium focus:outline-none" />
                      </div>
                      
                      <div className="flex gap-4">
                        <div className="flex-1 flex items-center justify-between bg-primary/5 border border-primary/20 p-4 rounded-xl">
                          <div>
                            <h4 className="text-textMain font-bold text-sm">Onboarding</h4>
                            <p className="text-textMuted text-xs font-medium mt-1">Suggest role.</p>
                          </div>
                          <button onClick={() => setEditingAgent({ ...editingAgent, suggest_in_onboarding: !editingAgent.suggest_in_onboarding })} className={`transition-colors ${editingAgent?.suggest_in_onboarding ? 'text-primary' : 'text-textMuted'}`}>
                            {editingAgent?.suggest_in_onboarding ? <ToggleRight size={36} /> : <ToggleLeft size={36} />}
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
                       
                       {/* Curated/Global List */}
                       <div className="pt-4 border-t border-border">
                         <h4 className="text-textMain font-bold text-sm mb-3">Global Accessory Collection</h4>
                         <div className="grid grid-cols-4 gap-2">
                            {Object.keys(globalAccessories.items || {}).map(path => {
                               const isAttached = editingAgent?.accessories?.includes(path);
                               return (
                                 <button 
                                   key={path}
                                   title={path}
                                   onClick={() => {
                                      const current = editingAgent?.accessories || [];
                                      if (isAttached) {
                                         setEditingAgent({ ...editingAgent, accessories: current.filter((p: string) => p !== path) });
                                      } else {
                                         setEditingAgent({ ...editingAgent, accessories: [...current, path] });
                                      }
                                   }}
                                   className={`aspect-square rounded-lg border-2 overflow-hidden transition-all duration-200 ${isAttached ? 'border-primary ring-2 ring-primary/20 shadow-md scale-105 relative z-10' : 'border-black/5 hover:border-black/20'}`}
                                 >
                                    <img src={`http://localhost:3001${path}`} alt="accessory" className="w-full h-full object-contain p-1" />
                                    {isAttached && <span className="absolute bottom-1 right-1 w-2 h-2 rounded-full bg-primary" />}
                                 </button>
                               );
                            })}
                         </div>
                       </div>
                    </div>
                  )}

                  {activeTab === 'knowledge' && (
                    <div className="space-y-8 animate-fade-in">
                       <div className="space-y-3">
                         <label className="text-sm font-bold text-textMain">Search & Add Books to Knowledge Base</label>
                         <p className="text-xs text-textMuted mb-2">Books added here will be saved to the global library and automatically tagged for {editingAgent?.id}.</p>
                         <BookSearch onAdd={async (newBooks) => {
                           // Inject the current editingAgent.id into the recommendedAgents array
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
                             await fetch('http://localhost:3001/api/library', {
                               method: 'POST',
                               headers: { 'Content-Type': 'application/json' },
                               body: JSON.stringify(finalLibrary)
                             });
                             setGlobalLibrary(finalLibrary);
                           } catch(err) {
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
                                     // Remove tag
                                     const updatedLibrary = globalLibrary.map(b => {
                                        if (b.key === book.key) {
                                           return { ...b, recommendedAgents: b.recommendedAgents.filter((a: string) => a !== editingAgent.id) };
                                        }
                                        return b;
                                     });
                                     setGlobalLibrary(updatedLibrary);
                                     try {
                                       await fetch('http://localhost:3001/api/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedLibrary) });
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

                <div className="p-5 border-t border-border bg-backgroundAlt/30 flex justify-end gap-3 mt-auto">
                  <button onClick={closeModal} className="px-5 py-2.5 rounded-xl text-sm font-bold text-textMuted hover:bg-white hover:shadow-sm border border-transparent">Cancel</button>
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
