import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  resolve: {
    alias: {
      '$lib': '/src',
      'svelte/store': '/src/svelte-mock.js',
      '$app/environment': '/src/svelte-env-mock.js',
      '$app/navigation': '/src/svelte-nav-mock.js'
    }
  }
})