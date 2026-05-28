import { useEffect, useRef, useState } from 'react';
import { loadFaceModels, extractDescriptor, openCamera, stopCamera } from '../lib/face';

/**
 * FaceCapture — webcam capture for enrollment and verification.
 *
 * Props:
 *   mode: 'enroll' | 'verify'
 *   autoScan: boolean — if true (default for verify), the camera continuously
 *             scans and auto-fires onCapture the moment a face is detected,
 *             like iPhone Face ID. No Capture button. If false (enroll),
 *             the user clicks Capture to choose the moment.
 *   userName: who is being captured (shown in UI)
 *   onCapture: callback(descriptor) — caller decides what to do with the vector
 *   onCancel: callback() — user dismissed the modal
 *   zIndex: optional z-index override for the overlay
 */
export default function FaceCapture({ mode, userName, onCapture, onCancel, zIndex, autoScan }) {
  // Default: auto-scan ON for verify, OFF for enroll
  const useAutoScan = autoScan !== undefined ? autoScan : (mode === 'verify');

  const videoRef    = useRef(null);
  const streamRef   = useRef(null);
  const scanRef     = useRef(null);     // interval id for auto-scan
  const firedRef    = useRef(false);    // guard so we only fire onCapture once
  const [status,  setStatus]  = useState('loading'); // loading | scanning | ready | capturing | detected | error
  const [message, setMessage] = useState('Loading face recognition…');
  const [error,   setError]   = useState('');

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        await loadFaceModels((m) => { if (!cancelled) setMessage(m); });
        if (cancelled) return;

        setMessage('Starting camera…');
        const activeStream = await openCamera();
        if (cancelled) { stopCamera(activeStream); return; }
        streamRef.current = activeStream;
        if (videoRef.current) {
          videoRef.current.srcObject = activeStream;
          await videoRef.current.play();
        }

        if (useAutoScan) {
          setStatus('scanning');
          setMessage('Look at the camera…');
          startAutoScan();
        } else {
          setStatus('ready');
          setMessage('Position your face inside the oval and tap Capture');
        }
      } catch (e) {
        if (cancelled) return;
        const reason = e?.name === 'NotAllowedError'
          ? 'Camera access denied. Allow camera in your browser settings.'
          : e?.name === 'NotFoundError'
          ? 'No camera detected on this device.'
          : e.message;
        setStatus('error');
        setError(reason);
      }
    }
    boot();

    return () => {
      cancelled = true;
      if (scanRef.current) clearInterval(scanRef.current);
      stopCamera(streamRef.current);
    };
    // eslint-disable-next-line
  }, []);

  // ── Auto-scan loop: sample frames until a face is found ──────────────────
  const startAutoScan = () => {
    let attempts = 0;
    scanRef.current = setInterval(async () => {
      if (firedRef.current || !videoRef.current) return;
      attempts++;
      try {
        const descriptor = await extractDescriptor(videoRef.current);
        if (descriptor && !firedRef.current) {
          // Face found — fire once
          firedRef.current = true;
          clearInterval(scanRef.current);
          setStatus('detected');
          setMessage('Face detected ✓');
          // brief beat so the user sees the confirmation, then hand off
          setTimeout(() => {
            onCapture(descriptor);
            stopCamera(streamRef.current);
          }, 350);
        } else if (!descriptor) {
          // Update guidance every few attempts
          if (attempts % 3 === 0) {
            setMessage('Move closer and look at the camera…');
          }
        }
      } catch {
        /* keep scanning */
      }
    }, 600);  // sample roughly every 600ms
  };

  // ── Manual capture (enroll mode) ─────────────────────────────────────────
  const handleManualCapture = async () => {
    if (!videoRef.current || firedRef.current) return;
    setStatus('capturing');
    setMessage('Capturing…');
    try {
      const descriptor = await extractDescriptor(videoRef.current);
      if (!descriptor) {
        setStatus('ready');
        setMessage('No face detected — ensure your face is clearly visible and well-lit, then try again.');
        return;
      }
      firedRef.current = true;
      onCapture(descriptor);
      stopCamera(streamRef.current);
    } catch (e) {
      setStatus('ready');
      setMessage('Capture failed: ' + e.message);
    }
  };

  const handleCancel = () => {
    if (scanRef.current) clearInterval(scanRef.current);
    stopCamera(streamRef.current);
    onCancel();
  };

  const scanning  = status === 'scanning';
  const detected  = status === 'detected';

  return (
    <div
      className="modal-overlay"
      style={zIndex ? { zIndex } : undefined}
      onClick={handleCancel}
    >
      <div className="face-capture-modal" onClick={e => e.stopPropagation()}>
        <div className="face-capture-head">
          <div>
            <h3 style={{ margin: 0 }}>
              {mode === 'enroll' ? '📸 Enroll face' : '🔍 Face ID'}
            </h3>
            <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
              {userName ? `For ${userName}` : ''}
            </div>
          </div>
          <button className="icon-btn" onClick={handleCancel}>×</button>
        </div>

        <div className="face-capture-body">
          {status === 'error' ? (
            <div className="face-error">
              <div style={{ fontSize: 36, marginBottom: 10 }}>🚫</div>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Camera unavailable</div>
              <div style={{ color: 'var(--text-2)', fontSize: 13, lineHeight: 1.6 }}>{error}</div>
            </div>
          ) : (
            <>
              <div className={`face-video-wrap ${scanning ? 'is-scanning' : ''} ${detected ? 'is-detected' : ''}`}>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="face-video"
                />
                <div className="face-oval" />
                {scanning && <div className="face-scan-line" />}
                {detected && <div className="face-detected-check">✓</div>}
              </div>
              <div className="face-status">{message}</div>
            </>
          )}
        </div>

        <div className="face-capture-foot">
          <button className="btn-ghost" onClick={handleCancel}>Cancel</button>
          {/* Manual capture button only in enroll (non-auto) mode */}
          {!useAutoScan && status !== 'error' && (
            <button
              className="btn btn-primary"
              onClick={handleManualCapture}
              disabled={status !== 'ready'}
            >
              {status === 'capturing' ? '⏳ Capturing…' : '📸 Capture'}
            </button>
          )}
          {/* In auto-scan mode, show a subtle status pill instead of a button */}
          {useAutoScan && status !== 'error' && (
            <div className="face-auto-pill">
              {detected ? '✓ Recognised' : scanning ? '◉ Scanning…' : 'Starting…'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
