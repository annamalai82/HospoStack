import { useEffect, useState } from 'react';
import {
  watchTables, createTable, updateTable, deleteTable
} from '../lib/data';
import Modal from './Modal';

export default function TablesPanel() {
  const [tables, setTables] = useState([]);
  const [editing, setEditing] = useState(null);

  useEffect(() => watchTables(setTables), []);

  const nextNumber = tables.length === 0 ? 1 : Math.max(...tables.map(t => t.number)) + 1;

  return (
    <>
      <h3>Tables</h3>
      <p className="subtitle">Configure the floor plan. Tables are referenced by number across the system.</p>

      <div className="section">
        <div className="section-head">
          <h4>{tables.length} tables</h4>
          <button
            className="btn btn-primary"
            onClick={() => setEditing({ __new: true, number: nextNumber, seats: 2, zone: 'Dining' })}
          >+ New Table</button>
        </div>

        <div className="data-table">
          <div className="row head" style={{ gridTemplateColumns: '80px 1fr 1fr 1fr 90px' }}>
            <div>Number</div>
            <div>Zone</div>
            <div>Seats</div>
            <div>Current Status</div>
            <div></div>
          </div>
          {tables.sort((a, b) => a.number - b.number).map(t => (
            <div key={t.id} className="row" style={{ gridTemplateColumns: '80px 1fr 1fr 1fr 90px' }}>
              <div style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 22, color: 'var(--brand)' }}>
                {t.number}
              </div>
              <div>{t.zone}</div>
              <div style={{ color: 'var(--text-3)', fontSize: 13 }}>{t.seats} seats</div>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)' }}>
                {t.status}
              </div>
              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                <button className="icon-btn" onClick={() => setEditing(t)}>✎</button>
                <button className="icon-btn danger" onClick={() => {
                  if (t.status !== 'free') { alert('Free the table before deleting it.'); return; }
                  if (confirm(`Delete table ${t.number}?`)) deleteTable(t.id);
                }}>×</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {editing && (
        <TableEditModal
          table={editing}
          existingNumbers={tables.filter(t => t.id !== editing.id).map(t => t.number)}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            if (editing.__new) await createTable(data);
            else await updateTable(editing.id, data);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function TableEditModal({ table, existingNumbers, onClose, onSave }) {
  const isNew = table.__new;
  const [number, setNumber] = useState(table.number || 1);
  const [seats, setSeats] = useState(table.seats || 2);
  const [zone, setZone] = useState(table.zone || 'Dining');
  const [err, setErr] = useState('');

  const save = async () => {
    setErr('');
    const n = parseInt(number, 10);
    if (isNaN(n) || n <= 0) return setErr('Table number must be a positive integer');
    if (isNew && existingNumbers.includes(n)) return setErr(`Table ${n} already exists`);
    const s = parseInt(seats, 10);
    if (isNaN(s) || s <= 0) return setErr('Seats must be a positive number');
    await onSave({ number: n, seats: s, zone: zone.trim() || 'Main' });
  };

  return (
    <Modal
      title={isNew ? 'New table' : `Edit table ${table.number}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save</button>
        </>
      }
    >
      <div className="field-row">
        <div className="field">
          <label>Table number</label>
          <input
            value={number}
            onChange={e => setNumber(e.target.value.replace(/\D/g, ''))}
            disabled={!isNew}
            style={{ fontFamily: 'var(--font-mono)', opacity: isNew ? 1 : 0.6 }}
          />
        </div>
        <div className="field">
          <label>Seats</label>
          <input
            value={seats}
            onChange={e => setSeats(e.target.value.replace(/\D/g, ''))}
            style={{ fontFamily: 'var(--font-mono)' }}
          />
        </div>
      </div>
      <div className="field">
        <label>Zone</label>
        <input value={zone} onChange={e => setZone(e.target.value)} placeholder="e.g. Dining, Patio, Bar" />
      </div>
      {err && <div style={{ color: 'var(--red)', fontSize: 13 }}>{err}</div>}
    </Modal>
  );
}
