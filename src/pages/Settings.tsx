import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Settings as SettingsIcon, Link, Shield, Globe, KeyRound } from 'lucide-react';

export default function Settings() {
  const [settings, setSettings] = useState({
    apiKeys: { openai: '', anthropic: '' },
    readwiseEnabled: false,
    globalModel: 'gpt-4o',
    systemPrefix: '',
    userTemplate: ''
  });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(data => {
        if (Object.keys(data).length > 0) setSettings(data);
      })
      .catch(err => console.error("Could not fetch settings", err));
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await fetch('/api/settings', {
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
          <h1 className="text-4xl font-extrabold tracking-tight text-textMain mb-2">Platform Settings</h1>
          <p className="text-textMuted font-medium text-lg">Manage global environment configurations and API keys.</p>
        </div>
        <button 
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2 bg-primary hover:bg-primaryHover text-white px-6 py-3 rounded-xl font-bold transition-all shadow-lg shadow-primary/30 active:scale-95 disabled:opacity-75"
        >
          <SettingsIcon size={20} className={`stroke-[3px] ${isSaving ? 'animate-spin' : ''}`} />
          {isSaving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      <div className="bg-white border border-[#D9CFC4] rounded-3xl p-8 shadow-sm max-w-4xl">
        <h3 className="text-xl font-bold text-textMain mb-6 flex items-center gap-2"><KeyRound className="text-primary"/> Provider API Keys</h3>
        
        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-bold text-textMain">OpenAI API Key</label>
            <input 
              type="password" 
              value={settings.apiKeys.openai || ''}
              onChange={(e) => setSettings({...settings, apiKeys: {...settings.apiKeys, openai: e.target.value}})}
              className="w-full bg-background border border-border rounded-xl px-4 py-3 text-textMain font-medium focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
              placeholder="sk-..."
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-bold text-textMain">Anthropic API Key</label>
            <input 
              type="password" 
              value={settings.apiKeys.anthropic || ''}
              onChange={(e) => setSettings({...settings, apiKeys: {...settings.apiKeys, anthropic: e.target.value}})}
              className="w-full bg-background border border-border rounded-xl px-4 py-3 text-textMain font-medium focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
              placeholder="sk-ant-..."
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl">
        <div className="bg-white border border-[#D9CFC4] rounded-3xl p-8 shadow-sm">
          <h3 className="text-xl font-bold text-textMain mb-6 flex items-center gap-2"><Globe className="text-primary"/> Global Defaults</h3>
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-bold text-textMain">Default Foundation Model</label>
              <select 
                value={settings.globalModel}
                onChange={(e) => setSettings({...settings, globalModel: e.target.value})}
                className="w-full bg-background border border-border rounded-xl px-4 py-3 text-textMain font-medium focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
              >
                <option value="gpt-4o">GPT-4 Omni</option>
                <option value="claude-3-5-sonnet">Claude 3.5 Sonnet</option>
                <option value="llama-3-70b">Llama 3 (70B)</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-bold text-textMain">System Prompt Prefix</label>
              <textarea 
                value={settings.systemPrefix}
                onChange={(e) => setSettings({...settings, systemPrefix: e.target.value})}
                className="w-full bg-background border border-border rounded-xl px-4 py-3 text-textMain font-medium focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow min-h-[100px]"
                placeholder="Prefix for all Canopy agents..."
              />
            </div>

          </div>
        </div>

        <div className="bg-white border border-[#D9CFC4] rounded-3xl p-8 shadow-sm max-h-fit">
          <h3 className="text-xl font-bold text-textMain mb-6 flex items-center gap-2"><Link className="text-primary"/> Integrations</h3>
          <div className="space-y-6">
            <div className="flex items-center justify-between bg-zinc-50 border border-border p-5 rounded-2xl">
              <div className="flex gap-4 items-center">
                <div className="bg-white p-2 rounded-xl border border-border shrink-0 shadow-sm">
                  <Shield size={24} className="text-[#00A1FF]" />
                </div>
                <div>
                  <h4 className="text-textMain font-bold text-sm">Readwise Connection</h4>
                  <p className="text-textMuted text-xs font-medium mt-1">Allow pulling local Readwise exports.</p>
                </div>
              </div>
              <input 
                type="checkbox"
                checked={settings.readwiseEnabled}
                onChange={(e) => setSettings({...settings, readwiseEnabled: e.target.checked})}
                className="w-5 h-5 accent-primary cursor-pointer"
              />
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
