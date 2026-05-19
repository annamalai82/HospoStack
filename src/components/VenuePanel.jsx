import { useEffect, useState } from 'react';
import { getVenue, updateVenue } from '../lib/data';

export default function VenuePanel() {
  const [venue, setVenue] = useState(null);
  const [name, setName] = useState('');
  const [abn, setAbn] = useState('');
  const [gstPct, setGstPct] = useState('10');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getVenue().then(v => {
      setVenue(v);
      setName(v?.name || '');
      setAbn(v?.abn || '');
      setGstPct(String(v?.gstPct ?? 10));
    });
  }, []);

  const save = async () => {
    setSaving(true);
    await updateVenue({
      name: name.trim(),
      abn: abn.trim(),
      gstPct: parseFloat(gstPct) || 0
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!venue) return <div className="loader"><div className="spinner" /></div>;

  return (
    <>
      <h3>Venue</h3>
      <p className="subtitle">Basic venue details shown on receipts and reports.</p>

      <div style={{ maxWidth: 480 }}>
        <div className="field">
          <label>Venue name</label>
          <input value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="field-row">
          <div className="field">
            <label>ABN</label>
            <input value={abn} onChange={e => setAbn(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} />
          </div>
          <div className="field">
            <label>GST %</label>
            <input
              value={gstPct}
              onChange={e => setGstPct(e.target.value)}
              inputMode="decimal"
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </div>
        </div>
        <div className="field">
          <label>Timezone</label>
          <input value={venue.timezone || 'Australia/Perth'} disabled style={{ opacity: 0.6 }} />
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {saved && <span style={{ color: 'var(--green)', fontSize: 13, alignSelf: 'center' }}>✓ Saved</span>}
        </div>
      </div>
    </>
  );
}
