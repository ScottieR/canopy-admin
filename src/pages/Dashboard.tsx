import { useState, useEffect } from 'react';
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { motion } from 'framer-motion';
import { Users, Zap, BrainCircuit, Activity } from 'lucide-react';

export default function Dashboard() {
  const [stats, setStats] = useState<any>({ 
    tokenUsageData: [], 
    personaAdoptionData: { usage: [], downloads: [] },
    activeAgentsDaily: 0
  });
  const [agents, setAgents] = useState<any>({});
  const [popularityMetric, setPopularityMetric] = useState<'usage' | 'downloads'>('usage');
  
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    Promise.all([
      fetch('/api/stats').then(r => {
        if (!r.ok) throw new Error("Canopy DB Unreachable");
        return r.json();
      }),
      fetch('/api/agents').then(r => r.json())
    ]).then(([statsData, agentsData]) => {
      setStats(statsData);
      setAgents(agentsData);
      setError(null);
    }).catch(err => {
      console.error("Could not fetch dashboard data", err);
      setError(err.message);
    });
  }, []);

  const totalAgentsCount = Object.keys(agents).length;
  const onboardingAgentsCount = Object.values(agents).filter((a: any) => a.suggest_in_onboarding !== false).length;
  
  const tokenUsageData = stats.tokenUsageData || [];
  const personaAdoptionData = stats.personaAdoptionData?.[popularityMetric] || [];

  // Calculate real metrics from stats
  const activeAgentsCount = stats.activeAgentsDaily || 0;
  
  // Calculate average daily tokens
  const latestUsage = tokenUsageData[tokenUsageData.length - 1] || {};
  const totalTokensLatest = 
    (latestUsage.google || 0) + 
    (latestUsage.openai || 0) + 
    (latestUsage.anthropic || 0) + 
    (latestUsage.xai || 0) + 
    (latestUsage.other || 0);
  
  const formatTokens = (val: number) => {
    if (val >= 1000000) return (val / 1000000).toFixed(1) + 'M';
    if (val >= 1000) return (val / 1000).toFixed(1) + 'k';
    return val.toString();
  };
  
  const avgTokens = formatTokens(totalTokensLatest);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-10"
    >
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-4xl font-extrabold tracking-tight text-textMain">Platform Overview</h1>
            <div className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-widest ${error ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
              {error ? 'Offline' : 'Live Database'}
            </div>
          </div>
          <p className="text-textMuted font-medium text-lg">Real-time usage telemetry from your local Canopy installation.</p>
        </div>
        {stats.lastSync && (
          <div className="text-right">
            <p className="text-[10px] font-bold text-textMuted uppercase tracking-widest mb-1">Last Synchronized</p>
            <p className="text-sm font-mono font-bold text-textMain">{new Date(stats.lastSync).toLocaleTimeString()}</p>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-700 text-sm font-medium flex items-center gap-3">
          <Activity size={18} />
          {error}: Ensure Canopy is installed and has been used today.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard icon={Users} label="Total Agents Active" value={(stats.totalAgentsActive || 0).toString()} info={`${stats.totalAgentsCreated || 0} total created`} />
        <MetricCard icon={Activity} label="Active Agents / Day" value={activeAgentsCount.toLocaleString()} />
        <MetricCard icon={Zap} label="Tokens (Last 24h)" value={avgTokens} />
        <MetricCard icon={BrainCircuit} label="Top Persona" value={personaAdoptionData[0]?.name || 'None'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Token Usage Chart */}
        <div className="col-span-2 bg-white border border-[#D9CFC4] rounded-3xl p-8 shadow-sm">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-xl font-bold text-textMain">Token Output by Provider</h3>
            <div className="flex flex-wrap gap-4 text-[10px] sm:text-xs font-bold uppercase tracking-wider">
              <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-[#4285F4]" /> Google</div>
              <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-[#10a37f]" /> OpenAI</div>
              <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-[#D97757]" /> Anthropic</div>
              <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-[#000000]" /> xAI</div>
              <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-[#94A3B8]" /> Other</div>
            </div>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={tokenUsageData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorGoogle" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#4285F4" stopOpacity={0.3}/><stop offset="95%" stopColor="#4285F4" stopOpacity={0}/></linearGradient>
                  <linearGradient id="colorOpenAI" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10a37f" stopOpacity={0.3}/><stop offset="95%" stopColor="#10a37f" stopOpacity={0}/></linearGradient>
                  <linearGradient id="colorAnthropic" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#D97757" stopOpacity={0.3}/><stop offset="95%" stopColor="#D97757" stopOpacity={0}/></linearGradient>
                  <linearGradient id="colorXAI" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#000000" stopOpacity={0.3}/><stop offset="95%" stopColor="#000000" stopOpacity={0}/></linearGradient>
                  <linearGradient id="colorOther" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#94A3B8" stopOpacity={0.3}/><stop offset="95%" stopColor="#94A3B8" stopOpacity={0}/></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(33,131,128,0.1)" />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#4A5568', fontSize: 13, fontWeight: 500 }} dy={10} />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#4A5568', fontSize: 13, fontWeight: 500 }} 
                  tickFormatter={(val) => val >= 1000 ? `${val/1000}k` : val}
                  dx={-10}
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#ffffff', borderColor: '#D9CFC4', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.06)' }}
                  itemStyle={{ fontWeight: 'bold' }}
                  labelStyle={{ color: '#2D3436', marginBottom: '4px', fontWeight: 'bold' }}
                />
                <Area type="monotone" dataKey="google" stackId="1" stroke="#4285F4" strokeWidth={2} fillOpacity={1} fill="url(#colorGoogle)" />
                <Area type="monotone" dataKey="openai" stackId="1" stroke="#10a37f" strokeWidth={2} fillOpacity={1} fill="url(#colorOpenAI)" />
                <Area type="monotone" dataKey="anthropic" stackId="1" stroke="#D97757" strokeWidth={2} fillOpacity={1} fill="url(#colorAnthropic)" />
                <Area type="monotone" dataKey="xai" stackId="1" stroke="#000000" strokeWidth={2} fillOpacity={1} fill="url(#colorXAI)" />
                <Area type="monotone" dataKey="other" stackId="1" stroke="#94A3B8" strokeWidth={2} fillOpacity={1} fill="url(#colorOther)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Most Popular Personas */}
        <div className="col-span-1 bg-white border border-[#D9CFC4] rounded-3xl p-8 shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-xl font-bold text-textMain">Persona Popularity</h3>
            <div className="flex bg-backgroundAlt p-1 rounded-xl border border-border">
              <button 
                onClick={() => setPopularityMetric('usage')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${popularityMetric === 'usage' ? 'bg-white shadow-sm text-primary' : 'text-textMuted hover:text-textMain'}`}
              >
                Usage
              </button>
              <button 
                onClick={() => setPopularityMetric('downloads')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${popularityMetric === 'downloads' ? 'bg-white shadow-sm text-primary' : 'text-textMuted hover:text-textMain'}`}
              >
                Setups
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={personaAdoptionData} margin={{ top: 0, right: 20, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="rgba(33,131,128,0.1)" />
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fill: '#4A5568', fontSize: 13, fontWeight: 600 }} width={100} />
                <Tooltip 
                  cursor={{ fill: 'rgba(33,131,128,0.05)' }}
                  contentStyle={{ backgroundColor: '#ffffff', borderColor: '#D9CFC4', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.06)' }}
                />
                <Bar dataKey="count" fill="#218380" radius={[0, 6, 6, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
function MetricCard({ icon: Icon, label, value, trend, info }: any) {
  return (
    <div className="bg-white border border-[#D9CFC4] rounded-3xl p-6 shadow-sm hover:shadow-md hover:-translate-y-1 transition-all duration-300">
      <div className="flex items-start justify-between mb-4">
        <div className="w-12 h-12 rounded-2xl bg-backgroundAlt flex items-center justify-center border border-border">
          <Icon size={24} className="text-primary" />
        </div>
        {trend && (
          <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${trend.startsWith('+') ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
            {trend}
          </span>
        )}
      </div>
      <div>
        <p className="text-textMuted text-sm font-bold mb-1 uppercase tracking-wide">{label}</p>
        <div className="flex items-baseline gap-2">
          <h4 className="text-3xl font-extrabold text-textMain">{value}</h4>
          {info && <span className="text-sm font-medium text-textMuted">{info}</span>}
        </div>
      </div>
    </div>
  );
}
