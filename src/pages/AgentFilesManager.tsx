import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FileText, Save } from 'lucide-react';

export default function AgentFilesManager() {
  const [settings, setSettings] = useState<any>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetch('http://localhost:3001/api/settings')
      .then(r => r.json())
      .then(data => {
        if (Object.keys(data).length > 0) setSettings(data);
      })
      .catch(err => console.error("Could not fetch settings", err));
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await fetch('http://localhost:3001/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      setTimeout(() => setIsSaving(false), 500);
    } catch(err) {
      console.error(err);
      setIsSaving(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-10">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-textMain mb-2">Default Agent Files</h1>
          <p className="text-textMuted font-medium text-lg">Manage default templates that are loaded up with each new agent.</p>
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

      <div className="bg-white border border-[#D9CFC4] rounded-3xl p-8 shadow-sm max-w-5xl">
        <h3 className="text-xl font-bold text-textMain mb-6 flex items-center gap-2">
          <FileText className="text-primary"/> 
          User.md Base Template
        </h3>
        
        <div className="space-y-4">
          <p className="text-sm text-textMuted font-medium">
            This markdown text will be seeded into every new agent's workspace as <code>User.md</code>. 
            It is used to provide the agent with default context about the user.
          </p>
          <textarea 
            value={settings.userTemplate || ''}
            onChange={(e) => setSettings({...settings, userTemplate: e.target.value})}
            className="w-full bg-background border border-border rounded-xl px-4 py-4 text-textMain focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow min-h-[400px] font-mono text-sm leading-relaxed"
            placeholder="Default content for new agent USER.md files..."
          />
        </div>
      </div>
    </motion.div>
  );
}
