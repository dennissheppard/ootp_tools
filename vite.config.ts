import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(
      new Date().toISOString().replace(/T/, ' ').replace(/\.\d+Z$/, '') + ' UTC'
    ),
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api': {
        target: 'https://worldbaseballleague.org',
        changeOrigin: true,
        secure: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            proxyReq.setHeader('x-api-key', 'wbl_doback_gumbo_2020');
          });
        },
      },
    },
  },
  build: {
    // Disable modulepreload polyfill — prevents Vite from eagerly preloading
    // lazy chunks (e.g. ApexCharts 579KB) that aren't needed for initial render.
    modulePreload: false,
    // Don't inline images as base64 — keep them as separate files for caching.
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        manualChunks: {
          apexcharts: ['apexcharts'],
        },
      },
    },
    // CSS is still render-blocking in <head>; the inline <style> in index.html
    // handles FCP. The full stylesheet loads in parallel and applies on arrival.
  },
  test: {
    globals: true,
    environment: 'jsdom',
    exclude: [
      'node_modules/**',
      // These test files use Jest-specific APIs (jest.mock, __mocks__) and
      // are run by the pre-commit hook via npx jest instead.
      'src/services/BatterProjectionService.test.ts',
      'src/services/ProjectionService.test.ts',
      'src/views/TeamPlanningView.test.ts',
    ],
  },
});
