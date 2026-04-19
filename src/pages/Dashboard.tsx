import { useState, useEffect } from 'react';
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { motion } from 'framer-motion';
import { Users, Zap, BrainCircuit, Activity } from 'lucide-react';

export default function Dashboard() {
  const [stats, setStats] = useState<any>({ tokenUsageData: [], personaAdoptionData: [] });
  const [agents, setAgents] = useState<any>({});
  
  useEffect(() => {
    Promise.all([
      fetch('http://localhost:3001/api/stats').then(r => r.json()),
      fetch('http://localhost:3001/api/agents').then(r => r.json())
    ]).then(([statsData, agentsData]) => {
      setStats(statsData);
      setAgents(agentsData);
    }).catch(err => console.error("Could not fetch dashboard data", err));
  }, []);

  const totalAgentsCount = Object.keys(agents).length;
  const onboardingAgentsCount = Object.values(agents).filter((a: any) => a.suggest_in_onboarding !== false).length;
  
  const tokenUsageData = stats.tokenUsageData || [];
  const personaAdoptionData = stats.personaAdoptionData || [];

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-10"
    >
      <div>
        <h1 className="text-4xl font-extrabold tracking-tight text-textMain mb-2">Platform Overview</h1>
        <p className="text-textMuted font-medium text-lg">Blended usage and adoption statistics across all Canopy environments.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard icon={Users} label="Total Universe Roles" value={totalAgentsCount.toString()} info={`${onboardingAgentsCount} in onboarding`} />
        <MetricCard icon={Activity} label="Active Agents / Day" value="8,193" trend="+5.4%" />
        <MetricCard icon={Zap} label="Avg Token Usage / Day" value="2.4M" trend="+22.1%" />
        <MetricCard icon={BrainCircuit} label="Top Requested Persona" value={personaAdoptionData[0]?.name || '...'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Token Usage Chart */}
        <div className="col-span-2 bg-white border border-[#D9CFC4] rounded-3xl p-8 shadow-sm">
          <h3 className="text-xl font-bold text-textMain mb-8">Total Daily Output Tokens</h3>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={tokenUsageData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorTokens" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#218380" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#218380" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(33,131,128,0.1)" />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#4A5568', fontSize: 13, fontWeight: 500 }} dy={10} />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#4A5568', fontSize: 13, fontWeight: 500 }} 
                  tickFormatter={(val) => `${val / 1000000}M`}
                  dx={-10}
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#ffffff', borderColor: '#D9CFC4', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.06)' }}
                  itemStyle={{ color: '#218380', fontWeight: 'bold' }}
                  labelStyle={{ color: '#2D3436', marginBottom: '4px', fontWeight: 'bold' }}
                />
                <Area type="monotone" dataKey="tokens" stroke="#218380" strokeWidth={3} fillOpacity={1} fill="url(#colorTokens)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Most Popular Personas */}
        <div className="col-span-1 bg-white border border-[#D9CFC4] rounded-3xl p-8 shadow-sm flex flex-col">
          <h3 className="text-xl font-bold text-textMain mb-8">Most Popular Personas</h3>
          <div className="flex-1 min-h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={personaAdoptionData} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="rgba(33,131,128,0.1)" />
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fill: '#4A5568', fontSize: 14, fontWeight: 600 }} />
                <Tooltip 
                  cursor={{ fill: 'rgba(33,131,128,0.05)' }}
                  contentStyle={{ backgroundColor: '#ffffff', borderColor: '#D9CFC4', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.06)' }}
                />
                <Bar dataKey="count" fill="#218380" radius={[0, 6, 6, 0]} barSize={24} />
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
