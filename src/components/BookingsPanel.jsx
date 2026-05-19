import { useEffect, useMemo, useState } from 'react';
import {
  watchBookingsForDate, watchUpcomingBookings, watchTables,
  createBooking, updateBooking, deleteBooking, getVenue, updateBookingSettings
} from '../lib/data';
import BookingModal from './BookingModal';
import Modal from './Modal';

const STATUS_META = {
  confirmed: { label: 'Confirmed', color: 'var(--blue)',  bg: 'rgba(96,165,250,0.12)' },
  pending:   { label: 'Pending',   color: 'var(--amber)', bg: 'rgba(251,191,36,0.12)' },
  arrived:   { label: 'Arrived',   color: 'var(--green)', bg: 'rgba(74,222,128,0.12)' },
  'no-show': { label: 'No-show',   color: 'var(--red)',   bg: 'rgba(248,113,113,0.12)' },
  cancelled: { label: 'Cancelled', color: 'var(--text-3)',bg: 'var(--surface-3)' }
};

export default function BookingsPanel() {
  const [date, setDate] = useState(todayISO());
  const [bookings, setBookings] = useState([]);
  const [tables, setTables] = useState([]);
  const [editing, setEditing] = useState(null);
  const [view, setView] = useState('list'); // 'list' | 'grid'
  const [settings, setSettings] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => watchBookingsForDate(date, setBookings), [date]);
  useEffect(() => watchTables(setTables), []);
  useEffect(() => { getVenue().then(v => setSettings(v?.booking || defaultSettings())); }, []);

  const stats = useMemo(() => ({
    total: bookings.length,
    confirmed: bookings.filter(b => b.status === 'confirmed' || b.status === 'pending').length,
    arrived: bookings.filter(b => b.status === 'arrived').length,
    covers: bookings.reduce((n, b) => n + (b.party || 0), 0)
  }), [bookings]);

  const shiftDate = (days) => {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + days);
    setDate(d.toISOString().slice(0, 10));
  };

  const tableName = (id) => {
    const t = tables.find(x => x.id === id);
    return t ? `T${t.number}` : '—';
  };

  return (
    <>
      <h3>Bookings</h3>
      <p className="subtitle">Manage reservations. Bookings link to the customer database automatically — repeat guests get recognised on phone or email lookup.</p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button className="icon-btn" onClick={() => shiftDate(-1)} title="Previous day">‹</button>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            style={{ fontFamily: 'var(--font-mono)' }}
          />
          <button className="icon-btn" onClick={() => shiftDate(1)} title="Next day">›</button>
          <button className="btn-ghost" onClick={() => setDate(todayISO())} style={{ marginLeft: 4 }}>
            Today
          </button>
        </div>

        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className={`cat-chip ${view === 'list' ? 'active' : ''}`}
            onClick={() => setView('list')}
          >List</button>
          <button
            className={`cat-chip ${view === 'grid' ? 'active' : ''}`}
            onClick={() => setView('grid')}
          >Grid</button>
        </div>

        <button className="btn-ghost" onClick={() => setShowSettings(true)} title="Booking settings">⚙</button>
        <button
          className="btn btn-primary"
          onClick={() => setEditing({ __new: true, date })}
        >+ New Booking</button>
      </div>

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <Stat label="Bookings" value={stats.total} />
        <Stat label="Covers" value={stats.covers} />
        <Stat label="Arrived" value={stats.arrived} />
        <Stat label="To arrive" value={stats.confirmed} />
      </div>

      {bookings.length === 0 ? (
        <div style={{
          padding: 80, textAlign: 'center', color: 'var(--text-3)',
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10
        }}>
          <p style={{ fontSize: 15, fontFamily: 'var(--font-serif)', fontStyle: 'italic' }}>
            No bookings for {fmtDateNice(date)}.
          </p>
          <p style={{ fontSize: 12, marginTop: 8 }}>
            Quiet day — or tap "New Booking" to add one.
          </p>
        </div>
      ) : view === 'list' ? (
        <BookingsList
          bookings={bookings}
          tableName={tableName}
          onEdit={(b) => setEditing(b)}
          onStatusChange={(b, status) => updateBooking(b.id, { status })}
        />
      ) : (
        <BookingsGrid bookings={bookings} tables={tables} onEdit={(b) => setEditing(b)} />
      )}

      {editing && (
        <BookingModal
          booking={editing}
          defaultDate={date}
          defaultSettings={settings}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            if (editing.__new) await createBooking(data);
            else                await updateBooking(editing.id, data);
            setEditing(null);
          }}
        />
      )}

      {showSettings && (
        <BookingSettingsModal
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSave={async (s) => {
            await updateBookingSettings(s);
            setSettings(s);
            setShowSettings(false);
          }}
        />
      )}
    </>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat-card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}

