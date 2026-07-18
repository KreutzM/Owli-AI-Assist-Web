import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: path.resolve('tests/harness/safari-jpeg'),
  publicDir: false,
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve('src') },
  },
  build: {
    outDir: path.resolve('dist'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
  },
});
