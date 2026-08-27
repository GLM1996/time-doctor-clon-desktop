import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@main': path.resolve(__dirname, 'src/main')
      }
    },    
    build: {
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, 'src/main/index.js')
        }
      }
    }
  },

  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: 'preload.cjs'
        }
      }
    }
  },

  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true
    }
  }
});