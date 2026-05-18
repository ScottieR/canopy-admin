import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  envPrefix: ['VITE_', 'ADMIN_API_KEY'],
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      },
      // Proxy static asset folders, but bypass for SPA routing
      // We only bypass if the request wants HTML and DOES NOT have a file extension
      '^/(agents|models|accessories|habitats)': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        bypass: (req) => {
          if (!req.url) return undefined;
          const url = req.url.split('?')[0].split('#')[0];
          const isHtml = req.headers.accept?.includes('text/html');
          const isFile = url.includes('.');
          if (isHtml && !isFile) {
            return '/index.html';
          }
          // Otherwise continue to proxy
        }
      }
    }
  }
})
