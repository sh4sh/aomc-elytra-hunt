import { defineConfig } from 'vite';

// Relative base so the build works from any path (e.g. GitHub Pages project sites).
export default defineConfig({
  base: './',
  // The oldest browsers that have BigInt, which the generator needs. Newer syntax is rewritten for them.
  build: { target: 'es2020' },
  worker: { format: 'iife' },
});
