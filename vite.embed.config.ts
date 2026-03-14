/**
 * Separate build that produces a single self-contained IIFE:
 *   dist/tedige-player.js
 *
 * Drop it on any page with:
 *   <script src="tedige-player.js"></script>
 *   <tedige-player data="v4@..." cell-size="28" autoplay></tedige-player>
 *
 * Build: npm run build:embed
 */
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [
    svelte({
      compilerOptions: {
        // Inject component CSS into JS so the embed is a single file with no
        // separate .css dependency.
        css: 'injected',
      },
    }),
  ],
  build: {
    lib: {
      entry: 'src/player-embed.ts',
      formats: ['iife'],
      name: 'TedigePlayer',
      fileName: () => 'tedige-player.js',
    },
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
