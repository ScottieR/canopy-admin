import { useState, useEffect } from 'react';
import { Layers, Wand2 } from 'lucide-react';

export function ConnectorsManager() {
  const [connectors, setConnectors] = useState<any[]>([]);
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    fetch('/api/connectors')
      .then(res => res.json())
      .then(data => setConnectors(Array.isArray(data) ? data : []))
      .catch(console.error);
  }, []);

  const handleGenerate = async () => {
    if (!prompt) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/connectors/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });
      const newConnector = await res.json();
      if (newConnector.id) {
        setConnectors(prev => [...prev, newConnector]);
        setPrompt('');
      } else if (newConnector.error) {
        alert("Error: " + newConnector.error);
      }
    } catch (e) {
      console.error(e);
      alert('Failed to generate connector');
    }
    setGenerating(false);
  };

  const toggleVisibility = async (id: string) => {
    const next = connectors.map(c => c.id === id ? { ...c, isVisible: !c.isVisible } : c);
    setConnectors(next);
    await fetch('/api/connectors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next)
    });
  };

  return (
    <div className="p-8 max-w-5xl mx-auto text-gray-800">
      <div className="flex items-center gap-3 mb-8">
        <Layers size={32} className="text-teal-600" />
        <h1 className="text-3xl font-bold tracking-tight">Connectors</h1>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-8">
        <h2 className="text-lg font-bold mb-2 flex items-center gap-2"><Wand2 size={18} className="text-purple-500" /> Generate New Connector</h2>
        <p className="text-gray-500 text-sm mb-4">Describe the connector you want to build and the AI will scaffold the UI config and companion window automatically.</p>
        <div className="flex gap-4">
          <input
            type="text"
            className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-teal-500"
            placeholder="e.g. A connector for Notion that needs an API token..."
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleGenerate()}
          />
          <button 
            onClick={handleGenerate}
            disabled={generating || !prompt}
            className="bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-bold py-3 px-6 rounded-lg transition-colors"
          >
            {generating ? "Generating..." : "Generate"}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-50 border-b border-gray-100 text-sm text-gray-500">
            <tr>
              <th className="px-6 py-4 font-semibold">Connector</th>
              <th className="px-6 py-4 font-semibold">Scope</th>
              <th className="px-6 py-4 font-semibold">Visibility</th>
              <th className="px-6 py-4 font-semibold">Companion</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {connectors.map(c => (
              <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-6 py-4">
                  <div className="font-bold text-gray-800">{c.name}</div>
                  <div className="text-xs text-gray-500">{c.subtitle}</div>
                </td>
                <td className="px-6 py-4 text-sm">
                  {c.isGlobal ? <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs font-bold">Global</span> : <span className="bg-orange-100 text-orange-700 px-2 py-1 rounded text-xs font-bold">Per Agent</span>}
                </td>
                <td className="px-6 py-4">
                  <button 
                    onClick={() => toggleVisibility(c.id)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${c.isVisible ? 'bg-teal-500' : 'bg-gray-200'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${c.isVisible ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">
                  {c.needsCompanion ? "Required" : "None"}
                </td>
              </tr>
            ))}
            {connectors.length === 0 && (
              <tr><td colSpan={4} className="px-6 py-8 text-center text-gray-400">No connectors loaded.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