// ── List view ────────────────────────────────────────────────────────────
function BookingsList({ bookings, tableName, onEdit, onStatusChange }) {
  return (
    <div className="data-table">
      <div className="row head" style={{ gridTemplateColumns: '80px 80px 1.6fr 1.4fr 60px 1fr 100px 90px' }}>
        <div>Time</div>
        <div>Party</div>
        <div>Customer</div>
        <div>Contact</div>
        <div>Table</div>
        <div>Notes</div>
        <div>Status</div>
        <div></div>
      </div>
      {bookings.map(b => {
        const meta = STATUS_META[b.status] || STATUS_META.confirmed;
        return (
          <div key={b.id} className="row" style={{ gridTemplateColumns: '80px 80px 1.6fr 1.4fr 60px 1fr 100px 90px' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--brand)' }}>{b.time}</div>
            <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>×{b.party}</div>
            <div>
              {b.name}
              {b.occasion && (
                <div style={{ fontSize: 11, color: 'var(--violet)', marginTop: 2 }}>🎉 {b.occasion}</div>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
              {b.phone && <div style={{ fontFamily: 'var(--font-mono)' }}>{b.phone}</div>}
              {b.email && <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{b.email}</div>}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: b.tableId ? 'var(--text)' : 'var(--text-3)' }}>
              {tableName(b.tableId)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
              {b.notes ? b.notes.slice(0, 50) + (b.notes.length > 50 ? '…' : '') : '—'}
            </div>
            <div>
              <select
                value={b.status}
                onChange={e => onStatusChange(b, e.target.value)}
                style={{
                  padding: '4px 8px', fontSize: 12,
                  background: meta.bg, color: meta.color,
                  border: `1px solid ${meta.color}`,
                  fontWeight: 500
                }}
              >
                {Object.entries(STATUS_META).map(([k, v]) => (
                  <option key={k} value={k} style={{ background: 'var(--surface)' }}>{v.label}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
              <button className="icon-btn" onClick={() => onEdit(b)}>✎</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Grid view (time × table) ─────────────────────────────────────────────
function BookingsGrid({ bookings, tables, onEdit }) {
  // Hours from 12:00 to 23:00 in 30-min slots
  const slots = [];
  for (let h = 12; h < 24; h++) {
    slots.push(`${pad(h)}:00`);
    slots.push(`${pad(h)}:30`);
  }
  const sortedTables = [...tables].sort((a, b) => a.number - b.number);

  // For each table, find bookings
  const bookingsByTable = {};
  bookings.forEach(b => {
    if (!b.tableId) return;
    if (!bookingsByTable[b.tableId]) bookingsByTable[b.tableId] = [];
    bookingsByTable[b.tableId].push(b);
  });

  const unassigned = bookings.filter(b => !b.tableId);

  return (
    <div>
      {unassigned.length > 0 && (
        <div style={{
          marginBottom: 14, padding: 12,
          background: 'var(--amber-deep)', color: 'var(--amber)',
          border: '1px solid rgba(251,191,36,0.25)', borderRadius: 8,
          fontSize: 13
        }}>
          ⚠ {unassigned.length} booking{unassigned.length === 1 ? '' : 's'} not yet assigned to a table —{' '}
          {unassigned.slice(0, 3).map(b => `${b.time} ${b.name}`).join(', ')}
          {unassigned.length > 3 ? `, +${unassigned.length - 3} more` : ''}
        </div>
      )}

      <div className="booking-grid">
        <div className="booking-grid-times">
          <div className="booking-cell head" />
          {slots.map(s => (
            <div key={s} className="booking-cell head time">{s}</div>
          ))}
        </div>

        {sortedTables.map(t => {
          const tableBookings = bookingsByTable[t.id] || [];
          return (
            <div key={t.id} className="booking-grid-row">
              <div className="booking-cell head table-label">
                <span style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 18, color: 'var(--brand)' }}>{t.number}</span>
                <span style={{ fontSize: 10, color: 'var(--text-3)', marginLeft: 4 }}>{t.seats}p</span>
              </div>
              {slots.map(s => {
                const booking = tableBookings.find(b => {
                  // booking covers this slot if start ≤ slot < start+duration
                  const slotMin = toMinutes(s);
                  const startMin = toMinutes(b.time);
                  return slotMin >= startMin && slotMin < startMin + (b.durationMins || 90);
                });

                if (!booking) return <div key={s} className="booking-cell empty" />;
                if (booking.time !== s) {
                  // continuation cell — leave blank (the start cell renders the span)
                  return <div key={s} className="booking-cell occupied" />;
                }
                const span = Math.ceil((booking.durationMins || 90) / 30);
                const meta = STATUS_META[booking.status] || STATUS_META.confirmed;
                return (
                  <button
                    key={s}
                    className="booking-cell booking-block"
                    style={{
                      gridColumn: `span ${span}`,
                      background: meta.bg,
                      borderColor: meta.color,
                      color: meta.color
                    }}
                    onClick={() => onEdit(booking)}
                  >
                    <div style={{ fontWeight: 500, fontSize: 12 }}>{booking.name}</div>
                    <div style={{ fontSize: 10, opacity: 0.85, fontFamily: 'var(--font-mono)' }}>
                      ×{booking.party} · {booking.time}
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Settings modal ───────────────────────────────────────────────────────
function BookingSettingsModal({ settings, onClose, onSave }) {
  const [s, setS] = useState(settings || defaultSettings());

  return (
    <Modal
      title="Booking settings"
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(s)}>Save</button>
        </>
      }
    >
      <div className="field">
        <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Bookings active</span>
          <label className="switch">
            <input
              type="checkbox"
              checked={s.active !== false}
              onChange={e => setS({ ...s, active: e.target.checked })}
            />
            <span className="slider" />
          </label>
        </label>
        <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
          When off, no new bookings can be taken anywhere.
        </p>
      </div>

      <div className="field-row">
        <div className="field">
          <label>Default duration (mins)</label>
          <input
            value={s.defaultDurationMins || 90}
            onChange={e => setS({ ...s, defaultDurationMins: +e.target.value.replace(/\D/g, '') })}
            inputMode="numeric"
            style={{ fontFamily: 'var(--font-mono)' }}
          />
        </div>
        <div className="field">
          <label>Reservation wait (mins)</label>
          <input
            value={s.waitMins || 15}
            onChange={e => setS({ ...s, waitMins: +e.target.value.replace(/\D/g, '') })}
            inputMode="numeric"
            style={{ fontFamily: 'var(--font-mono)' }}
          />
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label>Max party (single booking)</label>
          <input
            value={s.maxParty || 12}
            onChange={e => setS({ ...s, maxParty: +e.target.value.replace(/\D/g, '') })}
            inputMode="numeric"
            style={{ fontFamily: 'var(--font-mono)' }}
          />
        </div>
        <div className="field">
          <label>Lead time (hours)</label>
          <input
            value={s.leadHours || 1}
            onChange={e => setS({ ...s, leadHours: +e.target.value.replace(/\D/g, '') })}
            inputMode="numeric"
            style={{ fontFamily: 'var(--font-mono)' }}
          />
        </div>
      </div>

      <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6, lineHeight: 1.6 }}>
        Lead time is the minimum hours between "now" and a booking start time.
        Reservation wait is how long you'll hold a table past the booking time before marking no-show.
      </p>
    </Modal>
  );
}

function defaultSettings() {
  return {
    active: true,
    defaultDurationMins: 90,
    waitMins: 15,
    maxParty: 12,
    leadHours: 1
  };
}

function todayISO() { return new Date().toISOString().slice(0, 10); }
function pad(n) { return String(n).padStart(2, '0'); }
function toMinutes(hhmm) {
  const [h, m] = (hhmm || '00:00').split(':').map(Number);
  return h * 60 + m;
}
function fmtDateNice(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
}
