import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

import evaluateHandler from './api/evaluate.js';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  process.env = { ...process.env, ...env };

  return {
    plugins: [
      react(),
      {
        name: 'local-api-middleware',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if (req.method === 'POST' && req.url === '/api/evaluate') {
              let body = '';
              req.on('data', chunk => { body += chunk; });
              req.on('end', async () => {
                try {
                  req.body = body ? JSON.parse(body) : {};

                  res.status = (code) => {
                    res.statusCode = code;
                    return res;
                  };
                  res.json = (data) => {
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify(data));
                  };

                  await evaluateHandler(req, res);
                } catch (err) {
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: err.message }));
                }
              });
              return;
            }
            next();
          });
        }
      }
    ],
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
  };
});