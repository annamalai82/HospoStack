import { useEffect, useState } from 'react';
import { findCustomerByContact, watchTables } from '../lib/data';
import Modal from './Modal';

const OCCASIONS = ['', 'Birthday', 'Anniversary', 'Date night', 'Business', 'Family', 'Other'];

export default function BookingModal({ booking, defaultDate, defaultSettings, onClose, onSave }) {
  const isNew = booking.__new;

  const [name, setName] = useState(booking.name || '');
  const [phone, setPhone] = useState(booking.phone || '');
  const [email, setEmail] = useState(booking.email || '');
  const [date, setDate] = useState(booking.date || defaultDate || todayISO());
  const [time, setTime] = useState(booking.time || '18:00');
  const [party, setParty] = useState(booking.party || 2);
  const [durationMins, setDurationMins] = useState(booking.durationMins || defaultSettings?.defaultDurationMins || 90);
  const [tableId, setTableId] = useState(booking.tableId || '');
  const [occasion, setOccasion] = useState(booking.occasion || '');
  const [notes, setNotes] = useState(booking.notes || '');
  const [source, setSource] = useState(booking.source || 'phone');
  const [tables, setTables] = useState([]);
  const [lookedUp, setLookedUp] = useState(null);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => watchTables(setTables), []);

  // Auto-lookup customer when phone/email blurs
  const lookupCustomer = async () => {
    if (!phone && !email) return;
    const customer = await findCustomerByContact({ phone, email });
    if (customer) {
      setLookedUp(customer);
      if (!name && customer.name) setName(customer.name);
      if (!email && customer.email) setEmail(customer.email);
      if (!phone && customer.phone) setPhone(customer.phone);
    }
  };

  const save = async () => {
    setErr('');
    if (!name.trim()) return setErr('Customer name is required');
    if (!phone && !email) return setErr('At least one of phone or email is needed');
    if (!date || !time) return setErr('Pick a date and time');
    const p = parseInt(party, 10);
    if (!p || p < 1) return setErr('Party size must be at least 1');
    const d = parseInt(durationMins, 10);
    if (!d || d < 15) return setErr('Duration must be at least 15 minutes');

    setSaving(true);
    try {
      await onSave({
        name: name.trim(), phone: phone.trim(), email: email.trim().toLowerCase(),
        date, time, party: p, durationMins: d,
        tableId: tableId || null,
        occasion, notes: notes.trim(), source,
        customerKey: lookedUp?.id || null
      });
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={isNew ? 'New booking' : `Edit booking · ${booking.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : isNew ? 'Create booking' : 'Save'}
          </button>
        </>
      }
    >
      {lookedUp && (
        <div style={{
          background: 'var(--green-deep)',
          color: 'var(--green)',
          border: '1px solid rgba(74,222,128,0.25)',
          padding: '10px 14px',
          borderRadius: 8,
          fontSize: 13,
          marginBottom: 16
        }}>
          ✓ Returning customer — {lookedUp.orderCount} previous order{lookedUp.orderCount === 1 ? '' : 's'}.
          Details auto-filled from records.
        </div>
      )}

      <div className="field">
        <label>Customer name</label>
        <input value={name} onChange={e => setName(e.target.value)} autoFocus />
      </div>

      <div className="field-row">
        <div className="field">
          <label>Mobile</label>
          <input
            value={phone}
            onChange={e => setPhone(e.target.value)}
            onBlur={lookupCustomer}
            placeholder="04xx xxx xxx"
            type="tel"
            style={{ fontFamily: 'var(--font-mono)' }}
          />
        </div>
        <div className="field">
          <label>Email</label>
          <input
            value={email}
            onChange={e => setEmail(e.target.value)}
            onBlur={lookupCustomer}
            placeholder="optional"
            type="email"
          />
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label>Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} min={todayISO()} />
        </div>
        <div className="field">
          <label>Time</label>
          <input type="time" value={time} onChange={e => setTime(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} />
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label>Party size</label>
          <input
            value={party}
            onChange={e => setParty(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            style={{ fontFamily: 'var(--font-mono)' }}
          />
        </div>
        <div className="field">
          <label>Duration (mins)</label>
          <input
            value={durationMins}
            onChange={e => setDurationMins(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            style={{ fontFamily: 'var(--font-mono)' }}
          />
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label>Table (optional)</label>
          <select value={tableId} onChange={e => setTableId(e.target.value)}>
            <option value="">Assign at arrival</option>
            {tables
              .filter(t => t.seats >= party)
              .sort((a, b) => a.number - b.number)
              .map(t => (
                <option key={t.id} value={t.id}>T{t.number} · {t.zone} · {t.seats} seats</option>
              ))}
          </select>
        </div>
        <div className="field">
          <label>Occasion</label>
          <select value={occasion} onChange={e => setOccasion(e.target.value)}>
            {OCCASIONS.map(o => <option key={o} value={o}>{o || '—'}</option>)}
          </select>
        </div>
      </div>

      <div className="field">
        <label>Notes (allergies, requests)</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          placeholder="e.g. window table, allergic to nuts, wheelchair access"
          maxLength={300}
        />
      </div>

      <div className="field">
        <label>Source</label>
        <select value={source} onChange={e => setSource(e.target.value)}>
          <option value="phone">Phone</option>
          <option value="walk-up">Walk-up</option>
          <option value="online">Online</option>
          <option value="other">Other</option>
        </select>
      </div>

      {err && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{err}</div>}
    </Modal>
  );
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
