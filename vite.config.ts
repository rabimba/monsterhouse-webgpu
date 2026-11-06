import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const crossOriginHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    headers: crossOriginHeaders,
  },
  preview: {
    port: 4173,
    headers: crossOriginHeaders,
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web', '@huggingface/transformers'],
  },
  build: {
    target: 'esnext',
  },
});
