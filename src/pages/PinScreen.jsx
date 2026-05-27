import { useEffect, useState } from 'react';
import { useDevice } from '../context/DeviceContext';
import { findUserByPin, getVenue } from '../lib/data';
import { descriptorDistance } from '../lib/face';
import FaceCapture from '../components/FaceCapture';

export default function PinScreen() {
  const { device, login, reset } = useDevice();
  const [pin,   setPin]   = useState('');
  const [error, setError] = useState('');
  const [pendingUser, setPendingUser] = useState(null);  // user who passed PIN, awaiting face check
  const [faceRequired, setFaceRequired] = useState(false);

  // Load venue settings to know if face check is required
  useEffect(() => {
    getVenue().then(v => setFaceRequired(!!v?.faceAuthEnabled));
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (pendingUser) return;  // disable keypad during face check
      if (e.key >= '0' && e.key <= '9') append(e.key);
      else if (e.key === 'Backspace') back();
      else if (e.key === 'Enter') submit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line
  }, [pin, pendingUser]);

  const append = (d) => {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    setError('');
    if (next.length === 4) setTimeout(() => trySubmit(next), 80);
  };

  const back = () => { setPin(p => p.slice(0, -1)); setError(''); };
  const submit = () => trySubmit(pin);

  const trySubmit = async (p) => {
    if (p.length !== 4) return;
    try {
      const user = await findUserByPin(p);
      if (!user) {
        setError('Invalid PIN');
        setPin('');
        return;
      }
      // ── Role check ────────────────────────────────────────────────────
      // Managers can use any device. Kitchen staff can only use kitchen.
      // Waiters and cashiers can use either floor OR till devices (these
      // are customer-facing roles that overlap in practice — many small
      // venues have staff that both take orders and process payments).
      if (user.role === 'kitchen' && device.mode !== 'kitchen') {
        setError(`${user.name} is kitchen staff — please use the Kitchen Display device.`);
        setPin('');
        return;
      }
      if (user.role !== 'manager' && device.mode === 'kitchen' && user.role !== 'kitchen') {
        setError(`${user.name} is a ${user.role} — Kitchen Display requires kitchen staff.`);
        setPin('');
        return;
      }
      // Manager / waiter / cashier on till or floor → allowed

      // ── Face verification gate ─────────────────────────────────────────
      // Face auth is per-user. If venue has the feature enabled AND this
      // particular user has enrolled a face, require a match.
      // If the user has NO enrolled face, allow PIN-only login so the
      // first manager can always get in to enroll the others.
      if (faceRequired && user.faceDescriptor?.length === 128) {
        setPendingUser(user);  // open face capture
        setPin('');
        return;
      }

      // No face enrolled (or feature off) → PIN-only login
      await login(user);
    } catch (e) {
      setError(e.message);
      setPin('');
    }
  };

  // ── Handle face capture result ─────────────────────────────────────────
  const handleFaceCaptured = async (descriptor) => {
    if (!pendingUser) return;
    const distance = descriptorDistance(descriptor, pendingUser.faceDescriptor);
    // Threshold: < 0.55 = match, > 0.60 = clear mismatch
    if (distance < 0.55) {
      // Match ✓
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

  return (
    <>
      <div className="pin-screen">
        <div className="pin-card">
          <h2>{modeLabel(device.mode)}</h2>
          <div className="subtitle">
            {device.deviceName} · Enter your 4-digit PIN
            {faceRequired && (
              <span style={{
                display: 'inline-block', marginLeft: 8, padding: '2px 8px',
                background: 'var(--brand-deep)', color: 'var(--brand)',
                borderRadius: 999, fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
              }}>
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

          <div className="pin-hint">
            Demo PINs · Manager <code>1234</code> · Waiter <code>1111</code> · Kitchen <code>2222</code> · Cashier <code>3333</code>
          </div>
        </div>
      </div>

      {/* Face capture overlay */}
      {pendingUser && (
        <FaceCapture
          mode="verify"
          userName={pendingUser.name}
          onCapture={handleFaceCaptured}
          onCancel={() => { setPendingUser(null); setError(''); }}
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
