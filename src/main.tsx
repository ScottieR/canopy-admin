import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App.tsx'
import './index.css'

// Global Fetch Interceptor for Admin API Key
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  let [resource, config] = args;
  
  const urlStr = typeof resource === 'string' ? resource : (resource instanceof Request ? resource.url : '');
  const requestUrl = new URL(urlStr || window.location.href, window.location.href);
  const isOwnApi = requestUrl.origin === window.location.origin && requestUrl.pathname.startsWith('/api/');
  
  if (isOwnApi) {
    const adminKey = sessionStorage.getItem('adminApiKey') || '';
    const headers = new Headers(resource instanceof Request ? resource.headers : undefined);
    new Headers(config?.headers).forEach((value, key) => headers.set(key, value));
    if (adminKey) headers.set('x-admin-key', adminKey);
    config = { ...(config || {}), headers };
  }

  let response = await originalFetch(resource, config);
  
  // Auto-prompt and retry if the server rejected our key (or lack thereof)
  if (response.status === 401 && isOwnApi) {
    const newKey = window.prompt("Admin API Key required to save/generate. Please enter your key:");
    if (newKey !== null) {
      sessionStorage.setItem('adminApiKey', newKey);
      const headers = new Headers(config?.headers);
      headers.set('x-admin-key', newKey);
      config = { ...(config || {}), headers };
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
