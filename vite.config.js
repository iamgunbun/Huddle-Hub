import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '$lib': path.resolve(__dirname, './src'),
      '$app/environment': path.resolve(__dirname, './src/svelte-env-mock.js'),
      '$app/navigation': path.resolve(__dirname, './src/svelte-nav-mock.js'),
      'svelte/store': path.resolve(__dirname, './src/svelte-mock.js')
    }
  },
  server: {
    proxy: {
      // Hijacks Sleeper's undocumented Web App API to pull RotoWire News for free
      '/api/sleeper-graphql': {
        target: 'https://sleeper.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/sleeper-graphql/, '/graphql')
      },
      '/api/espn-web': {
        target: 'https://site.web.api.espn.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/espn-web/, '')
      },
      '/api/espn': {
        target: 'https://site.api.espn.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/espn/, '')
      }
    }
  }
});