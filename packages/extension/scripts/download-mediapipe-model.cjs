const fs = require('fs')
const path = require('path')
const https = require('https')

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task'
const OUT_DIR = path.join(__dirname, '..', 'public', 'mediapipe', 'models')
const OUT_PATH = path.join(OUT_DIR, 'face_landmarker.task')

if (fs.existsSync(OUT_PATH)) {
  console.log('[MediaPipe] Model already downloaded.')
  process.exit(0)
}

fs.mkdirSync(OUT_DIR, { recursive: true })
console.log('[MediaPipe] Downloading face_landmarker.task ...')

function download(url, dest, maxRedirects = 5) {
  if (maxRedirects <= 0) {
    console.error('[MediaPipe] Too many redirects')
    process.exit(1)
  }
  https.get(url, (res) => {
    if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
      download(res.headers.location, dest, maxRedirects - 1)
      return
    }
    if (res.statusCode !== 200) {
      console.error(`[MediaPipe] HTTP ${res.statusCode}`)
      process.exit(1)
    }
    const file = fs.createWriteStream(dest)
    res.pipe(file)
    file.on('finish', () => {
      file.close()
      const size = fs.statSync(dest).size
      if (size < 100000) {
        fs.unlinkSync(dest)
        console.error('[MediaPipe] Downloaded file too small — likely an error page')
        process.exit(1)
      }
      console.log(`[MediaPipe] Model downloaded (${(size / 1e6).toFixed(1)} MB).`)
    })
  }).on('error', (err) => {
    if (fs.existsSync(dest)) fs.unlinkSync(dest)
    console.error('[MediaPipe] Download failed:', err.message)
    process.exit(1)
  })
}

download(MODEL_URL, OUT_PATH)
