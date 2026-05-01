import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FileText, Save, Plus, Trash2, Lightbulb, UserCheck, MessageSquare, Briefcase } from 'lucide-react';

interface TemplateFile {
  filename: string;
  content: string;
}

export default function AgentFilesManager() {
  const [settings, setSettings] = useState<any>({});
  const [templates, setTemplates] = useState<TemplateFile[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetch('http://localhost:3001/api/settings')
      .then(r => r.json())
      .then(data => {
        if (Object.keys(data).length > 0) {
          setSettings(data);
          
          // Migration from old single userTemplate string
          if (data.agentTemplates && Array.isArray(data.agentTemplates)) {
             setTemplates(data.agentTemplates);
          } else if (data.userTemplate) {
             setTemplates([{ filename: 'user.md', content: data.userTemplate }]);
          } else {
             setTemplates([{ filename: 'user.md', content: '' }]);
          }
        }
      })
      .catch(err => console.error("Could not fetch settings", err));
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const newSettings = { ...settings, agentTemplates: templates };
      // Clean up old userTemplate if it exists to keep settings.json tidy
      delete newSettings.userTemplate;
      
      await fetch('http://localhost:3001/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings)
      });
      setTimeout(() => setIsSaving(false), 500);
    } catch(err) {
      console.error(err);
      setIsSaving(false);
    }
  };

  const addFile = () => {
    const newFile = { filename: `new_file_${templates.length + 1}.md`, content: '' };
    setTemplates([...templates, newFile]);
    setActiveIndex(templates.length);
  };

  const removeFile = (idx: number) => {
    if (templates.length <= 1) return alert("Must have at least one template file.");
    const next = [...templates];
    next.splice(idx, 1);
    setTemplates(next);
    if (activeIndex >= next.length) setActiveIndex(Math.max(0, next.length - 1));
  };

  const updateFile = (field: 'filename' | 'content', value: string) => {
    const next = [...templates];
    next[activeIndex][field] = value;
    setTemplates(next);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-textMain mb-2">Default Agent Files</h1>
          <p className="text-textMuted font-medium text-lg">Manage default templates that are seeded into each new agent's workspace.</p>
        </div>
        <button 
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2 bg-primary hover:bg-primaryHover text-white px-6 py-3 rounded-xl font-bold transition-all shadow-lg shadow-primary/30 active:scale-95 disabled:opacity-75"
        >
          <Save size={20} className={`stroke-[3px] ${isSaving ? 'animate-pulse' : ''}`} />
          {isSaving ? 'Saving...' : 'Save Templates'}
        </button>
      </div>

      <div className="flex gap-8 items-start">
        
        {/* LEFT PANE: Editor */}
        <div className="flex-1 bg-white border border-outline-variant/30 rounded-3xl overflow-hidden shadow-sm flex h-[700px]">
           {/* Sidebar File List */}
           <div className="w-64 bg-surface border-r border-outline-variant/30 flex flex-col">
              <div className="p-4 border-b border-outline-variant/30 flex justify-between items-center bg-white/50">
                 <span className="font-bold text-xs uppercase tracking-wider text-textMuted">Templates</span>
                 <button onClick={addFile} className="p-1.5 hover:bg-black/5 rounded-md text-textMain transition"><Plus size={16}/></button>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                 {templates.map((t, idx) => (
                   <div 
                     key={idx}
                     onClick={() => setActiveIndex(idx)}
                     className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors text-sm font-medium ${idx === activeIndex ? "bg-primary/10 text-primary" : "text-textMuted hover:bg-black/5 hover:text-textMain"}`}
                   >
                     <FileText size={16} className={idx === activeIndex ? "text-primary" : "text-textMuted/50"} />
                     <span className="truncate flex-1">{t.filename}</span>
                   </div>
                 ))}
              </div>
           </div>

           {/* Main Editor */}
           {templates[activeIndex] && (
             <div className="flex-1 flex flex-col bg-background">
                <div className="p-4 border-b border-outline-variant/30 flex items-center justify-between bg-white/50">
                   <div className="flex items-center gap-3 w-1/2">
                      <FileText className="text-textMuted" size={20} />
                      <input 
                        type="text" 
                        value={templates[activeIndex].filename}
                        onChange={(e) => updateFile('filename', e.target.value)}
                        className="bg-transparent border-none outline-none font-bold text-lg text-textMain w-full"
                        placeholder="filename.md"
                      />
                   </div>
                   <button onClick={() => removeFile(activeIndex)} className="text-error/70 hover:text-error hover:bg-error/10 p-2 rounded-lg transition-colors flex items-center gap-2 text-sm font-bold">
                     <Trash2 size={16} /> Delete
                   </button>
                </div>
                <textarea 
                  value={templates[activeIndex].content}
                  onChange={(e) => updateFile('content', e.target.value)}
                  className="flex-1 w-full bg-transparent border-none p-6 text-textMain focus:outline-none resize-none font-mono text-sm leading-relaxed"
                  placeholder="Enter markdown content here..."
                />
             </div>
           )}
        </div>

        {/* RIGHT PANE: Prompting Tips */}
        <div className="w-80 shrink-0 space-y-4">
           <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-100 rounded-3xl p-6 shadow-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="bg-indigo-600 text-white p-2 rounded-xl"><Lightbulb size={20} /></div>
                <h3 className="font-bold text-indigo-900 text-lg">Prompting Tips</h3>
              </div>
              <p className="text-sm text-indigo-800/80 mb-6 font-medium leading-relaxed">
                Insights from Claire Vo's "How I AI" podcast to help you craft better default templates.
              </p>

              <div className="space-y-5">
                 <div className="bg-white/60 rounded-xl p-4 border border-white/40 shadow-sm">
                    <h4 className="font-bold text-indigo-900 text-sm flex items-center gap-2 mb-2"><Briefcase size={14} className="text-indigo-500" /> Context Libraries</h4>
                    <p className="text-xs text-indigo-800/70 leading-relaxed">
                      Pre-load the agent with "lazy prompting" files. Feed it recent reading lists, project specs, or language preferences so you don't have to repeat yourself in the chat.
                    </p>
                 </div>

                 <div className="bg-white/60 rounded-xl p-4 border border-white/40 shadow-sm">
                    <h4 className="font-bold text-indigo-900 text-sm flex items-center gap-2 mb-2"><UserCheck size={14} className="text-indigo-500" /> Assign a Persona</h4>
                    <p className="text-xs text-indigo-800/70 leading-relaxed">
                      Explicitly define *who* the agent is. "Act as a senior product manager" shapes the tone and depth of the output significantly better than a generic prompt.
                    </p>
                 </div>

                 <div className="bg-white/60 rounded-xl p-4 border border-white/40 shadow-sm">
                    <h4 className="font-bold text-indigo-900 text-sm flex items-center gap-2 mb-2"><MessageSquare size={14} className="text-indigo-500" /> High-Bandwidth "Yapping"</h4>
                    <p className="text-xs text-indigo-800/70 leading-relaxed">
                      Treat the agent like a real employee. Write templates that instruct the agent to extract intent from your messy voice notes or "rambling" rather than requiring perfect instructions.
                    </p>
                 </div>
              </div>
           </div>
        </div>

      </div>
    </motion.div>
  );
}
