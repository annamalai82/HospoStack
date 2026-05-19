import { useEffect, useRef, useState } from 'react';
import { watchVenues, getVenueId, setVenueId, createVenueDoc } from '../lib/data';

export default function VenueSwitcher() {
  const [venues, setVenues] = useState([]);
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const ref = useRef(null);
  const currentId = getVenueId();

  useEffect(() => watchVenues(setVenues), []);

  useEffect(() => {
    if (!open) return;
    const onClickOut = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    window.addEventListener('mousedown', onClickOut);
    return () => window.removeEventListener('mousedown', onClickOut);
  }, [open]);

  // Don't render at all if only one venue exists
  if (venues.length <= 1 && !showCreate) {
    return (
      <button
        className="btn-ghost"
        onClick={() => setShowCreate(true)}
        title="Add a second venue"
        style={{ fontSize: 11 }}
      >
        + Add venue
      </button>
    );
  }

  const switchTo = (id) => {
    if (id === currentId) { setOpen(false); return; }
    setVenueId(id);
    // Clean reload — fresh subscriptions for the new venue
    setTimeout(() => window.location.reload(), 100);
  };

  const current = venues.find(v => v.id === currentId);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="venue-switcher-btn"
        onClick={() => setOpen(!open)}
      >
        <span style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 14 }}>
          {current?.name || currentId}
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-3)', marginLeft: 4 }}>▼</span>
      </button>

      {open && (
        <div className="venue-dropdown">
          <div className="venue-dropdown-label">Switch venue</div>
          {venues.map(v => (
            <button
              key={v.id}
              className={`venue-dropdown-item ${v.id === currentId ? 'active' : ''}`}
              onClick={() => switchTo(v.id)}
            >
              <span style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic' }}>{v.name}</span>
              {v.id === currentId && <span style={{ color: 'var(--green)' }}>✓</span>}
            </button>
          ))}
          <div className="venue-dropdown-divider" />
          <button
            className="venue-dropdown-item"
            onClick={() => { setOpen(false); setShowCreate(true); }}
          >
            <span style={{ color: 'var(--brand)' }}>+ New venue</span>
          </button>
        </div>
      )}

      {showCreate && (
        <NewVenueModal
          onClose={() => setShowCreate(false)}
          onCreated={(id) => { setShowCreate(false); setVenueId(id); window.location.reload(); }}
        />
      )}
    </div>
  );
}

function NewVenueModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [gstPct, setGstPct] = useState('10');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Auto-generate slug from name
  const handleName = (n) => {
    setName(n);
    if (!id || id === slugify(name)) setId(slugify(n));
  };

  const save = async () => {
    setErr('');
    if (!name.trim()) return setErr('Name required');
    if (!/^[a-z0-9-]{2,40}$/.test(id)) return setErr('ID must be 2–40 lowercase letters, digits, or dashes');

    setBusy(true);
    try {
      await createVenueDoc(id, {
        name: name.trim(),
        gstPct: parseFloat(gstPct) || 10,
        timezone: 'Australia/Perth',
        currency: 'AUD'
      });
      onCreated(id);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 100 }}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3>New venue</h3>
          <button className="icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>Venue name</label>
            <input
              autoFocus
              value={name}
              onChange={e => handleName(e.target.value)}
              placeholder="e.g. Sizzle N Sambar Northbridge"
            />
          </div>
          <div className="field">
            <label>Venue ID (URL-safe)</label>
            <input
              value={id}
              onChange={e => setId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              style={{ fontFamily: 'var(--font-mono)' }}
            />
            <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
              Cannot be changed later.
            </p>
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

          <div style={{ background: 'var(--bg-2)', padding: 12, borderRadius: 8, fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>
            The new venue starts with a default manager (PIN <b style={{ color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>1234</b>).
            You'll need to add tables, menu items and more users for it from the Manager Hub once you've switched in.
          </div>

          {err && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{err}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Creating…' : 'Create & switch'}
          </button>
        </div>
      </div>
    </div>
  );
}

function slugify(s) {
  return s.toLowerCase().trim().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}
