import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import './index.css'

// Global Fetch Interceptor for Admin API Key
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  let [resource, config] = args;
  
  const urlStr = typeof resource === 'string' ? resource : (resource instanceof Request ? resource.url : '');
  const method = (config?.method || (resource instanceof Request ? resource.method : 'GET')).toUpperCase();
  
  // Only intercept our own API mutations
  if (urlStr.includes('/api/') && ['POST', 'PUT', 'DELETE'].includes(method)) {
    // The key may be entered for this browser session, but must never be
    // compiled into the public admin frontend bundle.
    let adminKey = localStorage.getItem('adminApiKey') || '';
    
    config = config || {};
    config.headers = {
      ...config.headers,
      'x-admin-key': adminKey
    };
  }

  let response = await originalFetch(resource, config);
  
  // Auto-prompt and retry if the server rejected our key (or lack thereof)
  if (response.status === 401 && ['POST', 'PUT', 'DELETE'].includes(method)) {
    const newKey = window.prompt("Admin API Key required to save/generate. Please enter your key:");
    if (newKey !== null) {
      localStorage.setItem('adminApiKey', newKey);
      config.headers = { ...config.headers, 'x-admin-key': newKey };
      response = await originalFetch(resource, config);
    }
  }
  
  return response;
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
