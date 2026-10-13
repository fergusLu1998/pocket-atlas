import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
export default defineConfig({
  root: '.',
  plugins: [
    react(),
    {
      name: 'root-index',
      closeBundle() {
        writeFileSync(
          'dist/local/index.html',
          readFileSync('dist/local/standalone/index.html'),
        );
      },
    },
  ],
  css: { postcss: { plugins: [tailwindcss()] } },
  resolve: {
    alias: {
      'next/image': fileURLToPath(
        new URL('./standalone/image.tsx', import.meta.url),
      ),
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist/local',
    emptyOutDir: true,
    rolldownOptions: { input: 'standalone/index.html' },
  },
});
