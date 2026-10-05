import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

const safeOrigin = (value?: string) => {
  if (!value?.trim()) return null;
  try {
    return new URL(value.trim()).origin;
  } catch {
    return null;
  }
};

const safeSupabaseProjectRef = (value?: string) => {
  if (!value?.trim()) return null;
  try {
    const hostname = new URL(value.trim()).hostname;
    return hostname.endsWith('.supabase.co') ? hostname.split('.')[0] : null;
  } catch {
    return null;
  }
};

const deploymentDiagnosticsPlugin = (): Plugin => ({
  name: 'theplugos-deployment-diagnostics',
  generateBundle() {
    const ownerPortalOrigin = process.env.VITE_OWNER_PORTAL_ORIGIN?.trim() || '';
    const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim() || '';
    const publishableKey = process.env.VITE_SUPABASE_ANON_KEY?.trim() || '';
    const publishableKeyFormat = publishableKey.startsWith('sb_publishable_')
      ? 'modern-publishable'
      : publishableKey.split('.').length === 3
        ? 'legacy-jwt'
        : publishableKey
          ? 'invalid'
          : 'missing';

    const payload = {
      service: 'theplugos-owner-portal',
      ownerPortalOrigin: safeOrigin(ownerPortalOrigin),
      ownerPortalOriginConfigured: Boolean(ownerPortalOrigin),
      supabaseProjectRef: safeSupabaseProjectRef(supabaseUrl),
      supabaseUrlConfigured: Boolean(supabaseUrl),
      publishableKeyConfigured: Boolean(publishableKey),
      publishableKeyFormat,
      configurationReady:
        Boolean(safeOrigin(ownerPortalOrigin)) &&
        Boolean(safeSupabaseProjectRef(supabaseUrl)) &&
        (publishableKeyFormat === 'modern-publishable' || publishableKeyFormat === 'legacy-jwt'),
      generatedAt: new Date().toISOString(),
    };

    this.emitFile({
      type: 'asset',
      fileName: 'deployment-config.json',
      source: JSON.stringify(payload, null, 2),
    });
  },
});

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), deploymentDiagnosticsPlugin()],
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
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
