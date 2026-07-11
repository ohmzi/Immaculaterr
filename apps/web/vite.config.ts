import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const appVersionSource = readFileSync(
  fileURLToPath(new URL('../api/src/version.ts', import.meta.url)),
  'utf8',
);
const appVersionMatch = appVersionSource.match(/APP_VERSION = '([^']+)'/);
const appAssetVersion = appVersionMatch?.[1] ?? 'dev';

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  define: {
    __APP_ASSET_VERSION__: JSON.stringify(appAssetVersion),
  },
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Keep the big shared libraries in their own long-cacheable chunk so
        // app-code changes don't invalidate the vendor download.
        manualChunks: {
          vendor: [
            'react',
            'react-dom',
            'react-router-dom',
            '@tanstack/react-query',
            'motion',
            'lucide-react',
            'sonner',
          ],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      '.local',
      ...(process.env.WEB_ALLOWED_HOSTS?.split(',').map((h) => h.trim()).filter(Boolean) ?? []),
    ],
    host: '0.0.0.0',
    port: Number.parseInt(process.env.WEB_PORT ?? '5858', 10),
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${Number.parseInt(process.env.API_PORT ?? process.env.PORT ?? '5859', 10)}`,
        // Preserve the original Host header so API Origin checks work for LAN IPs / tunnels.
        // Also forward X-Forwarded-* so the API can make correct decisions behind proxies.
        changeOrigin: false,
        xfwd: true,
      },
    },
  },
  preview: {
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      '.local',
      ...(process.env.WEB_ALLOWED_HOSTS?.split(',').map((h) => h.trim()).filter(Boolean) ?? []),
    ],
  },
}));
