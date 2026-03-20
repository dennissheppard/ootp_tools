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
