import { useState, useEffect } from 'react';
import { useDevice } from '../context/DeviceContext';
import { watchVenues, createVenueDoc, setVenueId } from '../lib/data';

const MODES = [
  {
    id: 'kitchen',
    title: 'Kitchen Display',
    role: 'Back of house',
    icon: '🔥',
    blurb: 'Live ticket board for kitchen and bar. Bump items as they go out.',
    bullets: ['Real-time order tickets', 'Station filters', 'Item-level bump & all-ready', 'Configurable wait alerts']
  },
  {
    id: 'floor',
    title: 'Floor / Table',
    role: 'Front of house',
    icon: '🍽',
    blurb: 'Take orders at the table. Send to the kitchen. No payment.',
    bullets: ['Visual table map by zone', 'Open / append to tab', 'Send-to-kitchen flow', 'Live status sync']
  },
  {
    id: 'till',
    title: 'Till POS',
    role: 'Counter / Cashier',
    icon: '💳',
    blurb: 'Full order + payment at the counter. Cash, card, split-pay.',
    bullets: ['Walk-up / takeaway orders', 'Settle dine-in tabs', 'Cash, card, split & change', 'Voucher redemption']
  },
  {
    id: 'config',
    title: 'Config Mode',
    role: 'Manager only',
    icon: '⚙',
    blurb: 'Set up menu, tables, staff, and venue settings. No live ordering.',
    bullets: ['Import menu from Excel/PDF/text/photo', 'Manage categories, modifiers, tables', 'Staff & PIN management', 'Cross-venue admin']
  }
];

export default function ConfigScreen() {
  const { configure } = useDevice();
  const [step, setStep] = useState('venue'); // venue → mode → name
  const [venues, setVenues] = useState([]);
  const [pickedVenue, setPickedVenue] = useState(null);
  const [pickedMode, setPickedMode] = useState(null);
  const [deviceName, setDeviceName] = useState('');
  const [showCreateVenue, setShowCreateVenue] = useState(false);

  useEffect(() => watchVenues(setVenues), []);

  const handleContinue = () => {
    if (!pickedVenue || !pickedMode) return;
    const name = deviceName.trim() || defaultName(pickedMode);
    // Lock the venue for this device
    setVenueId(pickedVenue.id);
    configure(pickedMode, name, pickedVenue.id, pickedVenue.name);
  };

  // ─── Step 1: pick venue ─────────────────────────────────────────────
  if (step === 'venue') {
    return (
      <div className="config-screen">
        <div className="config-card">
          <div className="config-head">
            <div className="eyebrow">HospoStack · Device Setup · Step 1 of 3</div>
            <h1>Which <span className="accent">venue</span> is this device for?</h1>
            <p>
              This device will be locked to the venue you choose. Staff can only see orders,
              menus and bookings from this location. Switching venues later requires a manager PIN.
            </p>
          </div>

          <div style={{ padding: '20px 20px 24px' }}>
            {venues.length === 0 ? (
              <div className="empty">
                <h3>No venues yet</h3>
                <p>Create the first one to get started.</p>
              </div>
            ) : (
              <div className="venue-pick-grid">
                {venues.map(v => (
                  <button
                    key={v.id}
                    className={`venue-pick-card ${pickedVenue?.id === v.id ? 'picked' : ''}`}
                    onClick={() => setPickedVenue(v)}
                  >
                    <div className="venue-pick-name">{v.name}</div>
                    <div className="venue-pick-meta">{v.id}</div>
                    {pickedVenue?.id === v.id && <div className="venue-pick-check">✓</div>}
                  </button>
                ))}
              </div>
            )}

            <button
              className="btn"
              style={{ marginTop: 12, width: '100%' }}
              onClick={() => setShowCreateVenue(true)}
            >+ Add new venue</button>
          </div>

          <div className="config-foot">
            <div style={{ flex: 1, fontSize: 12, color: 'var(--text-3)' }}>
              {pickedVenue ? <>Selected: <b style={{ color: 'var(--brand)' }}>{pickedVenue.name}</b></> : 'Pick a venue above'}
            </div>
            <button
              className="btn btn-primary btn-lg"
              disabled={!pickedVenue}
              style={{ opacity: pickedVenue ? 1 : 0.4 }}
              onClick={() => setStep('mode')}
            >Continue →</button>
          </div>
        </div>

        {showCreateVenue && (
          <NewVenueModal
            onClose={() => setShowCreateVenue(false)}
            onCreated={(id, name) => {
              setShowCreateVenue(false);
              setPickedVenue({ id, name });
            }}
          />
        )}
      </div>
    );
  }

  // ─── Step 2: pick mode ───────────────────────────────────────────────
  if (step === 'mode') {
    return (
      <div className="config-screen">
        <div className="config-card">
          <div className="config-head">
            <div className="eyebrow">
              HospoStack · Device Setup · Step 2 of 3 · <b style={{ color: 'var(--brand)' }}>{pickedVenue.name}</b>
            </div>
            <h1>Choose this device's <span className="accent">role</span></h1>
            <p>
              One backend, four interfaces. Pick the mode that matches where this device will live.
            </p>
          </div>

          <div className="mode-grid mode-grid--four">
            {MODES.map(m => (
              <button
                key={m.id}
                className="mode-card"
                aria-pressed={pickedMode === m.id}
                onClick={() => setPickedMode(m.id)}
              >
                <div className="icon">{m.icon}</div>
                <h3>{m.title}</h3>
                <div className="role">{m.role}</div>
                <p>{m.blurb}</p>
                <ul>{m.bullets.map(b => <li key={b}>{b}</li>)}</ul>
              </button>
            ))}
          </div>

          <div className="config-foot">
            <button className="btn-ghost" onClick={() => setStep('venue')}>← Venue</button>
            <button
              className="btn btn-primary btn-lg"
              disabled={!pickedMode}
              style={{ opacity: pickedMode ? 1 : 0.4 }}
              onClick={() => setStep('name')}
            >Continue →</button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Step 3: name the device ─────────────────────────────────────────
  return (
    <div className="config-screen">
      <div className="config-card">
        <div className="config-head">
          <div className="eyebrow">
            HospoStack · Device Setup · Step 3 of 3 · <b style={{ color: 'var(--brand)' }}>{pickedVenue.name}</b>
          </div>
          <h1>Name this <span className="accent">device</span></h1>
          <p>
            A friendly label so you know which device is which when reviewing sessions or troubleshooting.
            You can change it later.
          </p>
        </div>

        <div style={{ padding: '24px 32px 32px' }}>
          <div className="field">
            <label>Device name</label>
            <input
              autoFocus
              placeholder={defaultName(pickedMode)}
              value={deviceName}
              onChange={e => setDeviceName(e.target.value)}
              style={{ fontSize: 18 }}
            />
          </div>
          <div style={{
            background: 'var(--bg-2)', padding: 14, borderRadius: 8,
            fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ color: 'var(--text-3)' }}>Venue</span>
              <b>{pickedVenue.name}</b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ color: 'var(--text-3)' }}>Mode</span>
              <b>{MODES.find(m => m.id === pickedMode)?.title}</b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-3)' }}>Device</span>
              <b>{deviceName.trim() || defaultName(pickedMode)}</b>
            </div>
          </div>
        </div>

        <div className="config-foot">
          <button className="btn-ghost" onClick={() => setStep('mode')}>← Mode</button>
          <button className="btn btn-primary btn-lg" onClick={handleContinue}>
            Finish setup →
          </button>
        </div>
      </div>
    </div>
  );
}

