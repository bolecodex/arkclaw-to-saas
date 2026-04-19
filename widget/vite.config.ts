import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  plugins: [react()],
  // lib mode 下 vite 不会自动替换这些，但 React/Zustand 等库内部会读，所以必须手动定义
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
    'process.env': '{}',
    'process.platform': '"browser"',
    'process.version': '""',
    global: 'globalThis',
  },
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/sdk/index.ts'),
      name: 'Arkclaw',
      formats: ['es', 'umd'],
      fileName: (fmt) => `arkclaw-widget.${fmt}.js`,
    },
    rollupOptions: {
      external: [],
      output: {
        inlineDynamicImports: true,
        globals: {},
      },
    },
    sourcemap: mode !== 'production',
    minify: mode === 'production' ? 'esbuild' : false,
  },
  server: {
    port: 5173,
    open: '/examples/vanilla-html/index.html',
  },
}));
