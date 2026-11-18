// Builds serial-shim.ts into one self-contained script that the desktop app injects into every
// page before the page's own scripts (see src-tauri/src/main.rs).
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: '../../dist/desktop-shim',
    emptyOutDir: true,
    minify: true,
    lib: {
      entry: 'serial-shim.ts',
      formats: ['iife'],
      name: 'reaperSerialShim',
      fileName: () => 'serial-shim.js',
    },
  },
});
