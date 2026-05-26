/**
 * Facial recognition using face-api.js
 * 
 * Loaded on-demand from CDN to avoid bloating the main bundle.
 * Models hosted on the official face-api.js GitHub Pages.
 * 
 * Workflow:
 *   1. Manager enrolls staff via Config → Users → Enroll face
 *      → captures photo from webcam, extracts 128-dim descriptor,
 *        stores it as an array on the user doc.
 *   2. On PIN entry, if user has face enrollment, we capture their face
 *      and compare its descriptor against the stored one.
 *   3. Euclidean distance < 0.55 = match (face-api.js default threshold).
 * 
 * Descriptors are 128 floats, ~1KB per user — fine for Firestore.
 * The model files (~6MB) are loaded once and cached by the browser.
 */

const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';
let modelsLoaded = false;
let faceapi = null;

/** Lazy-load face-api.js and its models. Call before any other function. */
export async function loadFaceModels(onProgress) {
  if (modelsLoaded) return faceapi;
  try {
    onProgress?.('Loading face recognition library…');
    // face-api.js is loaded from CDN as a UMD script
    if (!window.faceapi) {
      await loadScript('https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js');
    }
    faceapi = window.faceapi;
    if (!faceapi) throw new Error('face-api.js failed to load');

    onProgress?.('Loading face detection model (~3 MB)…');
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    onProgress?.('Loading face landmarks model…');
    await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
    onProgress?.('Loading face recognition model (~6 MB)…');
    await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);

    modelsLoaded = true;
    onProgress?.('Ready');
    return faceapi;
  } catch (e) {
    console.error('Face model load failed:', e);
    throw new Error('Could not load face recognition models. Check your internet connection.');
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Script load failed: ' + src));
    document.head.appendChild(s);
  });
}

/**
 * Detect a single face in a video/image element and return its 128-dim descriptor.
 * Returns null if no face (or multiple faces) found.
 */
export async function extractDescriptor(mediaElement) {
  if (!modelsLoaded) await loadFaceModels();
  const options = new faceapi.TinyFaceDetectorOptions({
    inputSize: 416,
    scoreThreshold: 0.55,
  });
  const detection = await faceapi
    .detectSingleFace(mediaElement, options)
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!detection?.descriptor) return null;
  // Convert Float32Array to plain array for Firestore
  return Array.from(detection.descriptor);
}

/**
 * Compare two descriptors. Returns euclidean distance (lower = more similar).
 * < 0.55 is a match. Below 0.40 is a very confident match.
 */
export function descriptorDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * Open the user's camera. Returns the stream — caller must stop it when done.
 * { facingMode: 'user' } prefers front camera on tablets/phones.
 */
export async function openCamera() {
  return navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: 'user',
      width: { ideal: 640 },
      height: { ideal: 480 },
    },
    audio: false,
  });
}

export function stopCamera(stream) {
  stream?.getTracks()?.forEach(t => t.stop());
}
