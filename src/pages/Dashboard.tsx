import { useState, useEffect } from 'react';
import { BarChart, Bar, AreaChart, Area, LineChart, Line, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { motion } from 'framer-motion';
import { Users, Zap, BrainCircuit, Activity, DollarSign, TrendingUp, GitBranch } from 'lucide-react';

// Retention/stickiness "healthy" reference lines. Canopy is closest to the
// "productivity app" category (workflow/agent-management tool used
// repeatedly, not a one-off utility). Sourced July 2026:
//  - Day-1/Day-30 productivity-app retention: Business of Apps, "App
//    Retention Rates (2026)" — https://www.businessofapps.com/data/app-retention-rates/
//    (productivity apps: ~17.1% D1, ~4.1% D30 category average; >6% D30 is
//    above-average, >10% D30 signals strong product-market fit).
//  - Day-7: no productivity-specific figure is published; using the
//    cross-category benchmark (~13%) as an approximate reference only.
//  - DAU/MAU stickiness: usedaymark.io "Product Stickiness (DAU/MAU Ratio)"
//    and Mixpanel's MAU benchmarks piece — SaaS average ~13%, >20% is
//    healthy for most SaaS, consumer productivity tools (Notion/Todoist-like)
//    target 30-40%.
// These are directional targets, not hard pass/fail lines — a young product's
// own week-over-week trend matters more than matching someone else's curve.
const DAILY_RETENTION_BENCHMARKS: Record<number, { healthy: number; avg: number; note?: string }> = {
  1: { healthy: 25, avg: 17.1 },
  7: { healthy: 20, avg: 13, note: 'cross-category reference — no productivity-specific D7 figure is published' },
  30: { healthy: 10, avg: 4.1 },
};
const MONTHLY_RETENTION_BENCHMARKS: Record<number, { healthy: number; avg: number; note?: string }> = {
  1: { healthy: 10, avg: 4.1, note: 'approximated from the D30 productivity benchmark — no published M1 figure' },
};
const STICKINESS_BENCHMARK = { needsWork: 13, healthy: 20, great: 30 };

export default function Dashboard() {
  const [stats, setStats] = useState<any>({
    tokenUsageData: [],
    personaAdoptionData: { usage: [], downloads: [] },
    activeAgentsDaily: 0,
    totalCostUsd: 0,
    installCount: 0,
    costByProvider: []
  });
  const [agents, setAgents] = useState<any>({});
  const [popularityMetric, setPopularityMetric] = useState<'usage' | 'downloads'>('usage');
  const [funnel, setFunnel] = useState<any>(null);
  const [retention, setRetention] = useState<any>(null);
  const [evalRuns, setEvalRuns] = useState<any[]>([]);
  const [onboardingConfig, setOnboardingConfig] = useState<any>(null);
  const [configSaveState, setConfigSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [dauMauWindow, setDauMauWindow] = useState<7 | 30 | 60>(30);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/stats').then(r => {
        if (!r.ok) throw new Error("Canopy DB Unreachable");
        return r.json();
      }),
      fetch('/api/agents').then(r => r.json()),
      // Funnel/retention are only meaningful once a global (Postgres) DB is
      // configured — 503 otherwise. Treat that as "no data yet", not an error.
      fetch('/api/stats/funnel').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/stats/retention').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/evals/runs?limit=15').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/onboarding-config').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([statsData, agentsData, funnelData, retentionData, evalsData, configData]) => {
      setStats(statsData);
      setAgents(agentsData);
      setFunnel(funnelData);
      setEvalRuns(evalsData?.runs || []);
      setOnboardingConfig(configData);
      setRetention(retentionData);
      setError(null);
    }).catch(err => {
      console.error("Could not fetch dashboard data", err);
      setError(err.message);
    });
  }, []);

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

  // Check if each provider has non-zero usage in the active dataset
  const hasGoogle = tokenUsageData.some((d: any) => (d.google || 0) > 0);
  const hasOpenAI = tokenUsageData.some((d: any) => (d.openai || 0) > 0);
  const hasAnthropic = tokenUsageData.some((d: any) => (d.anthropic || 0) > 0);
  const hasXai = tokenUsageData.some((d: any) => (d.xai || 0) > 0);
  const hasOther = tokenUsageData.some((d: any) => (d.other || 0) > 0);

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
              {error ? 'Offline' : (stats.source === 'global' ? 'Live — Global (Anonymized)' : 'Live Database')}
            </div>
          </div>
          <p className="text-textMuted font-medium text-lg">
            {stats.source === 'global'
              ? `Anonymized usage across ${(stats.installCount || 0).toLocaleString()} opted-in installs, last 7 days. No user or agent identifiers included.`
              : 'Real-time usage telemetry from your local Canopy installation.'}
          </p>
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
        {stats.source === 'global' ? (
          <>
            <MetricCard icon={Users} label="Installs Reporting" value={(stats.installCount || 0).toLocaleString()} info="opted-in, last 7 days" />
            <MetricCard icon={Activity} label="Active Installs / Day" value={activeAgentsCount.toLocaleString()} />
            <MetricCard icon={Zap} label="Tokens (Last 7d)" value={formatTokens(stats.totalTokens || 0)} />
            <MetricCard icon={DollarSign} label="Cost (Last 7d)" value={`$${(stats.totalCostUsd || 0).toFixed(2)}`} />
          </>
        ) : (
          <>
            <MetricCard icon={Users} label="Total Agents Active" value={(stats.totalAgentsActive || 0).toString()} info={`${stats.totalAgentsCreated || 0} total created`} />
            <MetricCard icon={Activity} label="Active Agents / Day" value={activeAgentsCount.toLocaleString()} />
            <MetricCard icon={Zap} label="Tokens (Last 24h)" value={avgTokens} />
            <MetricCard icon={BrainCircuit} label="Top Persona" value={personaAdoptionData[0]?.name || 'None'} />
          </>
        )}
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
                  <linearGradient id="colorGoogle" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#4285F4" stopOpacity={0.3} /><stop offset="95%" stopColor="#4285F4" stopOpacity={0} /></linearGradient>
                  <linearGradient id="colorOpenAI" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10a37f" stopOpacity={0.3} /><stop offset="95%" stopColor="#10a37f" stopOpacity={0} /></linearGradient>
                  <linearGradient id="colorAnthropic" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#D97757" stopOpacity={0.3} /><stop offset="95%" stopColor="#D97757" stopOpacity={0} /></linearGradient>
                  <linearGradient id="colorXAI" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#000000" stopOpacity={0.3} /><stop offset="95%" stopColor="#000000" stopOpacity={0} /></linearGradient>
                  <linearGradient id="colorOther" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#94A3B8" stopOpacity={0.3} /><stop offset="95%" stopColor="#94A3B8" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(33,131,128,0.1)" />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#4A5568', fontSize: 13, fontWeight: 500 }} dy={10} />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#4A5568', fontSize: 13, fontWeight: 500 }}
                  tickFormatter={(val) => val >= 1000 ? `${val / 1000}k` : val}
                  dx={-10}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#ffffff', borderColor: '#D9CFC4', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.06)' }}
                  itemStyle={{ fontWeight: 'bold' }}
                  labelStyle={{ color: '#2D3436', marginBottom: '4px', fontWeight: 'bold' }}
                />
                <Area type="monotone" dataKey="google" stroke="#4285F4" strokeWidth={hasGoogle ? 2 : 0} fillOpacity={1} fill="url(#colorGoogle)" />
                <Area type="monotone" dataKey="openai" stroke="#10a37f" strokeWidth={hasOpenAI ? 2 : 0} fillOpacity={1} fill="url(#colorOpenAI)" />
                <Area type="monotone" dataKey="anthropic" stroke="#D97757" strokeWidth={hasAnthropic ? 2 : 0} fillOpacity={1} fill="url(#colorAnthropic)" />
                <Area type="monotone" dataKey="xai" stroke="#000000" strokeWidth={hasXai ? 2 : 0} fillOpacity={1} fill="url(#colorXAI)" />
                <Area type="monotone" dataKey="other" stroke="#94A3B8" strokeWidth={hasOther ? 2 : 0} fillOpacity={1} fill="url(#colorOther)" />
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

      {stats.source === 'global' && (stats.costByProvider || []).length > 0 && (
        <div className="bg-white border border-[#D9CFC4] rounded-3xl p-8 shadow-sm">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-xl font-bold text-textMain">Cost &amp; Tokens by Provider</h3>
            <p className="text-xs text-textMuted font-medium">Last 7 days, anonymized</p>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.costByProvider} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(33,131,128,0.1)" />
                <XAxis dataKey="provider" axisLine={false} tickLine={false} tick={{ fill: '#4A5568', fontSize: 13, fontWeight: 600 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#4A5568', fontSize: 13, fontWeight: 500 }} tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#ffffff', borderColor: '#D9CFC4', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.06)' }}
                  formatter={(value: number, name: string) => name === 'costUsd' ? [`$${value.toFixed(2)}`, 'Cost'] : [value.toLocaleString(), 'Tokens']}
                />
                <Bar dataKey="costUsd" fill="#218380" radius={[6, 6, 0, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {funnel && (
        <div className="bg-white border border-[#D9CFC4] rounded-3xl p-8 shadow-sm">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-2">
              <GitBranch size={20} className="text-primary" />
              <h3 className="text-xl font-bold text-textMain">Onboarding Funnel</h3>
            </div>
            <p className="text-xs text-textMuted font-medium">Distinct installs reaching each milestone, all-time</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={(funnel.activation || []).map((a: any, i: number, arr: any[]) => ({
                    ...a,
                    dropOffPct: i === 0 || !arr[0].anonCount ? null : (a.anonCount / arr[0].anonCount) * 100,
                  }))}
                  margin={{ top: 0, right: 30, left: 10, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="rgba(33,131,128,0.1)" />
                  <XAxis type="number" hide />
                  <YAxis dataKey="label" type="category" axisLine={false} tickLine={false} tick={{ fill: '#4A5568', fontSize: 12, fontWeight: 600 }} width={170} />
                  <Tooltip
                    cursor={{ fill: 'rgba(33,131,128,0.05)' }}
                    contentStyle={{ backgroundColor: '#ffffff', borderColor: '#D9CFC4', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.06)' }}
                    formatter={(value: number, name: string, entry: any) => name === 'anonCount'
                      ? [`${value.toLocaleString()} installs${entry.payload.dropOffPct !== null ? ` (${entry.payload.dropOffPct.toFixed(0)}% of A0)` : ''}`, 'Reached']
                      : [value, name]}
                  />
                  <Bar dataKey="anonCount" fill="#218380" radius={[0, 6, 6, 0]} barSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div>
              <p className="text-xs font-bold text-textMuted uppercase tracking-wide mb-3">Step-by-step drop-off</p>
              <div className="space-y-1.5 max-h-64 overflow-auto pr-2">
                {(funnel.onboardingSteps || []).length === 0 && (
                  <p className="text-sm text-textMuted">No step data yet.</p>
                )}
                {(funnel.onboardingSteps || []).map((s: any, i: number, arr: any[]) => {
                  const prevCount = i > 0 ? arr[i - 1].anonCount : s.anonCount;
                  const retainedPct = prevCount > 0 ? (s.anonCount / prevCount) * 100 : 100;
                  return (
                    <div key={s.eventType} className="flex items-center justify-between text-sm py-1.5 border-b border-[#F0EAE0]">
                      <span className="font-medium text-textMain">{s.step != null ? `Step ${s.step}` : ''} · {s.stepName}</span>
                      <span className="flex items-center gap-2">
                        <span className="font-mono font-bold text-textMain">{s.anonCount.toLocaleString()}</span>
                        {i > 0 && (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${retainedPct >= 80 ? 'bg-green-50 text-green-600' : retainedPct >= 50 ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600'}`}>
                            {retainedPct.toFixed(0)}%
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
              {funnel.companionPairing && funnel.companionPairing.eventCount > 0 && (
                <p className="text-xs text-textMuted mt-4">
                  Companion/mobile pairing: {funnel.companionPairing.anonCount.toLocaleString()} installs, {funnel.companionPairing.eventCount.toLocaleString()} devices paired.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Onboarding Quality: power-up ask funnel, stuckness, eval runs ── */}
      {(funnel || evalRuns.length > 0) && (
        <div className="bg-white border border-[#D9CFC4] rounded-3xl p-8 shadow-sm">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-xl font-bold text-textMain">Onboarding Quality</h3>
            <p className="text-xs text-textMuted font-medium">Power-up conversation performance + eval runs</p>
          </div>

          {/* Tuning knobs: every deployed client picks these up at wizard
              mount; telemetry + eval reports carry the variant label so the
              numbers below can be compared per tweak. */}
          {onboardingConfig && (
            <div className="mb-8 p-5 bg-backgroundAlt rounded-2xl border border-border">
              <div className="flex items-end gap-4 flex-wrap">
                <label className="text-xs font-bold text-textMuted uppercase tracking-wide">
                  Variant label
                  <input
                    value={onboardingConfig.variant || ''}
                    onChange={e => setOnboardingConfig({ ...onboardingConfig, variant: e.target.value })}
                    className="block mt-1 px-3 py-2 rounded-lg border border-border bg-white text-sm font-mono text-textMain w-40"
                  />
                </label>
                <label className="text-xs font-bold text-textMuted uppercase tracking-wide">
                  Ask budget
                  <input
                    type="number" min={2} max={8}
                    value={onboardingConfig.maxAsks ?? 5}
                    onChange={e => setOnboardingConfig({ ...onboardingConfig, maxAsks: parseInt(e.target.value, 10) })}
                    className="block mt-1 px-3 py-2 rounded-lg border border-border bg-white text-sm font-mono text-textMain w-20"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm font-medium text-textMain pb-2">
                  <input
                    type="checkbox"
                    checked={onboardingConfig.liveAgentEnabled !== false}
                    onChange={e => setOnboardingConfig({ ...onboardingConfig, liveAgentEnabled: e.target.checked })}
                  />
                  Live agent loop
                </label>
                <label className="flex items-center gap-2 text-sm font-medium text-textMain pb-2">
                  <input
                    type="checkbox"
                    checked={onboardingConfig.autoAdvanceConfirmations !== false}
                    onChange={e => setOnboardingConfig({ ...onboardingConfig, autoAdvanceConfirmations: e.target.checked })}
                  />
                  Auto-advance confirmations
                </label>
                <button
                  onClick={async () => {
                    setConfigSaveState('saving');
                    try {
                      const res = await fetch('/api/onboarding-config', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(onboardingConfig),
                      });
                      setConfigSaveState(res.ok ? 'saved' : 'error');
                    } catch { setConfigSaveState('error'); }
                    setTimeout(() => setConfigSaveState('idle'), 2500);
                  }}
                  className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-bold pb-2"
                >
                  {configSaveState === 'saving' ? 'Saving…' : configSaveState === 'saved' ? 'Saved ✓' : configSaveState === 'error' ? 'Failed — retry' : 'Save config'}
                </button>
              </div>
              <p className="text-[11px] text-textMuted mt-3">
                Change the variant label with every tweak — funnel events and eval runs are tagged with it, so the numbers below compare variants directly. Clients pick changes up on next wizard launch.
              </p>
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

            <div>
              <p className="text-xs font-bold text-textMuted uppercase tracking-wide mb-3">Ask funnel (shown → answered → accepted)</p>
              {(() => {
                const asks = funnel?.powerUpAsks || [];
                if (asks.length === 0) return <p className="text-sm text-textMuted">No power-up data yet.</p>;
                const askTypes = Array.from(new Set(asks.map((a: any) => a.askType)));
                return (
                  <div className="space-y-2">
                    {askTypes.map((type: any) => {
                      const shown = asks.find((a: any) => a.askType === type && a.eventType === 'powerup_ask_shown')?.anonCount || 0;
                      const answered = asks.filter((a: any) => a.askType === type && a.eventType === 'powerup_ask_answered');
                      const answeredTotal = answered.reduce((s: number, a: any) => s + a.anonCount, 0);
                      const accepted = answered.filter((a: any) => a.action === 'accept').reduce((s: number, a: any) => s + a.anonCount, 0);
                      const acceptPct = answeredTotal > 0 ? (accepted / answeredTotal) * 100 : 0;
                      return (
                        <div key={type} className="flex items-center justify-between text-sm py-1.5 border-b border-[#F0EAE0]">
                          <span className="font-medium text-textMain capitalize">{type}</span>
                          <span className="font-mono text-xs text-textMuted">
                            {shown} → {answeredTotal}
                            <span className={`ml-2 font-bold px-1.5 py-0.5 rounded ${acceptPct >= 60 ? 'bg-green-50 text-green-600' : acceptPct >= 30 ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600'}`}>
                              {acceptPct.toFixed(0)}% yes
                            </span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            <div>
              <p className="text-xs font-bold text-textMuted uppercase tracking-wide mb-3">Where people stall</p>
              {(funnel?.stuckSteps || []).length === 0 && (funnel?.backNavigation || []).length === 0 ? (
                <p className="text-sm text-textMuted">No stall data yet.</p>
              ) : (
                <div className="space-y-2">
                  {(funnel?.stuckSteps || []).slice(0, 6).map((s: any) => (
                    <div key={`stuck-${s.stepName}`} className="flex items-center justify-between text-sm py-1.5 border-b border-[#F0EAE0]">
                      <span className="font-medium text-textMain">{s.stepName} <span className="text-[10px] text-textMuted">idle 90s+</span></span>
                      <span className="font-mono font-bold text-textMain">{s.anonCount}</span>
                    </div>
                  ))}
                  {(funnel?.backNavigation || []).slice(0, 4).map((b: any) => (
                    <div key={`back-${b.fromName}`} className="flex items-center justify-between text-sm py-1.5 border-b border-[#F0EAE0]">
                      <span className="font-medium text-textMain">{b.fromName} <span className="text-[10px] text-textMuted">went back</span></span>
                      <span className="font-mono font-bold text-textMain">{b.eventCount}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="text-xs font-bold text-textMuted uppercase tracking-wide mb-3">Eval runs (powerup script)</p>
              {evalRuns.length === 0 ? (
                <p className="text-sm text-textMuted">No eval runs reported yet. Run <code className="text-xs">node scripts/evalPowerUp.mjs --post</code> in canopy.</p>
              ) : (
                <div className="space-y-2">
                  {evalRuns.slice(0, 8).map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between text-sm py-1.5 border-b border-[#F0EAE0]">
                      <span className="font-medium text-textMain">
                        {new Date(r.runAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        <span className="text-[10px] text-textMuted ml-1.5">{r.engine}{r.gitSha ? ` · ${r.gitSha}` : ''}</span>
                      </span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${r.failed === 0 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                        {r.passed}/{r.total}
                      </span>
                    </div>
                  ))}
                  {evalRuns[0]?.results?.some((res: any) => !res.passed) && (
                    <div className="mt-3 p-3 bg-red-50 rounded-xl text-xs text-red-700 space-y-1">
                      {evalRuns[0].results.filter((res: any) => !res.passed).slice(0, 5).map((res: any) => (
                        <div key={res.caseId}><span className="font-bold">{res.caseId}:</span> {res.failures?.[0]}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>
        </div>
      )}

      {retention && (
        <div className="space-y-8">
          <div className="bg-white border border-[#D9CFC4] rounded-3xl p-8 shadow-sm">
            <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <TrendingUp size={20} className="text-primary" />
                <h3 className="text-xl font-bold text-textMain">DAU / MAU &amp; Stickiness</h3>
              </div>
              <div className="flex bg-backgroundAlt p-1 rounded-xl border border-border">
                {[7, 30, 60].map(w => (
                  <button
                    key={w}
                    onClick={() => setDauMauWindow(w as 7 | 30 | 60)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${dauMauWindow === w ? 'bg-white shadow-sm text-primary' : 'text-textMuted hover:text-textMain'}`}
                  >
                    {w}d
                  </button>
                ))}
              </div>
            </div>
            {(() => {
              const series = (retention.dauMauSeries || []).slice(-dauMauWindow);
              const latest = series[series.length - 1];
              const stickinessPct = latest ? latest.ratio * 100 : 0;
              const band = stickinessPct >= STICKINESS_BENCHMARK.great ? 'Great (top-tier productivity app)'
                : stickinessPct >= STICKINESS_BENCHMARK.healthy ? 'Healthy'
                : stickinessPct >= STICKINESS_BENCHMARK.needsWork ? 'Around SaaS average'
                : 'Below SaaS average';
              const bandColor = stickinessPct >= STICKINESS_BENCHMARK.healthy ? 'text-green-600' : stickinessPct >= STICKINESS_BENCHMARK.needsWork ? 'text-amber-600' : 'text-red-600';
              return (
                <>
                  <div className="flex items-baseline gap-3 mb-6">
                    <span className="text-3xl font-extrabold text-textMain">{stickinessPct.toFixed(1)}%</span>
                    <span className={`text-sm font-bold ${bandColor}`}>{band}</span>
                    <span className="text-xs text-textMuted">today's DAU/MAU</span>
                  </div>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={series} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(33,131,128,0.1)" />
                        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#4A5568', fontSize: 11, fontWeight: 500 }} minTickGap={30} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#4A5568', fontSize: 12, fontWeight: 500 }} />
                        <Tooltip contentStyle={{ backgroundColor: '#ffffff', borderColor: '#D9CFC4', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.06)' }} />
                        <Legend wrapperStyle={{ fontSize: 12, fontWeight: 600 }} />
                        <Line type="monotone" dataKey="dau" name="DAU" stroke="#218380" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="mau" name="MAU" stroke="#94A3B8" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </>
              );
            })()}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <RetentionCurveCard
              title="Daily Retention (D0–D30)"
              data={retention.dailyRetention}
              benchmarks={DAILY_RETENTION_BENCHMARKS}
              checkpointKey="offset"
            />
            <RetentionCurveCard
              title="Monthly Retention (M0–M6)"
              data={retention.monthlyRetention}
              benchmarks={MONTHLY_RETENTION_BENCHMARKS}
              checkpointKey="offset"
            />
          </div>

          <p className="text-[11px] text-textMuted leading-relaxed">
            Benchmarks are directional references for a productivity/workflow-tool app, current as of July 2026:{' '}
            <a href="https://www.businessofapps.com/data/app-retention-rates/" target="_blank" rel="noreferrer" className="underline hover:text-textMain">Business of Apps, App Retention Rates (2026)</a>{' '}
            and{' '}
            <a href="https://www.usedaymark.io/metrics/dau-mau-stickiness" target="_blank" rel="noreferrer" className="underline hover:text-textMain">usedaymark.io, DAU/MAU Stickiness</a>.
            Your own week-over-week trend matters more than matching an external curve exactly.
          </p>
        </div>
      )}
    </motion.div>
  );
}

function RetentionCurveCard({ title, data, benchmarks, checkpointKey }: { title: string; data: any[]; benchmarks: Record<number, { healthy: number; avg: number; note?: string }>; checkpointKey: string }) {
  const chartData = (data || []).map(d => ({
    ...d,
    healthyTarget: benchmarks[d[checkpointKey]]?.healthy ?? null,
    avgTarget: benchmarks[d[checkpointKey]]?.avg ?? null,
  }));
  return (
    <div className="bg-white border border-[#D9CFC4] rounded-3xl p-8 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-bold text-textMain">{title}</h3>
        <div className="flex flex-wrap gap-3 text-[10px] font-bold uppercase tracking-wider">
          <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-[#218380]" /> Actual</div>
          <div className="flex items-center gap-1.5"><div className="w-4 h-0.5 bg-[#94A3B8]" /> Category avg</div>
          <div className="flex items-center gap-1.5"><div className="w-4 h-0.5 bg-[#D97757]" /> Healthy target</div>
        </div>
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(33,131,128,0.1)" />
            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#4A5568', fontSize: 12, fontWeight: 600 }} />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#4A5568', fontSize: 12, fontWeight: 500 }} tickFormatter={(v) => `${v}%`} />
            <Tooltip
              contentStyle={{ backgroundColor: '#ffffff', borderColor: '#D9CFC4', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.06)' }}
              formatter={(value: number, name: string) => [value != null ? `${value.toFixed(1)}%` : 'n/a', name === 'retentionPct' ? 'Actual' : name === 'avgTarget' ? 'Category avg' : 'Healthy target']}
            />
            <Bar dataKey="retentionPct" fill="#218380" radius={[6, 6, 0, 0]} barSize={28} />
            <Line type="monotone" dataKey="avgTarget" stroke="#94A3B8" strokeWidth={2} dot={false} strokeDasharray="4 3" connectNulls />
            <Line type="monotone" dataKey="healthyTarget" stroke="#D97757" strokeWidth={2} dot={false} strokeDasharray="4 3" connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[11px] text-textMuted mt-3">
        Cohort size shown is only installs old enough to have reached each checkpoint (e.g. a D30 bar excludes installs less than 30 days old).
      </p>
    </div>
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
