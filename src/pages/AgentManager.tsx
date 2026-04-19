import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Edit2, X, Link, Shield, BookOpen, ToggleRight, ToggleLeft } from 'lucide-react';
import RAW_AGENT_TYPE_INFO from '../../../shared/agents.json';

export default function AgentManager() {
  // Pre-fill with the local JSON file so they ALWAYS show up natively!
  const [rawJSON, setRawJSON] = useState<Record<string, any>>(RAW_AGENT_TYPE_INFO);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<any>(null);
  const [globalLibrary, setGlobalLibrary] = useState<any[]>([]);

  // Still attempt to fetch the absolute latest if the local server is running,
  // but if it fails, we safely fall back to the RAW import we already loaded.
  useEffect(() => {
    fetch('http://localhost:3001/api/agents')
      .then(res => res.json())
      .then(data => setRawJSON(data))
      .catch(err => console.warn("Local API server not running, using static JSON import.", err));

    fetch('http://localhost:3001/api/library')
      .then(res => res.json())
      .then(data => setGlobalLibrary(Array.isArray(data) ? data : []))
      .catch(err => console.warn("Could not load global library.", err));
  }, []);

  const agents = Object.entries(rawJSON).map(([key, val]) => ({
    id: key,
    name: key, // Using the key as Name
    role: val.description,
    image: val.image || 'https://images.unsplash.com/photo-1544377193-33dce4d95d0c?q=80&w=250&auto=format&fit=crop&sepia=1',
    library: val.library || [], 
    permissions: val.permissions || { calendar: true, files: true, web: true, email: false }, 
    status: val.suggest_in_onboarding ? 'Active' : 'Archived',
    suggest_in_onboarding: val.suggest_in_onboarding ?? true,
    color: val.color || '#218380',
    robeColor: val.robeColor || '#218380',
    manual_order: val.manual_order,
    popularity: val.popularity || 0,
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
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setEditingAgent(null);
    setIsModalOpen(false);
  };

  const handleSave = async () => {
    if (!editingAgent) return;
    const newJSON = { ...rawJSON };
    // Update the specific agent
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
      popularity: editingAgent.popularity
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
      setRawJSON(newJSON); // Update UI anyway so user sees it locally
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
              className="group bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all flex flex-col border border-border h-full"
            >
            <div className={`h-64 w-full overflow-hidden relative flex items-center justify-center`} style={{ backgroundColor: agent.habitatColor || '#D6A3B9' }}>
               <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent z-10" />
              {agent.image ? (
                 <img src={agent.image} alt={agent.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 relative z-0" />
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
              <div className="flex justify-end items-start mb-2">
                <div className="flex gap-1">
                  <button onClick={() => openModal(agent)} className="p-2 text-textMuted hover:text-primary hover:bg-primary/10 rounded-lg transition-colors">
                    <Edit2 size={16} />
                  </button>
                </div>
              </div>
              <p className="text-textMuted text-sm font-medium mb-6 leading-relaxed line-clamp-2 text-center" title={agent.role}>{agent.role}</p>
              
              <div className={`mt-auto space-y-3`}>
                <div className="flex items-start gap-2">
                  <BookOpen size={16} className="text-primary mt-0.5 shrink-0" />
                  <div className="flex flex-wrap gap-1.5">
                    {agent.library.map((book: string, i: number) => (
                      <span key={i} className="text-xs px-2 py-1 bg-backgroundAlt border border-border rounded-lg text-textMuted font-medium">
                        {book}
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

      {/* Editor Modal */}
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
              className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl z-10 overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="flex items-center justify-between p-6 border-b border-border bg-backgroundAlt/50">
                <h2 className="text-2xl font-bold text-textMain">{editingAgent?.id ? 'Edit Template' : 'New Template'}</h2>
                <button onClick={closeModal} className="text-textMuted hover:text-textMain hover:bg-border p-2 rounded-full transition-colors">
                  <X size={20} className="stroke-[3px]" />
                </button>
              </div>
              
              <div className="p-8 overflow-y-auto space-y-8">
                
                {/* SUGGEST IN ONBOARDING TOGGLE */}
                <div className="flex items-center justify-between bg-primary/5 border border-primary/20 p-5 rounded-2xl">
                  <div>
                    <h4 className="text-textMain font-bold text-lg">Suggest in Onboarding</h4>
                    <p className="text-textMuted text-sm font-medium mt-1">Should this agent appear in the universe of initial lobster roles?</p>
                  </div>
                  <button 
                    onClick={() => setEditingAgent({ ...editingAgent, suggest_in_onboarding: !editingAgent.suggest_in_onboarding })}
                    className={`transition-colors ${editingAgent?.suggest_in_onboarding ? 'text-primary' : 'text-textMuted'}`}
                  >
                    {editingAgent?.suggest_in_onboarding ? <ToggleRight size={44} /> : <ToggleLeft size={44} />}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="col-span-2 sm:col-span-1 space-y-2">
                    <label className="text-sm font-bold text-textMain">Agent Name</label>
                    <input 
                      type="text" 
                      value={editingAgent?.id || ''} 
                      readOnly
                      className="w-full bg-background border border-border rounded-xl px-4 py-3 text-textMuted font-medium opacity-70 cursor-not-allowed" 
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-1 space-y-2">
                    <label className="text-sm font-bold text-textMain">Role Description</label>
                    <input 
                      type="text" 
                      value={editingAgent?.role || ''} 
                      onChange={(e) => setEditingAgent({ ...editingAgent, role: e.target.value })}
                      className="w-full bg-white border border-border rounded-xl px-4 py-3 text-textMain font-medium focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow" 
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold text-textMain">Avatar Image URL (Optional)</label>
                  <div className="flex gap-2">
                    <button className="bg-backgroundAlt border border-border p-3 rounded-xl text-textMuted hover:text-textMain transition-colors">
                      <Link size={20} />
                    </button>
                    <input 
                      type="text" 
                      value={editingAgent?.image || ''} 
                      onChange={(e) => setEditingAgent({ ...editingAgent, image: e.target.value })}
                      placeholder="https://..." 
                      className="flex-1 bg-white border border-border rounded-xl px-4 py-3 text-textMain font-medium focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow" 
                    />
                  </div>
                </div>

                <div className="space-y-4 pt-6 border-t border-border">
                  <div>
                    <h4 className="text-textMain font-bold text-lg">Aesthetics & 3D Parameters</h4>
                    <p className="text-textMuted text-sm font-medium mt-1">Configure dynamically rendered properties for the 3D generation flow.</p>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-textMain uppercase tracking-wide">Base Color</label>
                      <div className="flex gap-2">
                        <input type="color" value={editingAgent?.color || '#000000'} onChange={(e) => setEditingAgent({ ...editingAgent, color: e.target.value })} className="w-8 h-8 rounded border border-border p-0.5 cursor-pointer" />
                        <input type="text" value={editingAgent?.color || ''} onChange={(e) => setEditingAgent({ ...editingAgent, color: e.target.value })} className="flex-1 bg-white border border-border rounded-lg px-2 text-xs font-medium focus:outline-none" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-textMain uppercase tracking-wide">Robe Color</label>
                      <div className="flex gap-2">
                        <input type="color" value={editingAgent?.robeColor || '#000000'} onChange={(e) => setEditingAgent({ ...editingAgent, robeColor: e.target.value })} className="w-8 h-8 rounded border border-border p-0.5 cursor-pointer" />
                        <input type="text" value={editingAgent?.robeColor || ''} onChange={(e) => setEditingAgent({ ...editingAgent, robeColor: e.target.value })} className="flex-1 bg-white border border-border rounded-lg px-2 text-xs font-medium focus:outline-none" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-textMain uppercase tracking-wide">Accent Color</label>
                      <div className="flex gap-2">
                        <input type="color" value={editingAgent?.accentColor || '#000000'} onChange={(e) => setEditingAgent({ ...editingAgent, accentColor: e.target.value })} className="w-8 h-8 rounded border border-border p-0.5 cursor-pointer" />
                        <input type="text" value={editingAgent?.accentColor || ''} onChange={(e) => setEditingAgent({ ...editingAgent, accentColor: e.target.value })} className="flex-1 bg-white border border-border rounded-lg px-2 text-xs font-medium focus:outline-none" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-textMain uppercase tracking-wide">Habitat Color</label>
                      <div className="flex gap-2">
                        <input type="color" value={editingAgent?.habitatColor || '#000000'} onChange={(e) => setEditingAgent({ ...editingAgent, habitatColor: e.target.value })} className="w-8 h-8 rounded border border-border p-0.5 cursor-pointer" />
                        <input type="text" value={editingAgent?.habitatColor || ''} onChange={(e) => setEditingAgent({ ...editingAgent, habitatColor: e.target.value })} className="flex-1 bg-white border border-border rounded-lg px-2 text-xs font-medium focus:outline-none" />
                      </div>
                    </div>
                    <div className="space-y-1 col-span-2">
                      <label className="text-xs font-bold text-textMain uppercase tracking-wide">Habitat Label</label>
                      <input type="text" value={editingAgent?.habitatLabel || ''} onChange={(e) => setEditingAgent({ ...editingAgent, habitatLabel: e.target.value })} className="w-full bg-white border border-border rounded-lg px-3 py-1.5 text-xs font-medium focus:outline-none" />
                    </div>
                  </div>
                </div>

                {/* RANKING & POPULARITY SECTION */}
                <div className="space-y-4 pt-6 border-t border-border">
                  <div>
                    <h4 className="text-textMain font-bold text-lg">Presentation Tuning</h4>
                    <p className="text-textMuted text-sm font-medium mt-1">Control how this agent ranks among others when ordering is applied.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-textMain uppercase tracking-wide">Manual Rank (1 = First)</label>
                      <input type="number" value={editingAgent?.manual_order ?? ''} onChange={(e) => setEditingAgent({ ...editingAgent, manual_order: e.target.value === '' ? null : parseInt(e.target.value) })} className="w-full bg-white border border-border rounded-lg px-3 py-2 text-sm font-medium focus:outline-none" placeholder="None" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-textMain uppercase tracking-wide">Popularity Score</label>
                      <input type="number" value={editingAgent?.popularity ?? 0} onChange={(e) => setEditingAgent({ ...editingAgent, popularity: e.target.value === '' ? 0 : parseInt(e.target.value) })} className="w-full bg-white border border-border rounded-lg px-3 py-2 text-sm font-medium focus:outline-none" />
                    </div>
                  </div>
                </div>

                {/* KNOWLEDGE LIBRARY STRATEGY SECTION */}
                <div className="space-y-4 pt-6 border-t border-border">
                  <div>
                    <h4 className="text-textMain font-bold text-lg">Agent Library & Knowledge</h4>
                    <p className="text-textMuted text-sm font-medium mt-1">Specify which books the agent has read to inform its personality and skills.</p>
                  </div>
                  
                  <div className="space-y-3">
                    <label className="text-sm font-bold text-textMain">Curated Public Domain Books</label>
                    
                    {/* Map over global library from api instead of mock */}
                    {globalLibrary.map(book => {
                       const isInLibrary = editingAgent?.library?.find((b: any) => b.title === book.title);
                       return (
                         <div key={book.title} className={`p-4 border rounded-xl flex items-center justify-between ${isInLibrary ? 'border-primary bg-primary/5' : 'border-border bg-white'}`}>
                           <div className="flex items-center gap-3">
                             <BookOpen size={20} className={isInLibrary ? 'text-primary' : 'text-textMuted'} />
                             <div>
                               <p className="font-bold text-textMain text-sm">{book.title}</p>
                               <p className="text-xs font-medium text-textMuted">{book.author}</p>
                             </div>
                           </div>
                           
                           {isInLibrary ? (
                             <div className="flex items-center gap-2">
                               <select 
                                 value={isInLibrary.mode}
                                 onChange={(e) => {
                                   const newLib = editingAgent.library.map((b: any) => b.title === book.title ? { ...b, mode: e.target.value } : b);
                                   setEditingAgent({ ...editingAgent, library: newLib });
                                 }}
                                 className="text-xs font-bold bg-white border border-border rounded-lg px-2 py-1 focus:outline-none"
                               >
                                 <option value="Cultural Reference">Cultural Reference (Summary)</option>
                                 <option value="Deep Expertise">Deep Expertise (Full Text RAG)</option>
                               </select>
                               <button 
                                 onClick={() => {
                                   setEditingAgent({ ...editingAgent, library: editingAgent.library.filter((b: any) => b.title !== book.title) })
                                 }}
                                 className="text-textMuted hover:text-[#D96C3B] p-1"
                               >
                                 <X size={16} />
                               </button>
                             </div>
                           ) : (
                             <button 
                               onClick={() => {
                                 const currentLib = editingAgent?.library || [];
                                 setEditingAgent({ ...editingAgent, library: [...currentLib, { title: book.title, author: book.author, mode: 'Cultural Reference' }] })
                               }}
                               className="text-sm font-bold text-primary hover:bg-primary/10 px-3 py-1.5 rounded-lg transition-colors"
                             >
                               Add to Shelf
                             </button>
                           )}
                         </div>
                       );
                    })}
                  </div>

                  {/* USER INTEGRATION (READWISE) */}
                  <div className="flex items-center justify-between bg-zinc-50 border border-border p-5 rounded-2xl mt-4">
                    <div className="flex gap-4 items-center">
                      <div className="bg-white p-2 rounded-xl border border-border shrink-0 shadow-sm">
                        <Link size={24} className="text-[#00A1FF]" />
                      </div>
                      <div>
                        <h4 className="text-textMain font-bold text-sm">Readwise Integration</h4>
                        <p className="text-textMuted text-xs font-medium mt-1">Connect user's personal highlights and notes directly to agent context.</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => setEditingAgent({ ...editingAgent, readwise_enabled: !editingAgent.readwise_enabled })}
                      className={`transition-colors ${editingAgent?.readwise_enabled ? 'text-primary' : 'text-textMuted'}`}
                    >
                      {editingAgent?.readwise_enabled ? <ToggleRight size={36} /> : <ToggleLeft size={36} />}
                    </button>
                  </div>
                </div>

              </div>

              <div className="p-6 border-t border-border bg-backgroundAlt/30 flex justify-end gap-3 mt-auto">
                <button onClick={closeModal} className="px-6 py-3 rounded-xl text-sm font-bold text-textMuted hover:bg-white hover:shadow-sm border border-transparent transition-all">Cancel</button>
                <button onClick={handleSave} className="px-6 py-3 rounded-xl text-sm font-bold text-white bg-primary hover:bg-primaryHover shadow-lg shadow-primary/20 hover:shadow-primary/40 active:scale-95 transition-all">Save Template</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
