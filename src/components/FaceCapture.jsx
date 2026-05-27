import { useEffect, useRef, useState } from 'react';
import { loadFaceModels, extractDescriptor, openCamera, stopCamera } from '../lib/face';

/**
 * FaceCapture — shared component for both enrollment and verification.
 * 
 * Props:
 *   mode: 'enroll' | 'verify'
 *   userName: who is being captured (shown in UI)
 *   onCapture: callback(descriptor) — caller decides what to do with the 128-dim vector
 *   onCancel: callback() — user dismissed the modal
 *   loadingText / instructions: optional overrides
 */
export default function FaceCapture({ mode, userName, onCapture, onCancel, zIndex }) {
  const videoRef = useRef(null);
  const [stream,   setStream]   = useState(null);
  const [status,   setStatus]   = useState('loading'); // loading | ready | capturing | error
  const [message,  setMessage]  = useState('Loading face recognition…');
  const [error,    setError]    = useState('');

  // Boot: load models + open camera
  useEffect(() => {
    let cancelled = false;
    let activeStream = null;

    async function boot() {
      try {
        await loadFaceModels((m) => { if (!cancelled) setMessage(m); });
        if (cancelled) return;

        setMessage('Starting camera…');
        activeStream = await openCamera();
        if (cancelled) { stopCamera(activeStream); return; }
        setStream(activeStream);
        if (videoRef.current) {
          videoRef.current.srcObject = activeStream;
          await videoRef.current.play();
        }
        setStatus('ready');
        setMessage(mode === 'enroll'
          ? 'Position your face inside the oval and click Capture'
          : 'Look at the camera');
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
      stopCamera(activeStream);
    };
  }, [mode]);

  const handleCapture = async () => {
    if (!videoRef.current) return;
    setStatus('capturing');
    setMessage('Capturing face…');
    try {
      const descriptor = await extractDescriptor(videoRef.current);
      if (!descriptor) {
        setStatus('ready');
        setMessage('No face detected — make sure your face is clearly visible and well-lit, then try again.');
        return;
      }
      // Pass back to caller, then close
      onCapture(descriptor);
      // Stop camera before unmount
      stopCamera(stream);
    } catch (e) {
      setStatus('ready');
      setMessage('Capture failed: ' + e.message);
    }
  };

  const handleCancel = () => {
    stopCamera(stream);
    onCancel();
  };

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
              {mode === 'enroll' ? '📸 Enroll face' : '🔍 Verify face'}
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
              <div className="face-video-wrap">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="face-video"
                />
                <div className="face-oval" />
              </div>
              <div className="face-status">{message}</div>
            </>
          )}
        </div>

        <div className="face-capture-foot">
          <button className="btn-ghost" onClick={handleCancel}>Cancel</button>
          {status !== 'error' && (
            <button
              className="btn btn-primary"
              onClick={handleCapture}
              disabled={status !== 'ready'}
            >
              {status === 'capturing' ? '⏳ Capturing…' : '📸 Capture'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
