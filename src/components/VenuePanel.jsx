import { useEffect, useState } from 'react';
import { getVenue, updateVenue } from '../lib/data';

const TIMEZONES = [
  'Australia/Perth',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Australia/Brisbane',
  'Australia/Adelaide',
  'Australia/Darwin',
  'Australia/Hobart',
  'Pacific/Auckland',
  'Asia/Singapore'
];

export default function VenuePanel({ onToast }) {
  const [venue, setVenue]       = useState(null);
  const [name, setName]         = useState('');
  const [abn, setAbn]           = useState('');
  const [gstPct, setGstPct]     = useState('10');
  const [timezone, setTimezone] = useState('Australia/Perth');
  const [phone, setPhone]       = useState('');
  const [address, setAddress]   = useState('');
  const [currency, setCurrency] = useState('AUD');
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [err, setErr]           = useState('');

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
    });
  }, []);

  const save = async () => {
    if (!name.trim()) { setErr('Venue name is required'); return; }
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
        currency: currency.trim() || 'AUD'
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      onToast?.('✓ Venue settings saved');
    } catch (e) {
      setErr('Save failed: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!venue) return <div className="loader"><div className="spinner" /></div>;

  return (
    <>
      <h3>Venue Settings</h3>
      <p className="subtitle">Details shown on receipts, reports, and the booking confirmation page.</p>

      <div style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 0 }}>

        {/* ── Identity ── */}
        <div className="section" style={{ marginBottom: 0 }}>
          <div className="section-head"><h4>Identity</h4></div>
          <div className="field">
            <label>Venue name <span style={{ color: 'var(--red)' }}>*</span></label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Sizzle N Sambar"
            />
          </div>
          <div className="field-row">
            <div className="field">
              <label>ABN</label>
              <input
                value={abn}
                onChange={e => setAbn(e.target.value)}
                placeholder="97 668 265 683"
                style={{ fontFamily: 'var(--font-mono)' }}
              />
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
              <input
                value={gstPct}
                onChange={e => setGstPct(e.target.value)}
                inputMode="decimal"
                placeholder="10"
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            </div>
            <div className="field">
              <label>Timezone</label>
              <select value={timezone} onChange={e => setTimezone(e.target.value)}>
                {TIMEZONES.map(tz => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* ── Contact ── */}
        <div className="section" style={{ marginBottom: 0 }}>
          <div className="section-head"><h4>Contact</h4></div>
          <div className="field">
            <label>Phone number</label>
            <input
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="08 9XXX XXXX"
              type="tel"
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </div>
          <div className="field">
            <label>Address</label>
            <input
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="13/964 Albany Hwy, East Victoria Park WA 6101"
            />
          </div>
        </div>

        {err && (
          <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{err}</div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {saved && (
            <span style={{ color: 'var(--green)', fontSize: 13, alignSelf: 'center' }}>✓ Saved</span>
          )}
        </div>

        {/* ── Venue ID (read-only) ── */}
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
