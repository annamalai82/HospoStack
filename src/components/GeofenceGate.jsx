import { useEffect, useState, useCallback } from 'react';
import { getVenue } from '../lib/data';
import { getCurrentLocation, distanceMeters, watchLocation } from '../lib/geo';

/**
 * GeofenceGate — wraps the entire app.
 * 
 * Blocks usage if:
 *   - Browser doesn't support geolocation
 *   - User has denied location permission
 *   - Device is more than `venue.geofenceMeters` from the venue's lat/lng
 * 
 * Allows usage if:
 *   - Venue has no geofence configured (locked = false at venue level)
 *   - Device is within the geofence radius
 * 
 * Re-checks every 60 seconds in background while app is active.
 */
export default function GeofenceGate({ children }) {
  const [state, setState] = useState({ status: 'checking', message: 'Checking location…' });
  const [venue, setVenue] = useState(null);

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
    // If venue hasn't enabled geofencing → pass
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
      });
      return;
    }

    const distance = distanceMeters(loc, { lat: v.lat, lng: v.lng });
    const allowed = distance <= (v.geofenceMeters || 200);
    if (allowed) {
      setState({
        status: 'ok',
        message: `${Math.round(distance)}m from venue`,
        distance,
        accuracy: loc.accuracy,
      });
    } else {
      setState({
        status: 'out_of_range',
        message: `${Math.round(distance)}m from venue — must be within ${v.geofenceMeters}m`,
        distance,
        venueDistance: Math.round(distance),
        radius: v.geofenceMeters,
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

  if (state.status === 'ok') return children;
  if (state.status === 'checking') {
    return <LoadingScreen message={state.message} />;
  }
  return <BlockedScreen state={state} venue={venue} onRetry={() => { setState({ status: 'checking', message: 'Re-checking…' }); check(); }} />;
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

function BlockedScreen({ state, venue, onRetry }) {
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
            display: 'flex', flexDirection: 'column', gap: 4,
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
          {state.details && (
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 10, width: '100%' }}>
              Diagnostic: {state.details}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
