import { useEffect, useState } from 'react';
import { getVenue, updateVenue } from '../lib/data';
import { getCurrentLocation, reverseGeocode, geocodeAddress } from '../lib/geo';

const TIMEZONES = [
  'Australia/Perth', 'Australia/Sydney', 'Australia/Melbourne',
  'Australia/Brisbane', 'Australia/Adelaide', 'Australia/Darwin',
  'Australia/Hobart', 'Pacific/Auckland', 'Asia/Singapore'
];

export default function VenuePanel({ onToast }) {
  const [venue, setVenue]       = useState(null);
  // Identity
  const [name, setName]         = useState('');
  const [abn, setAbn]           = useState('');
  const [gstPct, setGstPct]     = useState('10');
  const [timezone, setTimezone] = useState('Australia/Perth');
  const [phone, setPhone]       = useState('');
  const [address, setAddress]   = useState('');
  const [currency, setCurrency] = useState('AUD');

  // Geofence
  const [geofenceEnabled, setGeofenceEnabled] = useState(false);
  const [lat, setLat]                         = useState('');
  const [lng, setLng]                         = useState('');
  const [geofenceMeters, setGeofenceMeters]   = useState('200');
  const [faceAuthEnabled, setFaceAuthEnabled] = useState(false);
  const [locating, setLocating]               = useState(false);
  const [locStatus, setLocStatus]             = useState('');

  // Surcharge
  const [sundaySurchargeEnabled, setSundaySurchargeEnabled] = useState(false);
  const [sundaySurchargePct,     setSundaySurchargePct]     = useState('10');
  const [publicHolidaySurchargeEnabled, setPublicHolidaySurchargeEnabled] = useState(false);
  const [publicHolidaySurchargePct,     setPublicHolidaySurchargePct]     = useState('15');
  const [cardSurchargeEnabled,   setCardSurchargeEnabled]   = useState(false);
  const [cardSurchargePct,       setCardSurchargePct]       = useState('1.5');

  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [err, setErr]       = useState('');

  useEffect(() => {
    getVenue().then(v => {
      if (!v) return;
      setVenue(v);
      setName(v.name || '');
      setAbn(v.abn || '');
      setGstPct(String(v.gstPct ?? 10));
      setTimezone(v.timezone || 'Australia/Perth');
      setPhone(v.phone || '');
      setAddress(v.address || '');
      setCurrency(v.currency || 'AUD');
      setGeofenceEnabled(!!v.geofenceEnabled);
      setLat(v.lat?.toString() || '');
      setLng(v.lng?.toString() || '');
      setGeofenceMeters(String(v.geofenceMeters || 200));
      setFaceAuthEnabled(!!v.faceAuthEnabled);
      setSundaySurchargeEnabled(!!v.sundaySurchargeEnabled);
      setSundaySurchargePct(String(v.sundaySurchargePct ?? 10));
      setPublicHolidaySurchargeEnabled(!!v.publicHolidaySurchargeEnabled);
      setPublicHolidaySurchargePct(String(v.publicHolidaySurchargePct ?? 15));
      setCardSurchargeEnabled(!!v.cardSurchargeEnabled);
      setCardSurchargePct(String(v.cardSurchargePct ?? 1.5));
    });
  }, []);

  // ── Geolocation helpers ────────────────────────────────────────────────
  const useMyLocation = async () => {
    setLocating(true);
    setLocStatus('Getting your location…');
    const loc = await getCurrentLocation();
    setLocating(false);
    if (!loc.ok) {
      setLocStatus('Location failed: ' + (loc.reason === 'permission_denied' ? 'permission denied' : loc.reason));
      return;
    }
    setLat(loc.lat.toFixed(6));
    setLng(loc.lng.toFixed(6));
    setLocStatus(`✓ Set to your current location (±${Math.round(loc.accuracy)}m)`);
    // Reverse-geocode and offer to fill address
    const rev = await reverseGeocode(loc.lat, loc.lng);
    if (rev.ok && !address.trim()) setAddress(rev.address);
  };

  const useAddressLocation = async () => {
    if (!address.trim()) return setLocStatus('Enter an address first');
    setLocating(true);
    setLocStatus('Geocoding address…');
    const r = await geocodeAddress(address);
    setLocating(false);
    if (!r.ok) {
      setLocStatus('Could not find that address — try entering lat/lng manually');
      return;
    }
    setLat(r.lat.toFixed(6));
    setLng(r.lng.toFixed(6));
    setLocStatus(`✓ Located: ${r.address.slice(0, 60)}${r.address.length > 60 ? '…' : ''}`);
  };

  const save = async () => {
    if (!name.trim()) return setErr('Venue name is required');
    if (geofenceEnabled && (!lat || !lng)) return setErr('Geofence requires lat/lng coordinates — click "Use my location" or "Locate from address"');
    setErr('');
    setSaving(true);
    try {
      await updateVenue({
        name:     name.trim(),
        abn:      abn.trim(),
        gstPct:   parseFloat(gstPct) || 0,
        timezone,
        phone:    phone.trim(),
        address:  address.trim(),
        currency: currency.trim() || 'AUD',
        // Geofence
        geofenceEnabled,
        lat: lat ? parseFloat(lat) : null,
        lng: lng ? parseFloat(lng) : null,
        geofenceMeters: parseInt(geofenceMeters, 10) || 200,
        // Biometrics
        faceAuthEnabled,
        // Surcharges
        sundaySurchargeEnabled,
        sundaySurchargePct: parseFloat(sundaySurchargePct) || 0,
        publicHolidaySurchargeEnabled,
        publicHolidaySurchargePct: parseFloat(publicHolidaySurchargePct) || 0,
        cardSurchargeEnabled,
        cardSurchargePct: parseFloat(cardSurchargePct) || 0,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      onToast?.('✓ Venue settings saved');
    } catch (e) { setErr('Save failed: ' + e.message); }
    finally   { setSaving(false); }
  };

  if (!venue) return <div className="loader"><div className="spinner" /></div>;

  const Toggle = ({ on, onChange, label, sub }) => (
    <label style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
      background: on ? 'color-mix(in srgb, var(--brand) 8%, var(--surface))' : 'var(--surface-2)',
      border: `1.5px solid ${on ? 'color-mix(in srgb, var(--brand) 35%, transparent)' : 'var(--border)'}`,
      borderRadius: 'var(--radius)', cursor: 'pointer',
      transition: 'all 120ms', marginBottom: 8,
    }}>
      <input type="checkbox" checked={on} onChange={e => onChange(e.target.checked)} style={{ width: 'auto' }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, color: on ? 'var(--brand)' : 'var(--text)' }}>{label}</div>
        {sub && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{sub}</div>}
      </div>
    </label>
  );

  return (
    <>
      <h3>Venue Settings</h3>
      <p className="subtitle">Details shown on receipts, reports, and the booking confirmation page.</p>

      <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 0 }}>

        {/* ── Identity ── */}
        <div className="section" style={{ marginBottom: 0 }}>
          <div className="section-head"><h4>Identity</h4></div>
          <div className="field">
            <label>Venue name <span style={{ color: 'var(--red)' }}>*</span></label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Sizzle N Sambar" />
          </div>
          <div className="field-row">
            <div className="field">
              <label>ABN</label>
              <input value={abn} onChange={e => setAbn(e.target.value)} placeholder="97 668 265 683" style={{ fontFamily: 'var(--font-mono)' }} />
            </div>
            <div className="field">
              <label>Currency</label>
              <select value={currency} onChange={e => setCurrency(e.target.value)}>
                <option value="AUD">AUD — Australian Dollar</option>
                <option value="NZD">NZD — New Zealand Dollar</option>
                <option value="SGD">SGD — Singapore Dollar</option>
                <option value="USD">USD — US Dollar</option>
                <option value="GBP">GBP — British Pound</option>
              </select>
            </div>
          </div>
        </div>

        {/* ── Tax ── */}
        <div className="section" style={{ marginBottom: 0 }}>
          <div className="section-head"><h4>Tax</h4></div>
          <div className="field-row">
            <div className="field">
              <label>GST / Tax %</label>
              <input value={gstPct} onChange={e => setGstPct(e.target.value)} inputMode="decimal" placeholder="10" style={{ fontFamily: 'var(--font-mono)' }} />
            </div>
            <div className="field">
              <label>Timezone</label>
              <select value={timezone} onChange={e => setTimezone(e.target.value)}>
                {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* ── Contact + Address ── */}
        <div className="section" style={{ marginBottom: 0 }}>
          <div className="section-head"><h4>Contact &amp; Address</h4></div>
          <div className="field">
            <label>Phone number</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="08 9XXX XXXX" type="tel" style={{ fontFamily: 'var(--font-mono)' }} />
          </div>
          <div className="field">
            <label>Address</label>
            <input value={address} onChange={e => setAddress(e.target.value)} placeholder="13/964 Albany Hwy, East Victoria Park WA 6101" />
          </div>
        </div>

        {/* ── Security & Location ── */}
        <div className="section" style={{ marginBottom: 0 }}>
          <div className="section-head">
            <h4>🔒 Security &amp; Location</h4>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 14, lineHeight: 1.6 }}>
            Restrict the app to be used only on-premises and require staff face verification on login.
          </p>

          <Toggle
            on={geofenceEnabled}
            onChange={setGeofenceEnabled}
            label="📍 Geofence the app to this venue"
            sub="Block app use when the device is outside the venue radius. Devices must have location services ON."
          />

          {geofenceEnabled && (
            <div style={{
              background: 'var(--bg-2)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: 16, marginBottom: 16,
              display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              <div className="field-row">
                <div className="field">
                  <label>Latitude</label>
                  <input value={lat} onChange={e => setLat(e.target.value)} placeholder="-31.9886" style={{ fontFamily: 'var(--font-mono)' }} />
                </div>
                <div className="field">
                  <label>Longitude</label>
                  <input value={lng} onChange={e => setLng(e.target.value)} placeholder="115.8893" style={{ fontFamily: 'var(--font-mono)' }} />
                </div>
              </div>
              <div className="field">
                <label>Allowed radius (metres)</label>
                <input value={geofenceMeters} onChange={e => setGeofenceMeters(e.target.value)} inputMode="numeric" placeholder="200" style={{ fontFamily: 'var(--font-mono)' }} />
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                  100m suits a small venue, 300m gives a buffer for larger sites, 1000m for a precinct.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn btn-sm" onClick={useMyLocation} disabled={locating}>
                  📱 Use my current location
                </button>
                <button className="btn btn-sm" onClick={useAddressLocation} disabled={locating || !address.trim()}>
                  🗺 Locate from address above
                </button>
              </div>
              {locStatus && (
                <div style={{ fontSize: 12, color: locStatus.startsWith('✓') ? 'var(--green)' : 'var(--text-2)' }}>
                  {locStatus}
                </div>
              )}
              {lat && lng && (
                <a
                  href={`https://maps.google.com/?q=${lat},${lng}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 12, color: 'var(--brand)', textDecoration: 'underline' }}
                >
                  View on Google Maps →
                </a>
              )}
            </div>
          )}

          <Toggle
            on={faceAuthEnabled}
            onChange={setFaceAuthEnabled}
            label="🔍 Enable face verification at login"
            sub="When a user with an enrolled face signs in, the camera captures their face and verifies it matches their enrolled photo. Users without an enrolled face sign in with PIN only. Enroll faces under Users & PINs → 📸 icon."
          />
        </div>

        {/* ── Surcharges ── */}
        <div className="section" style={{ marginBottom: 0 }}>
          <div className="section-head">
            <h4>💰 Surcharges</h4>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 14, lineHeight: 1.6 }}>
            Automatic surcharges applied to all orders. Cashiers can also apply one-off surcharges at the till.
          </p>

          <Toggle
            on={sundaySurchargeEnabled}
            onChange={setSundaySurchargeEnabled}
            label="📅 Sunday surcharge"
            sub="Auto-add a percentage surcharge to all orders on Sundays."
          />
          {sundaySurchargeEnabled && (
            <div className="field" style={{ marginTop: -2, marginBottom: 12, maxWidth: 200 }}>
              <label style={{ fontSize: 11 }}>Sunday surcharge %</label>
              <input
                value={sundaySurchargePct}
                onChange={e => setSundaySurchargePct(e.target.value)}
                inputMode="decimal"
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            </div>
          )}

          <Toggle
            on={publicHolidaySurchargeEnabled}
            onChange={setPublicHolidaySurchargeEnabled}
            label="🎉 Public holiday surcharge"
            sub="Cashier toggles this at the till on public holidays."
          />
          {publicHolidaySurchargeEnabled && (
            <div className="field" style={{ marginTop: -2, marginBottom: 12, maxWidth: 200 }}>
              <label style={{ fontSize: 11 }}>Public holiday surcharge %</label>
              <input
                value={publicHolidaySurchargePct}
                onChange={e => setPublicHolidaySurchargePct(e.target.value)}
                inputMode="decimal"
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            </div>
          )}

          <Toggle
            on={cardSurchargeEnabled}
            onChange={setCardSurchargeEnabled}
            label="💳 Card surcharge"
            sub="Auto-add a percentage to orders paid by card / EFTPOS (offsets merchant fees)."
          />
          {cardSurchargeEnabled && (
            <div className="field" style={{ marginTop: -2, marginBottom: 12, maxWidth: 200 }}>
              <label style={{ fontSize: 11 }}>Card surcharge %</label>
              <input
                value={cardSurchargePct}
                onChange={e => setCardSurchargePct(e.target.value)}
                inputMode="decimal"
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            </div>
          )}
        </div>

        {err && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 10, marginTop: 20, alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {saved && <span style={{ color: 'var(--green)', fontSize: 13 }}>✓ Saved</span>}
        </div>

        <div style={{
          marginTop: 28, padding: '10px 14px',
          background: 'var(--surface-2)', borderRadius: 8,
          fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)'
        }}>
          Venue ID: {venue.id}
        </div>
      </div>
    </>
  );
}
