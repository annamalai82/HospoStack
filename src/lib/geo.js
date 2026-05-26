/**
 * Geolocation utilities — venue geofencing
 * 
 * The venue stores { lat, lng, geofenceMeters } in Firestore.
 * Before allowing app use, we ask the browser for geolocation
 * and confirm the device is within `geofenceMeters` of the venue.
 */

// Earth radius in metres
const R = 6371000;

/** Haversine distance between two lat/lng points in metres */
export function distanceMeters(a, b) {
  if (!a?.lat || !b?.lat) return Infinity;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/**
 * Get current device location via browser geolocation API.
 * Returns { ok: true, lat, lng, accuracy } or { ok: false, reason, code }
 * 
 * Failure reasons:
 *   - 'unsupported'    : browser has no Geolocation API
 *   - 'permission_denied': user blocked location access
 *   - 'unavailable'    : OS reports location service is off
 *   - 'timeout'        : couldn't get a fix in time
 */
export function getCurrentLocation(timeoutMs = 15000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      return resolve({ ok: false, reason: 'unsupported' });
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        ok: true,
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }),
      (err) => {
        const map = {
          1: 'permission_denied',
          2: 'unavailable',
          3: 'timeout',
        };
        resolve({ ok: false, reason: map[err.code] || 'error', code: err.code, message: err.message });
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 }
    );
  });
}

/**
 * Watch location continuously — useful for keeping the geofence check live.
 * Returns an unsubscribe function.
 */
export function watchLocation(onUpdate, onError) {
  if (!navigator.geolocation) {
    onError?.({ reason: 'unsupported' });
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (pos) => onUpdate({
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
    }),
    (err) => {
      const map = { 1: 'permission_denied', 2: 'unavailable', 3: 'timeout' };
      onError?.({ reason: map[err.code] || 'error', code: err.code });
    },
    { enableHighAccuracy: true, timeout: 30000, maximumAge: 30000 }
  );
  return () => navigator.geolocation.clearWatch(id);
}

/**
 * Reverse-geocode using OpenStreetMap Nominatim (no API key needed).
 * Returns { ok: true, address } or { ok: false }.
 * Used by VenuePanel "Use my current location" button to autofill address.
 */
export async function reverseGeocode(lat, lng) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18`,
      { headers: { 'Accept-Language': 'en' } }
    );
    if (!r.ok) return { ok: false };
    const data = await r.json();
    return { ok: true, address: data.display_name, raw: data };
  } catch {
    return { ok: false };
  }
}

/**
 * Forward-geocode an address into lat/lng (also Nominatim).
 */
export async function geocodeAddress(address) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`,
      { headers: { 'Accept-Language': 'en' } }
    );
    if (!r.ok) return { ok: false };
    const data = await r.json();
    if (!data?.length) return { ok: false, reason: 'no_results' };
    return {
      ok: true,
      lat: parseFloat(data[0].lat),
      lng: parseFloat(data[0].lon),
      address: data[0].display_name,
    };
  } catch {
    return { ok: false };
  }
}
