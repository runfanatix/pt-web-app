/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `vite build --mode demo` makes ONE html file that runs the whole app offline against a built-in mock (src/demo).
export default defineConfig(({ mode }) => ({
  plugins: mode === 'demo' ? [react(), viteSingleFile()] : [react()],
  ...(mode === 'demo'
    ? {
        base: './',
        build: { outDir: 'dist-demo', emptyOutDir: true },
        define: {
          'import.meta.env.VITE_DEMO': '"1"',
          'import.meta.env.VITE_SUPABASE_URL': '"http://demo.local"',
          'import.meta.env.VITE_SUPABASE_ANON_KEY': '"demo-anon-key"',
        },
      }
    : {}),
  envDir: '../..',
  server: { port: 5173 },
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'] },
}));
