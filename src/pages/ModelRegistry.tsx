import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Trash2, Zap, Scale } from 'lucide-react';

export default function ModelRegistry() {
  const [modelsData, setModelsData] = useState({ models: [], strategies: {} });
  const [isSyncing, setIsSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState('all');

  useEffect(() => {
    fetchModels();
  }, []);

  const fetchModels = () => {
    fetch('/api/models')
      .then(res => res.json())
      .then(data => {
        if (data.models) setModelsData(data);
      })
      .catch(err => console.error("Could not fetch models:", err));
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch('/api/sync-models', { method: 'POST' });
      await res.json();
      fetchModels();
    } catch (e) {
      console.error(e);
    }
    setTimeout(() => setIsSyncing(false), 800);
  };

  const handleRemove = (modelId: string) => {
    const updated = {
       ...modelsData, 
       models: modelsData.models.filter((m: any) => m.id !== modelId)
    };
    setModelsData(updated);
    fetch('/api/models', {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated)
    });
  };

  const providersList = [...new Set(modelsData.models.map((m: any) => m.provider))];
  const displayModels = activeTab === 'all' 
    ? modelsData.models 
    : modelsData.models.filter((m: any) => m.provider === activeTab);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
      
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-textMain mb-2">Model Registry</h1>
          <p className="text-textMuted font-medium text-lg max-w-2xl">
            Live catalog of dynamically synced foundation models currently accessible by routers.
          </p>
        </div>
        <button 
          onClick={handleSync}
          disabled={isSyncing}
          className="flex items-center gap-2 bg-[#F3F0EA] border border-[#D9CFC4] text-textMain hover:bg-white px-5 py-3 rounded-xl font-bold transition-all shadow-sm active:scale-95 disabled:opacity-50"
        >
          <RefreshCw size={18} className={`text-primary ${isSyncing ? 'animate-spin' : ''}`} />
          {isSyncing ? 'Syncing APIs...' : 'Sync Provider Endpoints'}
        </button>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-3 gap-6">
        <div className="bg-white border border-[#D9CFC4] p-6 rounded-3xl shadow-sm">
          <p className="text-sm font-bold text-textMuted uppercase tracking-wider mb-1">Total Verified Models</p>
          <p className="text-4xl font-black text-textMain">{modelsData.models.length}</p>
        </div>
        <div className="bg-white border border-[#D9CFC4] p-6 rounded-3xl shadow-sm">
          <p className="text-sm font-bold text-textMuted uppercase tracking-wider mb-1">Default Light Model</p>
          <p className="text-2xl font-bold text-primary mt-1">{(modelsData.strategies as any)?.defaultLightModel || "---"}</p>
        </div>
        <div className="bg-white border border-[#D9CFC4] p-6 rounded-3xl shadow-sm">
          <p className="text-sm font-bold text-textMuted uppercase tracking-wider mb-1">Default Heavy Model</p>
          <p className="text-2xl font-bold text-primary mt-1">{(modelsData.strategies as any)?.defaultHeavyModel || "---"}</p>
        </div>
      </div>

      {/* Provider Tabs */}
      <div className="flex items-center gap-2 border-b border-[#D9CFC4] pb-4">
        <button onClick={() => setActiveTab('all')} className={`px-4 py-2 font-bold rounded-lg transition-colors ${activeTab === 'all' ? 'bg-primary text-white' : 'text-textMuted hover:bg-black/5'}`}>All Providers</button>
        {providersList.map((prov: any) => (
           <button key={prov} onClick={() => setActiveTab(prov)} className={`px-4 py-2 font-bold rounded-lg transition-colors ${activeTab === prov ? 'bg-primary text-white' : 'text-textMuted hover:bg-black/5'}`}>
             {prov}
           </button>
        ))}
      </div>

      {/* Model Table List */}
      <div className="space-y-4">
        {displayModels.map((model: any) => (
          <motion.div layout key={model.id} className="bg-white border border-[#D9CFC4] p-5 rounded-2xl shadow-sm flex items-center justify-between group hover:border-primary/30 transition-colors">
            
            <div className="flex items-center gap-5 w-1/3">
               <div className={`p-3 rounded-xl border ${model.strategy === 'heavy' ? 'bg-purple-50 border-purple-200 text-purple-600' : 'bg-blue-50 border-blue-200 text-blue-600'}`}>
                 {model.strategy === 'heavy' ? <Scale size={24}/> : <Zap size={24} />}
               </div>
               <div>
                 <h4 className="font-extrabold text-lg text-textMain">{model.name}</h4>
                 <div className="flex items-center gap-2 mt-1">
                   <span className="text-xs font-bold px-2 py-0.5 bg-black/5 rounded text-textMuted">{model.provider}</span>
                   <span className="text-xs font-mono text-textMuted/80 bg-background px-1.5 rounded border border-border">var: {model.rawVariable || model.id}</span>
                 </div>
               </div>
            </div>

            <div className="w-1/4 text-sm text-textMuted font-medium pr-8">
               <p className="truncate">{model.description}</p>
               <div className="flex items-center gap-2 mt-2">
                 {model.status === 'deprecated' && <span className="text-[10px] uppercase tracking-wider font-bold bg-[#ffeaea] text-[#C62828] px-2 py-0.5 rounded-full border border-[#C62828]/20">Deprecated</span>}
                 {model.status === 'preview' && <span className="text-[10px] uppercase tracking-wider font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full border border-amber-300/50">Preview</span>}
                 {model.status === 'stable' && <span className="text-[10px] uppercase tracking-wider font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full border border-emerald-300/50">Stable</span>}
               </div>
            </div>

            <div className="w-48 text-right space-y-1">
               <p className="text-xs font-bold text-textMuted">Cost (Per 1M)</p>
               <p className="text-sm font-semibold text-textMain">${model.costIn.toFixed(2)} IN / ${model.costOut.toFixed(2)} OUT</p>
            </div>

            <div className="flex items-center gap-2 ml-4 border-l border-[#D9CFC4] pl-4">
               <button onClick={() => handleRemove(model.id)} className="p-2 text-textMuted hover:bg-[#ffeaea] hover:text-[#C62828] rounded-lg transition-colors" title="Remove from Router">
                 <Trash2 size={20} />
               </button>
            </div>

          </motion.div>
        ))}
        {displayModels.length === 0 && (
          <div className="py-20 text-center text-textMuted font-medium bg-[#F3F0EA] rounded-2xl border border-dashed border-[#D9CFC4]">
            No supported models found. Please click Sync API.
          </div>
        )}
      </div>

    </motion.div>
  );
}
