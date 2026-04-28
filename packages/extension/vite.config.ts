import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import { resolve } from 'path'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import manifest from './manifest.json'

export default defineConfig({
  plugins: [
    crx({ manifest }),
    viteStaticCopy({
      targets: [
        {
          src: resolve(__dirname, '../../node_modules/@mediapipe/tasks-vision/wasm/*'),
          dest: 'mediapipe/wasm',
        },
        {
          src: resolve(__dirname, 'public/mediapipe/models/*'),
          dest: 'mediapipe/models',
        },
      ],
    }),
  ],
  resolve: {
    alias: {
      '@gazekit/shared': resolve(__dirname, '../shared/src'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        'service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
        popup: resolve(__dirname, 'src/popup/popup.html'),
        offscreen: resolve(__dirname, 'src/offscreen/offscreen.html'),
        calibration: resolve(__dirname, 'src/calibration/calibration.html'),
      },
    },
    outDir: 'dist',
    sourcemap: true,
  },
})
