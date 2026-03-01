import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: path.resolve(__dirname, 'admin'),
  plugins: [react()],
  resolve: {
    alias: {
      '@admin': path.resolve(__dirname, './admin/src')
    }
  },
  build: {
    outDir: path.resolve(__dirname, 'admin-dist'),
    emptyOutDir: true
  },
  server: {
    port: 5174
  }
});
