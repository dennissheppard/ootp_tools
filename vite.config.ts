import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
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
      '/api-wbl': {
        target: 'https://statsplus.net/wbl',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-wbl/, ''),
        secure: true,
      },
    },
  },
});
