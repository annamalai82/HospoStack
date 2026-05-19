import { useEffect, useMemo, useState } from 'react';
import { watchCustomers, getVenueId } from '../lib/data';
import { doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import Modal from './Modal';

const SORT_OPTIONS = [
  { id: 'recent',  label: 'Most recent' },
  { id: 'orders',  label: 'Most orders' },
  { id: 'name',    label: 'Name A→Z' }
];

export default function CustomersPanel() {
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('recent');
  const [filter, setFilter] = useState('all'); // 'all' | 'email' | 'sms' | 'optedIn'
  const [viewing, setViewing] = useState(null);

  useEffect(() => watchCustomers(setCustomers), []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = customers;

    // Search
    if (q) {
      rows = rows.filter(c =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.phone || '').includes(q)
      );
    }

    // Filter
    if (filter === 'email') rows = rows.filter(c => c.email);
    if (filter === 'sms')   rows = rows.filter(c => c.phone);
    if (filter === 'optedIn') rows = rows.filter(c => c.marketingOptIn !== false && (c.email || c.phone));

    // Sort
    rows = [...rows];
    if (sort === 'recent') rows.sort((a, b) => (b.lastSeenAt?.toMillis?.() || 0) - (a.lastSeenAt?.toMillis?.() || 0));
    if (sort === 'orders') rows.sort((a, b) => (b.orderCount || 0) - (a.orderCount || 0));
    if (sort === 'name')   rows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    return rows;
  }, [customers, search, sort, filter]);

  const stats = useMemo(() => ({
    total: customers.length,
    withEmail: customers.filter(c => c.email).length,
    withSms: customers.filter(c => c.phone).length,
    optedIn: customers.filter(c => c.marketingOptIn !== false && (c.email || c.phone)).length,
    repeat: customers.filter(c => (c.orderCount || 0) > 1).length
  }), [customers]);

  const exportCSV = () => {
    const rows = [
      ['Name', 'Email', 'Phone', 'Orders', 'First seen', 'Last seen', 'Opted in'],
      ...filtered.map(c => [
        c.name || '',
        c.email || '',
        c.phone || '',
        c.orderCount || 0,
        c.firstSeenAt?.toDate?.()?.toISOString() || '',
        c.lastSeenAt?.toDate?.()?.toISOString() || '',
        c.marketingOptIn !== false ? 'yes' : 'no'
      ])
    ];
    const csv = rows.map(r => r.map(cell => {
      const s = String(cell);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `customers-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <h3>Customers</h3>
      <p className="subtitle">Built up automatically from receipt deliveries. Use for promotions and loyalty later.</p>

      <div className="stat-grid">
        <Stat label="Total customers" value={stats.total} />
        <Stat label="With email" value={stats.withEmail} />
        <Stat label="With mobile" value={stats.withSms} />
        <Stat label="Opted in" value={stats.optedIn} />
        <Stat label="Repeat customers" value={stats.repeat} />
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search name, email, phone…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 220 }}
        />
        <select value={sort} onChange={e => setSort(e.target.value)} style={{ padding: '10px 12px' }}>
          {SORT_OPTIONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <button
          className="btn"
          onClick={exportCSV}
          disabled={filtered.length === 0}
          style={filtered.length === 0 ? { opacity: 0.4 } : {}}
        >
          ⬇ Export CSV
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { id: 'all', label: `All (${customers.length})` },
          { id: 'email', label: `Has email (${stats.withEmail})` },
          { id: 'sms', label: `Has mobile (${stats.withSms})` },
          { id: 'optedIn', label: `Marketing-eligible (${stats.optedIn})` }
        ].map(f => (
          <button
            key={f.id}
            className={`cat-chip ${filter === f.id ? 'active' : ''}`}
            onClick={() => setFilter(f.id)}
          >{f.label}</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-3)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
          {customers.length === 0
            ? <p>No customers yet. They'll show up here once Till starts capturing emails and phone numbers at payment.</p>
            : <p>No customers match.</p>}
        </div>
      ) : (
        <div className="data-table">
          <div className="row head" style={{ gridTemplateColumns: '1.6fr 2fr 1.2fr 0.7fr 1fr 70px' }}>
            <div>Name</div>
            <div>Contact</div>
            <div>Last seen</div>
            <div>Orders</div>
            <div>Marketing</div>
            <div></div>
          </div>
          {filtered.map(c => (
            <div key={c.id} className="row" style={{ gridTemplateColumns: '1.6fr 2fr 1.2fr 0.7fr 1fr 70px' }}>
              <div>{c.name || <span style={{ color: 'var(--text-3)', fontStyle: 'italic' }}>—</span>}</div>
              <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
                {c.email && <div>📧 {c.email}</div>}
                {c.phone && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>📱 {c.phone}</div>}
              </div>
              <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
                {fmtRelative(c.lastSeenAt)}
              </div>
              <div>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  background: (c.orderCount || 0) > 1 ? 'var(--green-deep)' : 'var(--surface-3)',
                  color: (c.orderCount || 0) > 1 ? 'var(--green)' : 'var(--text-2)',
                  padding: '2px 8px', borderRadius: 999, fontSize: 12
                }}>×{c.orderCount || 0}</span>
              </div>
              <div>
                <OptInToggle customer={c} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="icon-btn" onClick={() => setViewing(c)} title="View details">›</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {viewing && <CustomerDetailModal customer={viewing} onClose={() => setViewing(null)} />}
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

function OptInToggle({ customer }) {
  const [checked, setChecked] = useState(customer.marketingOptIn !== false);
  const [saving, setSaving] = useState(false);

  const toggle = async () => {
    setSaving(true);
    const next = !checked;
    setChecked(next);
    try {
      await updateDoc(doc(db, 'venues', getVenueId(), 'customers', customer.id), {
        marketingOptIn: next
      });
    } catch (e) {
      setChecked(!next);
      alert('Failed to update: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <label className="switch" style={{ opacity: saving ? 0.6 : 1 }}>
      <input type="checkbox" checked={checked} onChange={toggle} disabled={saving} />
      <span className="slider" />
    </label>
  );
}

function CustomerDetailModal({ customer, onClose }) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Permanently delete ${customer.name || customer.email || customer.phone}?\n\nTheir past orders stay on record but they'll be removed from the marketing list.`)) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'venues', getVenueId(), 'customers', customer.id));
      onClose();
    } catch (e) {
      alert('Delete failed: ' + e.message);
      setDeleting(false);
    }
  };

  return (
    <Modal
      title={customer.name || 'Customer'}
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Close</button>
          <button className="btn btn-danger" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete from list'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {customer.email && (
          <DetailRow label="Email">
            <a href={`mailto:${customer.email}`} style={{ color: 'var(--blue)', textDecoration: 'none' }}>
              {customer.email}
            </a>
          </DetailRow>
        )}
        {customer.phone && (
          <DetailRow label="Mobile">
            <a href={`tel:${customer.phone}`} style={{ color: 'var(--blue)', textDecoration: 'none', fontFamily: 'var(--font-mono)' }}>
              {customer.phone}
            </a>
          </DetailRow>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 4 }}>
          <div className="stat-card" style={{ padding: 14 }}>
            <div className="label">Total orders</div>
            <div className="value" style={{ fontSize: 22 }}>×{customer.orderCount || 0}</div>
          </div>
          <div className="stat-card" style={{ padding: 14 }}>
            <div className="label">Marketing</div>
            <div className="value" style={{
              fontSize: 16,
              color: customer.marketingOptIn !== false ? 'var(--green)' : 'var(--red)'
            }}>
              {customer.marketingOptIn !== false ? 'Opted in' : 'Opted out'}
            </div>
          </div>
        </div>

        <DetailRow label="First seen">{fmtFull(customer.firstSeenAt)}</DetailRow>
        <DetailRow label="Last seen">{fmtFull(customer.lastSeenAt)}</DetailRow>

        <div style={{
          marginTop: 8, padding: 12,
          background: 'var(--bg-2)', borderRadius: 8,
          fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6
        }}>
          Customer ID: <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>{customer.id}</code>
          <br />Add this to future marketing exports as the unique key.
        </div>
      </div>
    </Modal>
  );
}

function DetailRow({ label, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 12, fontSize: 14 }}>
      <div style={{ color: 'var(--text-3)', fontSize: 12, paddingTop: 2 }}>{label}</div>
      <div>{children}</div>
    </div>
  );
}

function fmtRelative(ts) {
  if (!ts?.toMillis) return '—';
  const ms = Date.now() - ts.toMillis();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}

function fmtFull(ts) {
  if (!ts?.toMillis) return '—';
  return new Date(ts.toMillis()).toLocaleString('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}
