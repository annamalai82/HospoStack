import { useState, useEffect } from 'react';
import { findUserByPin, getVenue, grantGeofenceOverride } from '../lib/data';
import { descriptorDistance } from '../lib/face';
import { getCurrentLocation, distanceMeters } from '../lib/geo';
import FaceCapture from './FaceCapture';

/**
 * GeofenceOverrideModal — manager-authorized temporary geofence bypass.
 *
 * Flow:
 *   1. Manager enters their 4-digit PIN
 *   2. If venue has face auth enabled AND user has enrolled face,
 *      a face capture step verifies they are who they say they are
 *   3. Manager enters a reason (required) and selects a duration
 *   4. Override is granted — stored in sessionStorage + audit logged to Firestore
 *
 * Security:
 *   - PIN must belong to a user with role='manager'
 *   - Face match required if venue.faceAuthEnabled = true
 *   - Override expires automatically at the selected duration
 *   - Override is per-browser-tab (sessionStorage clears on close)
 *   - Every grant is logged with user, time, reason, location snapshot
 */
export default function GeofenceOverrideModal({ venue, onGranted, onCancel, deviceName, mode, currentLocation, distanceFromVenue }) {
  const [step, setStep]           = useState('pin');  // pin | face | details | granting
  const [pin, setPin]             = useState('');
  const [error, setError]         = useState('');
  const [authedUser, setAuthedUser] = useState(null);
  const [reason, setReason]       = useState('');
  const [durationKey, setDurationKey] = useState('60');  // minutes
  const [faceRequired, setFaceRequired] = useState(false);

  useEffect(() => {
    setFaceRequired(!!venue?.faceAuthEnabled);
  }, [venue]);

  const DURATIONS = [
    { key: '15',  label: '15 min',  ms: 15 * 60_000,        sub: 'Quick task' },
    { key: '60',  label: '1 hour',  ms: 60 * 60_000,        sub: 'Off-site work' },
    { key: '240', label: '4 hours', ms: 4  * 60 * 60_000,   sub: 'Half-shift' },
    { key: '720', label: '12 hours', ms: 12 * 60 * 60_000,   sub: 'Full shift' },
  ];

  // ── PIN entry ──────────────────────────────────────────────────────────
  const tryPin = async (p) => {
    if (p.length !== 4) return;
    try {
      const user = await findUserByPin(p);
      if (!user) {
        setError('Invalid PIN');
        setPin('');
        return;
      }
      if (user.role !== 'manager') {
        setError(`${user.name} is a ${user.role}. Only managers can override the geofence.`);
        setPin('');
        return;
      }
      setAuthedUser(user);
      setError('');
      // Branch on face requirement
      if (faceRequired && user.faceDescriptor?.length === 128) {
        setStep('face');
      } else {
        setStep('details');
      }
    } catch (e) {
      setError(e.message);
      setPin('');
    }
  };

  const appendPin = (d) => {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    setError('');
    if (next.length === 4) setTimeout(() => tryPin(next), 80);
  };
  const backPin = () => { setPin(p => p.slice(0, -1)); setError(''); };

  // ── Face verify ────────────────────────────────────────────────────────
  const handleFaceCaptured = (descriptor) => {
    if (!authedUser) return;
    const d = descriptorDistance(descriptor, authedUser.faceDescriptor);
    if (d < 0.55) {
      setStep('details');
    } else {
      setError(
        d < 0.65
          ? `Face didn't match (similarity ${((1-d)*100).toFixed(0)}%). Try again.`
          : `Face doesn't match ${authedUser.name}.`
      );
      setStep('pin');
      setPin('');
      setAuthedUser(null);
    }
  };

  // ── Grant ──────────────────────────────────────────────────────────────
  const handleGrant = async () => {
    if (!reason.trim()) return setError('A reason is required');
    if (reason.trim().length < 5) return setError('Reason must be at least 5 characters');
    setStep('granting');
    try {
      const durationObj = DURATIONS.find(d => d.key === durationKey);
      const override = await grantGeofenceOverride({
        user: authedUser,
        durationMs: durationObj.ms,
        reason: reason.trim(),
        deviceName,
        mode,
        locationAtGrant: currentLocation ? {
          lat: currentLocation.lat, lng: currentLocation.lng, accuracy: currentLocation.accuracy
        } : null,
        distanceMeters: distanceFromVenue ?? null,
      });
      onGranted(override);
    } catch (e) {
      setError(e.message);
      setStep('details');
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────
  if (step === 'face') {
    return (
      <FaceCapture
        mode="verify"
        userName={`${authedUser.name} (geofence override)`}
        onCapture={handleFaceCaptured}
        onCancel={onCancel}
        zIndex={5100}
      />
    );
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 5100 }} onClick={onCancel}>
      <div className="override-modal" onClick={e => e.stopPropagation()}>
        <div className="override-head">
          <div>
            <div style={{ fontSize: 11, color: 'var(--brand)', fontWeight: 800, letterSpacing: '0.12em' }}>
              🔓 MANAGER OVERRIDE
            </div>
            <h3 style={{ margin: '4px 0 0' }}>
              {step === 'pin'      && 'Authenticate to bypass geofence'}
              {step === 'details'  && `Set override duration & reason`}
              {step === 'granting' && 'Granting override…'}
            </h3>
            {authedUser && (
              <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
                ✓ Authenticated as <b>{authedUser.name}</b> (manager)
              </div>
            )}
          </div>
          <button className="icon-btn" onClick={onCancel}>×</button>
        </div>

        <div className="override-body">
          {/* ── PIN step ── */}
          {step === 'pin' && (
            <>
              <div style={{
                background: 'var(--amber-deep)', border: '1px solid rgba(251,191,36,0.25)',
                borderRadius: 'var(--radius)', padding: '12px 14px', marginBottom: 18,
                fontSize: 13, color: 'var(--amber)', lineHeight: 1.6
              }}>
                <b>⚠ Audit logged.</b> Every override is recorded with your name, the time,
                duration, reason, and the device's location. Reports are visible in Config → Geofence Audit.
              </div>

              <div className="pin-dots" style={{ margin: '8px 0 4px' }}>
                {[0,1,2,3].map(i => (
                  <div key={i} className={`pin-dot ${i < pin.length ? 'filled' : ''}`} />
                ))}
              </div>
              {error && <div className="pin-error">{error}</div>}

              <div className="pin-grid" style={{ maxWidth: 320, margin: '14px auto 4px' }}>
                {['1','2','3','4','5','6','7','8','9'].map(d => (
                  <button key={d} className="pin-key" onClick={() => appendPin(d)}>{d}</button>
                ))}
                <button className="pin-key muted" onClick={backPin}>Del</button>
                <button className="pin-key" onClick={() => appendPin('0')}>0</button>
                <div />
              </div>

              <div style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'center', marginTop: 10 }}>
                Enter your <b>manager</b> PIN to continue
              </div>
            </>
          )}

          {/* ── Details step ── */}
          {step === 'details' && (
            <>
              {/* Duration */}
              <div style={{ marginBottom: 18 }}>
                <label style={{
                  display: 'block', fontSize: 11, fontWeight: 700,
                  color: 'var(--text-3)', textTransform: 'uppercase',
                  letterSpacing: '0.08em', marginBottom: 8
                }}>
                  Duration
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {DURATIONS.map(d => (
                    <button
                      key={d.key}
                      className={`btn-toggle ${durationKey === d.key ? 'btn-toggle--active' : ''}`}
                      onClick={() => setDurationKey(d.key)}
                      style={{ flexDirection: 'column', padding: '12px 10px', gap: 2 }}
                    >
                      <div style={{ fontSize: 15 }}>{d.label}</div>
                      <div style={{ fontSize: 10, opacity: 0.7, fontWeight: 500 }}>{d.sub}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Reason */}
              <div className="field">
                <label>
                  Reason <span style={{ color: 'var(--red)', fontWeight: 700 }}>*</span>
                  <span style={{ color: 'var(--text-3)', fontWeight: 400, marginLeft: 6, fontSize: 11 }}>
                    — visible in audit log
                  </span>
                </label>
                <textarea
                  value={reason}
                  onChange={e => { setReason(e.target.value); setError(''); }}
                  placeholder="e.g. Off-site catering at City Hall, setup mode at new venue, training session at owner's home"
                  rows={3}
                  style={{
                    fontFamily: 'inherit', fontSize: 14, lineHeight: 1.5,
                    resize: 'vertical', minHeight: 70,
                  }}
                  autoFocus
                />
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                  {reason.length} / 5 minimum characters
                </div>
              </div>

              {/* Context info */}
              {(currentLocation || distanceFromVenue !== null) && (
                <div style={{
                  background: 'var(--surface-2)', borderRadius: 'var(--radius)',
                  padding: '10px 14px', fontSize: 12, color: 'var(--text-2)', marginTop: 12,
                  fontFamily: 'var(--font-mono)', lineHeight: 1.6
                }}>
                  <div><b>Device:</b> {deviceName || '—'} ({mode || '—'})</div>
                  {distanceFromVenue !== null && (
                    <div><b>Distance from venue:</b> ~{Math.round(distanceFromVenue)}m</div>
                  )}
                  {currentLocation && (
                    <div><b>Location:</b> {currentLocation.lat.toFixed(5)}, {currentLocation.lng.toFixed(5)} (±{Math.round(currentLocation.accuracy)}m)</div>
                  )}
                </div>
              )}

              {error && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 12 }}>{error}</div>}
            </>
          )}

          {step === 'granting' && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <div className="spinner" />
              <div style={{ marginTop: 14, color: 'var(--text-2)' }}>Writing audit log…</div>
            </div>
          )}
        </div>

        {step === 'details' && (
          <div className="override-foot">
            <button className="btn-ghost" onClick={onCancel}>Cancel</button>
            <button
              className="btn btn-primary"
              onClick={handleGrant}
              disabled={!reason.trim() || reason.trim().length < 5}
            >
              🔓 Grant override
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
