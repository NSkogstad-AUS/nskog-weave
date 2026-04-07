import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { openAiWorkerApiPlugin } from './server/openaiWorkerApi';

export default defineConfig({
  plugins: [react(), tailwindcss(), openAiWorkerApiPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
