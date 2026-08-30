import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@plugos/core': path.resolve(__dirname, './packages/core/src/index.ts'),
        '@plugos/sdk': path.resolve(__dirname, './packages/sdk/src/index.ts'),
        '@plugos/react': path.resolve(__dirname, './packages/react/src/index.tsx'),
        '@plugos/testing': path.resolve(__dirname, './packages/testing/src/index.ts'),
        '@plugos/cli': path.resolve(__dirname, './packages/cli/src/index.ts'),
      },
    },
    server: {
      host: '0.0.0.0',
      allowedHosts: ['terminal.local'],
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