function defaultName(mode) {
  return mode === 'kitchen' ? 'Kitchen-1'
       : mode === 'floor'   ? 'Floor-1'
       : mode === 'till'    ? 'Till-1'
       : 'Config-1';
}

// ─── New venue creation modal ──────────────────────────────────────────
function NewVenueModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [gstPct, setGstPct] = useState('10');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const create = async () => {
    if (!name.trim()) return setErr('Venue name is required');
    setErr('');
    setBusy(true);
    try {
      const id = name.trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      await createVenueDoc(id, {
        name: name.trim(),
        gstPct: parseFloat(gstPct) || 10,
        timezone: 'Australia/Perth',
        currency: 'AUD'
      });
      onCreated(id, name.trim());
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Add new venue</h3>
          <button className="icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>Venue name</label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Saffron N Sizzle Harrisdale"
            />
          </div>
          <div className="field">
            <label>GST %</label>
            <input
              type="number"
              value={gstPct}
              onChange={e => setGstPct(e.target.value)}
              style={{ maxWidth: 100 }}
            />
          </div>
          {err && <div style={{ color: 'var(--red)', fontSize: 13 }}>{err}</div>}
          <div style={{ background: 'var(--bg-2)', padding: 12, borderRadius: 8, fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6, marginTop: 8 }}>
            The new venue starts with a default manager (PIN <b style={{ color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>1234</b>).
            Set up your menu, tables, and staff from the Manager Hub once you've signed in.
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={create} disabled={busy}>
            {busy ? 'Creating…' : 'Create venue'}
          </button>
        </div>
      </div>
    </div>
  );
}
