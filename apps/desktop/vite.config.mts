import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/renderer',
  // Relative Pfade, weil die Oberfläche als lokale Datei geladen wird
  base: './',
  plugins: [react()],
  build: {
    outDir: '../../out/renderer',
    emptyOutDir: true,
    // Keine data:-URLs, damit die Content Security Policy streng bleibt
    assetsInlineLimit: 0,
  },
});
