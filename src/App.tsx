import { NavLink, Routes, Route, Navigate } from 'react-router-dom';
import { LayoutDashboard, Users, Settings as SettingsIcon, BookOpen, Shirt, Cpu, Layers, FileText } from 'lucide-react';
import { motion } from 'framer-motion';
import Dashboard from './pages/Dashboard';
import AgentManager from './pages/AgentManager';
import Settings from './pages/Settings';
import LibraryManager from './pages/LibraryManager';
import AccessoryManager from './pages/AccessoryManager';
import ModelRegistry from './pages/ModelRegistry';
import HabitatManager from './pages/HabitatManager';
import { ConnectorsManager } from './pages/ConnectorsManager';
import AgentFilesManager from './pages/AgentFilesManager';

const navItems = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/agents', label: 'Agent Templates', icon: Users },
  { path: '/models', label: 'AI Services & Models', icon: Cpu },
  { path: '/library', label: 'Book Library', icon: BookOpen },
  { path: '/accessories', label: 'Agent Styling', icon: Shirt },
  { path: '/habitats', label: 'Habitat Manager', icon: Layers },
  { path: '/connectors', label: 'Connectors', icon: Layers },
  { path: '/agent-files', label: 'Default Agent Files', icon: FileText },
  { path: '/settings', label: 'Platform Settings', icon: SettingsIcon },
];

export default function App() {
  return (
    <div className="flex h-screen w-full text-textMain overflow-hidden font-body relative bg-background">

      <div className="relative z-10 flex h-full w-full">
        {/* Sidebar Navigation */}
        <motion.aside 
          initial={{ x: -300 }}
          animate={{ x: 0 }}
          className="w-64 border-r border-outline-variant/20 bg-surface/50 backdrop-blur-xl flex flex-col h-full shrink-0 shadow-[4px_0_24px_rgba(0,0,0,0.02)]"
        >
          <div className="h-20 flex items-center px-6 border-b border-outline-variant/20">
          <img src="/app-icon.png" alt="Canopy Logo" className="w-9 h-9 rounded-xl object-cover mr-3 shadow-lg shadow-primary/20" />
          <h1 className="font-bold text-xl tracking-tight text-textMain">Canopy Admin</h1>
        </div>
        
        <nav className="flex-1 py-8 px-4 space-y-2">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 group font-medium ${
                  isActive 
                    ? 'bg-white shadow-sm text-primary' 
                    : 'text-textMuted hover:bg-white/50 hover:text-textMain'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon 
                    size={20} 
                    className={`transition-colors duration-300 ${isActive ? 'text-primary' : 'text-textMuted group-hover:text-primary/70'}`} 
                  />
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="p-5 border-t border-[#D9CFC4] mt-auto">
          <div className="flex items-center gap-3 px-2">
            <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center border-2 border-primary/20 shadow-sm">
              <span className="text-sm font-bold text-primary">SA</span>
            </div>
            <div>
              <p className="text-sm font-bold text-textMain">SysAdmin</p>
              <p className="text-xs text-textMuted font-medium text-nowrap">admin@canopy.ai</p>
            </div>
          </div>
        </div>
      </motion.aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto relative">
        <header className="h-20 border-b border-[#D9CFC4] bg-[rgba(245,238,232,0.6)] backdrop-blur-md sticky top-0 z-10 flex items-center px-10">
          <h2 className="text-sm font-bold text-textMuted uppercase tracking-wider">Platform Overview</h2>
        </header>
        <div className="p-10 pb-24 max-w-7xl mx-auto">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/agents" element={<AgentManager />} />
            <Route path="/models" element={<ModelRegistry />} />
            <Route path="/library" element={<LibraryManager />} />
            <Route path="/accessories" element={<AccessoryManager />} />
            <Route path="/habitats" element={<HabitatManager />} />
            <Route path="/connectors" element={<ConnectorsManager />} />
            <Route path="/agent-files" element={<AgentFilesManager />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </div>
      </main>
      </div>
    </div>
  );
}
