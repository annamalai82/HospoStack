import { useEffect, useState } from 'react';
import { useDevice } from '../context/DeviceContext';
import { findUserByPin, getVenue, getUsersWithFaceEnrolled } from '../lib/data';
import { descriptorDistance } from '../lib/face';
import FaceCapture from '../components/FaceCapture';

/**
 * Login flow:
 *
 *   If venue has face auth enabled AND at least one user has enrolled a face:
 *     → Face-first welcome screen. Tap "Sign in with face" → camera captures
 *       a face → we compare against ALL enrolled staff. If a confident match
 *       is found AND that user can use this device, log them in instantly.
 *       Otherwise show "Face not recognised — try again or use PIN".
 *
 *   If venue has face auth disabled (or no one has enrolled):
 *     → PIN entry directly (the original flow).
 *
 *   At any point the user can press "Use PIN instead" to fall back to keypad.
 */
export default function PinScreen() {
  const { device, login, reset } = useDevice();

  // Login mode: 'auto' = checking venue settings, 'face' = face-first welcome,
  // 'pin' = keypad. The face-first mode shows a friendly welcome card with
  // a single big "Sign in with face" button; PIN mode shows the keypad.
  const [authMode, setAuthMode]   = useState('auto');  // auto | face | pin
  const [faceCaptureOpen, setFaceCaptureOpen] = useState(false);
  const [pin,       setPin]       = useState('');
  const [error,     setError]     = useState('');
  const [pendingUser, setPendingUser] = useState(null);  // user who passed PIN, awaiting face verify
  const [matching,  setMatching]  = useState(false);     // 'matching face against enrolled staff' state
  const [faceRequired, setFaceRequired] = useState(false);

  // Determine initial mode based on venue settings + enrollment
  useEffect(() => {
    (async () => {
      const v = await getVenue();
      const enabled = !!v?.faceAuthEnabled;
      setFaceRequired(enabled);
      if (!enabled) {
        setAuthMode('pin');
        return;
      }
      // Face auth enabled — check if anyone has enrolled
      const enrolled = await getUsersWithFaceEnrolled();
      setAuthMode(enrolled.length > 0 ? 'face' : 'pin');
    })();
  }, []);

  // Keyboard shortcut for PIN entry — only when in pin mode and not face-capturing
  useEffect(() => {
    if (authMode !== 'pin' || pendingUser || faceCaptureOpen) return;
    const onKey = (e) => {
      if (e.key >= '0' && e.key <= '9') append(e.key);
      else if (e.key === 'Backspace') back();
      else if (e.key === 'Enter') submit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line
  }, [pin, authMode, pendingUser, faceCaptureOpen]);

  const append = (d) => {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    setError('');
    if (next.length === 4) setTimeout(() => trySubmit(next), 80);
  };
  const back   = () => { setPin(p => p.slice(0, -1)); setError(''); };
  const submit = () => trySubmit(pin);

  // ── Role check helper (used by both flows) ──────────────────────────────
  const validateRoleForDevice = (user) => {
    if (user.role === 'kitchen' && device.mode !== 'kitchen') {
      return `${user.name} is kitchen staff — please use the Kitchen Display device.`;
    }
    if (user.role !== 'manager' && device.mode === 'kitchen' && user.role !== 'kitchen') {
      return `${user.name} is a ${user.role} — Kitchen Display requires kitchen staff.`;
    }
    return null;
  };

  // ── PIN-based login ─────────────────────────────────────────────────────
  const trySubmit = async (p) => {
    if (p.length !== 4) return;
    try {
      const user = await findUserByPin(p);
      if (!user) {
        setError('Invalid PIN');
        setPin('');
        return;
      }
      const roleErr = validateRoleForDevice(user);
      if (roleErr) { setError(roleErr); setPin(''); return; }

      // Face still required for users with an enrolled face (defence in depth)
      if (faceRequired && user.faceDescriptor?.length === 128) {
        setPendingUser(user);
        setFaceCaptureOpen(true);
        setPin('');
        return;
      }
      await login(user);
    } catch (e) {
      setError(e.message);
      setPin('');
    }
  };

  // ── Face-first login: capture a face, match against ALL enrolled staff ──
  const handleFaceFirstCapture = async (descriptor) => {
    setFaceCaptureOpen(false);
    setMatching(true);
    setError('');
    try {
      const enrolled = await getUsersWithFaceEnrolled();
      // Find the closest matching user
      let best = { user: null, distance: Infinity };
      for (const u of enrolled) {
        const d = descriptorDistance(descriptor, u.faceDescriptor);
        if (d < best.distance) best = { user: u, distance: d };
      }
      // Strict threshold for face-first (no PIN to back it up)
      if (best.distance < 0.50) {
        const roleErr = validateRoleForDevice(best.user);
        if (roleErr) { setError(roleErr); setMatching(false); return; }
        await login(best.user);
        return;
      }
      // No match
      setError(
        best.distance < 0.60
          ? `Face not clearly recognised. Try again or use your PIN.`
          : `Face not recognised. Please contact your manager, or use your PIN.`
      );
      setMatching(false);
    } catch (e) {
      setError(e.message);
      setMatching(false);
    }
  };

  // ── Face-verify after PIN ──────────────────────────────────────────────
  const handleFaceVerifyCapture = async (descriptor) => {
    setFaceCaptureOpen(false);
    if (!pendingUser) return;
    const distance = descriptorDistance(descriptor, pendingUser.faceDescriptor);
    if (distance < 0.55) {
      await login(pendingUser);
      setPendingUser(null);
    } else {
      setError(
        distance < 0.65
          ? `Face didn't match (similarity ${((1-distance)*100).toFixed(0)}%). Try again.`
          : `Face doesn't match ${pendingUser.name}. Try again or use a different PIN.`
      );
      setPendingUser(null);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────
  if (authMode === 'auto') {
    return (
      <div className="pin-screen">
        <div className="loader"><div className="spinner" /></div>
      </div>
    );
  }

  return (
    <>
      <div className="pin-screen">
        {authMode === 'face' && !matching && (
          <div className="auth-card auth-card--face">
            <div className="auth-face-orb">
              <div className="auth-face-ring" />
              <div className="auth-face-ring auth-face-ring--2" />
              <div className="auth-face-icon">👤</div>
            </div>
            <h2 style={{ margin: '20px 0 4px', fontSize: 24 }}>Welcome back</h2>
            <p className="auth-sub">
              {modeLabel(device.mode)} · {device.deviceName}
            </p>

            {error && <div className="auth-error">{error}</div>}

            <button
              className="btn btn-primary btn-lg btn-block auth-face-cta"
              onClick={() => { setError(''); setFaceCaptureOpen(true); }}
              style={{ marginTop: 20 }}
            >
              📸 Sign in with face
            </button>

            <button
              className="btn-ghost auth-fallback"
              onClick={() => { setError(''); setAuthMode('pin'); }}
            >
              Use PIN instead →
            </button>

            <div className="auth-help">
              Face not recognised? Contact your manager for help signing in.
            </div>
          </div>
        )}

        {matching && (
          <div className="auth-card">
            <div className="auth-face-orb auth-face-orb--scanning">
              <div className="auth-face-ring" />
              <div className="auth-face-ring auth-face-ring--2" />
              <div className="auth-face-icon">🔍</div>
            </div>
            <h2 style={{ margin: '20px 0 4px', fontSize: 22 }}>Identifying…</h2>
            <p className="auth-sub">Matching against enrolled staff</p>
          </div>
        )}

        {authMode === 'pin' && (
          <div className="pin-card">
            <h2>{modeLabel(device.mode)}</h2>
            <div className="subtitle">
              {device.deviceName} · Enter your 4-digit PIN
              {faceRequired && (
                <span className="pin-face-badge">
                  🔒 FACE ID — if enrolled
                </span>
              )}
            </div>

            <div className="pin-dots">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className={`pin-dot ${i < pin.length ? 'filled' : ''}`} />
              ))}
            </div>
            <div className="pin-error">{error}</div>

            <div className="pin-grid">
              {['1','2','3','4','5','6','7','8','9'].map(d => (
                <button key={d} className="pin-key" onClick={() => append(d)}>{d}</button>
              ))}
              <button className="pin-key muted" onClick={back}>Del</button>
              <button className="pin-key" onClick={() => append('0')}>0</button>
              <button className="pin-key muted" onClick={() => reset()}>Setup</button>
            </div>

            {faceRequired && (
              <button
                className="btn-ghost"
                onClick={() => { setError(''); setPin(''); setAuthMode('face'); }}
                style={{ marginTop: 14 }}
              >
                ← Use face instead
              </button>
            )}

            <div className="pin-hint">
              Demo PINs · Manager <code>1234</code> · Waiter <code>1111</code> · Kitchen <code>2222</code> · Cashier <code>3333</code>
            </div>
          </div>
        )}
      </div>

      {/* Face capture overlay — used for both face-first and face-verify */}
      {faceCaptureOpen && (
        <FaceCapture
          mode="verify"
          userName={pendingUser?.name || 'staff sign-in'}
          onCapture={pendingUser ? handleFaceVerifyCapture : handleFaceFirstCapture}
          onCancel={() => {
            setFaceCaptureOpen(false);
            setPendingUser(null);
            setError('');
          }}
        />
      )}
    </>
  );
}

function modeLabel(m) {
  return m === 'kitchen' ? 'Kitchen Display'
       : m === 'floor'   ? 'Floor / Table Mode'
       : 'Till POS';
}
