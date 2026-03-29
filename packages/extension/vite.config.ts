import { defineConfig, type Plugin } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import { resolve } from 'path'
import manifest from './manifest.json'

/**
 * Patches WebGazer to work inside a Chrome extension sandbox:
 *  1. Disable HTTPS-only check (chrome-extension:// is secure)
 *  2. Replace timeupdate listener with polling (canvas.captureStream() never fires timeupdate)
 *  3. Wrap loop() body in try/catch so one failed iteration doesn't kill the loop
 *  4. Fix getPupilFeatures: add async/await so try/catch catches getEyePatches errors
 */
function patchWebGazer(): Plugin {
  return {
    name: 'patch-webgazer',
    transform(code, id) {
      if (!id.includes('webgazer') || !id.includes('index.mjs')) return

      // 1. HTTPS check — chrome-extension:// is secure
      code = code.replace(
        `if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.chrome){`,
        `if (false){  // patched by GazeKit`,
      )

      // 2. timeupdate → polling (captureStream videos don't fire timeupdate)
      code = code.replace(
        `videoElement.addEventListener('timeupdate', setupPreviewVideo);`,
        [
          `// GazeKit: poll instead of timeupdate (captureStream compat)`,
          `(function _pollVideoReady() {`,
          `  if (videoElement.videoWidth > 0) {`,
          `    setupPreviewVideo({ target: { removeEventListener: function(){} }, type: 'poll' });`,
          `  } else {`,
          `    setTimeout(_pollVideoReady, 50);`,
          `  }`,
          `})();`,
        ].join('\n'),
      )

      // 3. Resilient prediction — catch errors so a failed prediction doesn't kill the loop
      code = code.replace(
        `latestGazeData = await latestGazeData;`,
        `try { latestGazeData = await latestGazeData; } catch(_e) { latestGazeData = null; console.error('[WebGazer predict]', _e); }`,
      )

      // 4. Fix getPupilFeatures — getEyePatches() is async but the original code
      //    doesn't await it, so the try/catch never catches rejections.
      //    This means TF.js errors crash the entire prediction loop.
      code = code.replace(
        `function getPupilFeatures(canvas, width, height) {\n  if (!canvas) {\n    return;\n  }\n  try {\n    return curTracker.getEyePatches(canvas, width, height);\n  } catch(err) {\n    console.log("can't get pupil features ", err);\n    return null;\n  }\n}`,
        `async function getPupilFeatures(canvas, width, height) {\n  if (!canvas) {\n    return null;\n  }\n  try {\n    return await curTracker.getEyePatches(canvas, width, height);\n  } catch(err) {\n    console.error("[GazeKit] getEyePatches failed:", err);\n    return null;\n  }\n}`,
      )

      // Verify patches applied (silent failure detection)
      if (code.includes(`window.location.protocol !== 'https:'`)) {
        console.warn('[patch-webgazer] HTTPS check patch did NOT match')
      }
      if (code.includes(`videoElement.addEventListener('timeupdate', setupPreviewVideo)`)) {
        console.warn('[patch-webgazer] timeupdate patch did NOT match')
      }
      if (code.includes(`function getPupilFeatures`) && !code.includes('await curTracker.getEyePatches')) {
        console.warn('[patch-webgazer] getPupilFeatures async patch did NOT match')
      }

      return code
    },
  }
}

export default defineConfig({
  // Relative paths so sandbox.html (opaque origin) can resolve assets
  base: './',
  plugins: [
    patchWebGazer(),
    crx({ manifest }),
  ],
  resolve: {
    alias: {
      '@gazekit/shared': resolve(__dirname, '../shared/src'),
      // Force a single copy of TF.js core + converter.
      // Without this, @tensorflow-models/facemesh resolves the top-level v1.7.4
      // while @tensorflow/tfjs loads the nested v3.21.0. Two Engine instances
      // means the WebGL kernels are never found → "an is not a function".
      '@tensorflow/tfjs-core': resolve(__dirname, '../../node_modules/@tensorflow/tfjs/node_modules/@tensorflow/tfjs-core'),
      '@tensorflow/tfjs-converter': resolve(__dirname, '../../node_modules/@tensorflow/tfjs/node_modules/@tensorflow/tfjs-converter'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        'service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
        popup: resolve(__dirname, 'src/popup/popup.html'),
        offscreen: resolve(__dirname, 'src/offscreen/offscreen.html'),
        calibration: resolve(__dirname, 'src/calibration/calibration.html'),
        sandbox: resolve(__dirname, 'src/calibration/sandbox.html'),
      },
    },
    outDir: 'dist',
    sourcemap: true,
  },
})
