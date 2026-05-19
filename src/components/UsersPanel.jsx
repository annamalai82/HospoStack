import { useEffect, useState } from 'react';
import {
  watchUsers, createUser, updateUser, deleteUser, pinIsUnique
} from '../lib/data';
import Modal from './Modal';

const ROLES = ['manager', 'waiter', 'kitchen', 'cashier'];

export default function UsersPanel() {
  const [users, setUsers] = useState([]);
  const [editing, setEditing] = useState(null); // user obj or { __new: true }

  useEffect(() => watchUsers(setUsers), []);

  return (
    <>
      <h3>Users & PINs</h3>
      <p className="subtitle">Manage who can sign in to each device. PINs are 4-digit codes.</p>

      <div className="section">
        <div className="section-head">
          <h4>{users.length} user{users.length === 1 ? '' : 's'}</h4>
          <button className="btn btn-primary" onClick={() => setEditing({ __new: true, name: '', role: 'waiter', pin: '' })}>
            + New User
          </button>
        </div>

        <div className="data-table">
          <div className="row head" style={{ gridTemplateColumns: '2fr 1fr 90px 80px 110px' }}>
            <div>Name</div>
            <div>Role</div>
            <div>PIN</div>
            <div>Status</div>
            <div></div>
          </div>
          {users.map(u => (
            <div key={u.id} className="row" style={{ gridTemplateColumns: '2fr 1fr 90px 80px 110px' }}>
              <div>{u.name}</div>
              <div><span className={`pill ${u.role}`}>{u.role}</span></div>
              <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>••••</div>
              <div><span className={`pill ${u.active ? 'active' : 'inactive'}`}>{u.active ? 'active' : 'inactive'}</span></div>
              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                <button className="icon-btn" onClick={() => setEditing(u)} title="Edit">✎</button>
                <button className="icon-btn danger" onClick={() => {
                  if (confirm(`Delete ${u.name}? They won't be able to sign in.`)) deleteUser(u.id);
                }} title="Delete">×</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {editing && (
        <UserEditModal
          user={editing}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            const isNew = editing.__new;
            const id = isNew ? null : editing.id;

            const unique = await pinIsUnique(data.pin, id);
            if (!unique) { alert('That PIN is already in use.'); return false; }

            if (isNew) await createUser(data);
            else       await updateUser(id, data);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function UserEditModal({ user, onClose, onSave }) {
  const isNew = user.__new;
  const [name, setName] = useState(user.name || '');
  const [role, setRole] = useState(user.role || 'waiter');
  const [pin, setPin] = useState(user.pin || '');
  const [active, setActive] = useState(user.active !== false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const handleSave = async () => {
    setErr('');
    if (!name.trim()) return setErr('Name is required');
    if (!/^\d{4}$/.test(pin)) return setErr('PIN must be exactly 4 digits');
    setSaving(true);
    try { await onSave({ name: name.trim(), role, pin, active }); }
    catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <Modal
      title={isNew ? 'New user' : `Edit ${user.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="field">
        <label>Name</label>
        <input value={name} onChange={e => setName(e.target.value)} autoFocus />
      </div>

      <div className="field-row">
        <div className="field">
          <label>Role</label>
          <select value={role} onChange={e => setRole(e.target.value)}>
            {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
          </select>
        </div>
        <div className="field">
          <label>4-digit PIN</label>
          <input
            value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            inputMode="numeric"
            placeholder="0000"
            style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.3em', textAlign: 'center' }}
          />
        </div>
      </div>

      <div className="field">
        <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Active</span>
          <label className="switch">
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
            <span className="slider" />
          </label>
        </label>
        <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
          Inactive users can't sign in but their history is preserved.
        </p>
      </div>

      {err && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{err}</div>}

      <div style={{
        marginTop: 16, padding: 12,
        background: 'var(--bg-2)', borderRadius: 8,
        fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6
      }}>
        <strong style={{ color: 'var(--text-2)' }}>Role determines which device this user can sign in to:</strong>
        <br />
        <span style={{ color: 'var(--brand)' }}>Manager</span> — any mode ·{' '}
        <span style={{ color: 'var(--blue)' }}>Waiter</span> — Floor only ·{' '}
        <span style={{ color: 'var(--amber)' }}>Kitchen</span> — KDS only ·{' '}
        <span style={{ color: 'var(--violet)' }}>Cashier</span> — Till only
      </div>
    </Modal>
  );
}
