import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { openAiWorkerApiPlugin } from './server/openaiWorkerApi';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  Object.assign(process.env, env);

  return {
    plugins: [react(), tailwindcss(), openAiWorkerApiPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  };
});
