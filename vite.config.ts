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
  },
});
