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
        target: 'https://atl-01.statsplus.net/world',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '/api'),
        secure: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
  },
});
