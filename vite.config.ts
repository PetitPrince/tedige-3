import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

export default defineConfig({
  base: '/tedige-3/',
  plugins: [svelte()],
  build: {
    rollupOptions: {
      input: {
        main:   resolve(__dirname, 'index.html'),
        player: resolve(__dirname, 'player.html'),
      },
    },
  },
});
