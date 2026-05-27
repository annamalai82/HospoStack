import { useEffect, useState, useCallback } from 'react';
import { getVenue, readGeofenceOverride, clearGeofenceOverride } from '../lib/data';
import { getCurrentLocation, distanceMeters } from '../lib/geo';
import GeofenceOverrideModal from './GeofenceOverrideModal';

/**
 * GeofenceGate — wraps the entire app.
 *
 * Blocks usage if device is outside the venue's geofence — UNLESS an active
 * manager override is in effect. Overrides expire automatically.
 *
 * On the blocked screen there's a "Manager Override" button → opens
 * GeofenceOverrideModal → PIN + optional face check + reason + duration.
 *
 * Re-checks every 60 seconds (and clears expired overrides on each tick).
 */
export default function GeofenceGate({ children }) {
  const [state, setState]               = useState({ status: 'checking', message: 'Checking location…' });
  const [venue, setVenue]               = useState(null);
  const [override, setOverride]         = useState(() => readGeofenceOverride());
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [, forceTick]                   = useState(0);

  // Tick once per second so the override countdown updates live
  useEffect(() => {
    if (!override) return;
    const id = setInterval(() => {
      // Expired? Clear it.
      if (Date.now() > override.expiresAt) {
        clearGeofenceOverride();
        setOverride(null);
        // Force a re-check now that override is gone
        check();
      } else {
        forceTick(t => t + 1);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [override]); // eslint-disable-line

  const check = useCallback(async (venueOverride) => {
    const v = venueOverride || venue;
    if (!v) {
      const fetched = await getVenue();
      setVenue(fetched);
      return doCheck(fetched);
    }
    return doCheck(v);
  }, [venue]);

  const doCheck = async (v) => {
    if (!v?.geofenceEnabled) {
      setState({ status: 'ok', message: 'Geofence disabled' });
      return;
    }
    if (!v.lat || !v.lng) {
      setState({
        status: 'venue_not_configured',
        message: 'Venue location not set. Open Config → Venue Settings to set the venue address.',
      });
      return;
    }

    const loc = await getCurrentLocation();
    if (!loc.ok) {
      setState({
        status: loc.reason,
        message: locationErrorMessage(loc.reason),
        details: loc.message,
        currentLocation: null,
        distance: null,
      });
      return;
    }

    const distance = distanceMeters(loc, { lat: v.lat, lng: v.lng });
    const allowed = distance <= (v.geofenceMeters || 200);
    if (allowed) {
      setState({
        status: 'ok', message: `${Math.round(distance)}m from venue`,
        distance, accuracy: loc.accuracy,
        currentLocation: loc,
      });
    } else {
      setState({
        status: 'out_of_range',
        message: `${Math.round(distance)}m from venue — must be within ${v.geofenceMeters}m`,
        distance,
        venueDistance: Math.round(distance),
        radius: v.geofenceMeters,
        currentLocation: loc,
      });
    }
  };

  // Initial check + 60-sec re-check
  useEffect(() => {
    check();
    const id = setInterval(() => check(), 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line
  }, []);

  // ── Override is active → render children with persistent banner ──
  // The banner is position:fixed at top; we push the page down by adding
  // a class on <html> which applies padding-top via CSS. This works even
  // when children use 100dvh / position:fixed (like the PinScreen).
  useEffect(() => {
    if (override) {
      document.documentElement.classList.add('has-override-banner');
    } else {
      document.documentElement.classList.remove('has-override-banner');
    }
    return () => document.documentElement.classList.remove('has-override-banner');
  }, [override]);

  if (override) {
    return (
      <>
        <OverrideBanner
          override={override}
          state={state}
          onClear={() => {
            if (confirm('Cancel the active geofence override? You will need to be inside the venue (or grant a new override) to continue using the app.')) {
              clearGeofenceOverride();
              setOverride(null);
              check();
            }
          }}
        />
        {children}
      </>
    );
  }

  // ── No override — show children only when within geofence ──
  if (state.status === 'ok') return children;
  if (state.status === 'checking') return <LoadingScreen message={state.message} />;

  return (
    <>
      <BlockedScreen
        state={state}
        venue={venue}
        onRetry={() => { setState({ status: 'checking', message: 'Re-checking…' }); check(); }}
        onRequestOverride={() => setShowOverrideModal(true)}
      />
      {showOverrideModal && (
        <GeofenceOverrideModal
          venue={venue}
          deviceName={(() => {
            try { return JSON.parse(localStorage.getItem('hospostack.device') || '{}')?.deviceName || ''; }
            catch { return ''; }
          })()}
          mode={(() => {
            try { return JSON.parse(localStorage.getItem('hospostack.device') || '{}')?.mode || ''; }
            catch { return ''; }
          })()}
          currentLocation={state.currentLocation || null}
          distanceFromVenue={state.distance || null}
          onGranted={(o) => {
            setOverride(o);
            setShowOverrideModal(false);
          }}
          onCancel={() => setShowOverrideModal(false)}
        />
      )}
    </>
  );
}

// ─── Active override banner (visible across all modes) ────────────────────
function OverrideBanner({ override, state, onClear }) {
  const remainingMs = Math.max(0, override.expiresAt - Date.now());
  const mins = Math.floor(remainingMs / 60_000);
  const secs = Math.floor((remainingMs % 60_000) / 1000);
  const remainingLabel = mins >= 60
    ? `${Math.floor(mins/60)}h ${mins%60}m`
    : mins >= 1
    ? `${mins}m ${String(secs).padStart(2,'0')}s`
    : `${secs}s`;

  const warning = mins < 5;

  return (
    <div className={`override-banner ${warning ? 'warning' : ''}`}>
      <span className="override-banner-icon">🔓</span>
      <div className="override-banner-text">
        <b>Geofence override active</b>
        <span className="override-banner-meta">
          by {override.userName} · {override.reason} ·
          <b style={{ marginLeft: 4 }}>{remainingLabel} left</b>
          {state?.status === 'out_of_range' && (
            <span style={{ marginLeft: 8, opacity: 0.85 }}>· ~{state.venueDistance}m off-site</span>
          )}
        </span>
      </div>
      <button className="override-banner-clear" onClick={onClear} title="Cancel override">
        Cancel
      </button>
    </div>
  );
}

function locationErrorMessage(reason) {
  switch (reason) {
    case 'permission_denied':
      return 'Location access blocked. Enable location in your browser/device settings.';
    case 'unavailable':
      return 'Device location is turned OFF. Turn on Location Services to continue.';
    case 'timeout':
      return "Couldn't get a location fix. Make sure you're near a window or outdoors and try again.";
    case 'unsupported':
      return 'This device or browser does not support geolocation. Update your browser.';
    default:
      return 'Location check failed.';
  }
}

function LoadingScreen({ message }) {
  return (
    <div className="geofence-gate">
      <div className="geofence-card">
        <div className="geofence-spinner" />
        <h2 style={{ marginTop: 16 }}>📍 {message}</h2>
        <p style={{ color: 'var(--text-3)', fontSize: 13, marginTop: 8 }}>
          This only takes a moment…
        </p>
      </div>
    </div>
  );
}

function BlockedScreen({ state, venue, onRetry, onRequestOverride }) {
  const isPermission = state.status === 'permission_denied' || state.status === 'unavailable';
  const isRange      = state.status === 'out_of_range';
  const isVenue      = state.status === 'venue_not_configured';

  return (
    <div className="geofence-gate">
      <div className="geofence-card">
        <div className="geofence-icon">
          {isRange ? '📍' : isVenue ? '⚙' : '🔒'}
        </div>
        <h2>
          {isRange ? 'Outside venue area'
           : isVenue ? 'Venue not configured'
           : 'Location required'}
        </h2>
        <p style={{ color: 'var(--text-2)', lineHeight: 1.6, marginTop: 12 }}>{state.message}</p>

        {isRange && venue && (
          <div style={{
            background: 'var(--surface-2)', borderRadius: 'var(--radius)',
            padding: 14, margin: '16px 0', fontSize: 13, color: 'var(--text-2)',
            display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'left',
          }}>
            <div><b>Venue:</b> {venue.name}</div>
            {venue.address && <div><b>Address:</b> {venue.address}</div>}
            <div><b>You are:</b> ~{state.venueDistance}m away</div>
            <div><b>Allowed within:</b> {state.radius}m radius</div>
          </div>
        )}

        {isPermission && (
          <div style={{
            background: 'var(--amber-deep)',
            border: '1px solid rgba(251,191,36,0.25)',
            borderRadius: 'var(--radius)', padding: 14, margin: '16px 0',
            fontSize: 13, color: 'var(--amber)', lineHeight: 1.7, textAlign: 'left',
          }}>
            <b style={{ display: 'block', marginBottom: 6 }}>To enable location:</b>
            <div style={{ marginBottom: 4 }}><b>iOS / Safari:</b> Settings → Safari → Location → Allow</div>
            <div style={{ marginBottom: 4 }}><b>Android Chrome:</b> Settings → Site Settings → Location → Allow</div>
            <div style={{ marginBottom: 4 }}><b>Windows / Mac:</b> Click the 🔒 lock icon in the address bar → Location → Allow</div>
            <div><b>Then click the button below.</b></div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={onRetry}>
            🔄 Try again
          </button>
          <button
            className="btn"
            onClick={onRequestOverride}
            style={{ borderColor: 'color-mix(in srgb, var(--amber) 40%, var(--btn-border))' }}
          >
            🔓 Manager override
          </button>
        </div>

        {state.details && (
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 16 }}>
            Diagnostic: {state.details}
          </div>
        )}

        <div style={{
          fontSize: 11, color: 'var(--text-3)', marginTop: 22,
          paddingTop: 14, borderTop: '1px solid var(--border)', lineHeight: 1.6
        }}>
          🔓 <b>Manager Override</b> temporarily disables the geofence for off-site work
          (catering, setup at a new venue, training, etc). Requires a manager PIN
          {venue?.faceAuthEnabled ? ' + face verification' : ''}.
          Every override is audit-logged.
        </div>
      </div>
    </div>
  );
}
