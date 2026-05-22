import { useState, useEffect, useMemo } from 'react';
import { db } from '../lib/firebase';
import { collection, onSnapshot, query, where, getDocs, writeBatch, doc, addDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useDevice } from '../context/DeviceContext';
import { watchVenues, setVenueId, updateVenueDetails, deleteVenue } from '../lib/data';

export default function GroupAdminPanel({ onToast }) {
  const { device, switchVenue } = useDevice();
  const [venues, setVenues] = useState([]);
  const [venueStats, setVenueStats] = useState({});
  const [tick, setTick] = useState(0);

  // Venue management state
  const [editingVenue, setEditingVenue]   = useState(null); // venue obj | 'new'
  const [deletingVenue, setDeletingVenue] = useState(null); // venue obj
  const [venueForm, setVenueForm]         = useState({ name: '', abn: '', timezone: 'Australia/Perth', phone: '', address: '' });
  const [venueFormBusy, setVenueFormBusy] = useState(false);
  const [venueFormErr, setVenueFormErr]   = useState('');
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleting, setDeleting]           = useState(false);

  useEffect(() => watchVenues(setVenues), []);
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  // Subscribe to each venue's orders independently
  useEffect(() => {
    if (venues.length === 0) return;
    const unsubs = venues.map(v => {
      // Today's orders for sales
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const ordersRef = collection(db, 'venues', v.id, 'orders');
      return onSnapshot(ordersRef, snap => {
        const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const today = orders.filter(o => {
          const ms = o.paidAt?.toMillis?.() || o.openedAt?.toMillis?.() || 0;
          return ms >= start.getTime();
        });
        const paid = today.filter(o => o.status === 'paid');
        const open = orders.filter(o => ['open', 'sent', 'preparing', 'ready', 'served'].includes(o.status));
        const kitchen = orders.filter(o => ['sent', 'preparing', 'ready'].includes(o.status));
        const overdueCount = kitchen.filter(o => {
          const ms = o.sentAt?.toMillis?.() || 0;
          return ms > 0 && (Date.now() - ms) / 60000 >= 20;
        }).length;
        setVenueStats(s => ({
          ...s,
          [v.id]: {
            todaySales: paid.reduce((sum, o) => sum + (o.total || 0), 0),
            todayOrders: paid.length,
            openOrders: open.length,
            kitchenTickets: kitchen.length,
            overdue: overdueCount
          }
        }));
      });
    });
    return () => unsubs.forEach(u => u());
  }, [venues]);

  const totals = useMemo(() => {
    return Object.values(venueStats).reduce((acc, s) => ({
      sales: acc.sales + (s.todaySales || 0),
      orders: acc.orders + (s.todayOrders || 0),
      openTables: acc.openTables + (s.openOrders || 0),
      kitchenTickets: acc.kitchenTickets + (s.kitchenTickets || 0),
      overdue: acc.overdue + (s.overdue || 0)
    }), { sales: 0, orders: 0, openTables: 0, kitchenTickets: 0, overdue: 0 });
  }, [venueStats]);

  const openEdit = (venue) => {
    setVenueForm({ name: venue.name || '', abn: venue.abn || '', timezone: venue.timezone || 'Australia/Perth', phone: venue.phone || '', address: venue.address || '' });
    setVenueFormErr('');
    setEditingVenue(venue);
  };
  const openNew = () => {
    setVenueForm({ name: '', abn: '', timezone: 'Australia/Perth', phone: '', address: '' });
    setVenueFormErr('');
    setEditingVenue('new');
  };
  const saveVenue = async () => {
    if (!venueForm.name.trim()) { setVenueFormErr('Venue name is required'); return; }
    setVenueFormErr('');
    setVenueFormBusy(true);
    try {
      if (editingVenue === 'new') {
        const id = venueForm.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        await setDoc(doc(db, 'venues', id), {
          name: venueForm.name.trim(), abn: venueForm.abn.trim(),
          timezone: venueForm.timezone, phone: venueForm.phone.trim(),
          address: venueForm.address.trim(), currency: 'AUD',
          gstPct: 10, createdAt: serverTimestamp()
        });
        await setDoc(doc(db, 'venues', id, 'users', 'manager'), {
          name: 'Default Manager', role: 'manager', pin: '1234', active: true
        });
        onToast?.(`✓ "${venueForm.name.trim()}" created — default PIN 1234`);
      } else {
        await updateVenueDetails(editingVenue.id, {
          name: venueForm.name.trim(), abn: venueForm.abn.trim(),
          timezone: venueForm.timezone, phone: venueForm.phone.trim(),
          address: venueForm.address.trim()
        });
        onToast?.(`✓ "${venueForm.name.trim()}" updated`);
      }
      setEditingVenue(null);
    } catch (e) { setVenueFormErr('Save failed: ' + e.message); }
    finally { setVenueFormBusy(false); }
  };
  const handleDeleteVenue = async () => {
    if (!deletingVenue) return;
    if (deleteConfirmName.trim().toLowerCase() !== deletingVenue.name.trim().toLowerCase()) return;
    setDeleting(true);
    try {
      await deleteVenue(deletingVenue.id);
      onToast?.(`"${deletingVenue.name}" and all its data deleted`);
      setDeletingVenue(null);
      setDeleteConfirmName('');
    } catch (e) { onToast?.('Delete failed: ' + e.message); }
    finally { setDeleting(false); }
  };

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 32 }}>
        Group <span style={{ color: 'var(--brand)' }}>Dashboard</span>
      </h1>
      <p className="subtitle" style={{ marginBottom: 28 }}>
        Live view across all {venues.length} venues. Today's sales, open tables, kitchen queue.
        Tap a venue card to switch this device to it (manager-only).
      </p>

      {/* Group totals */}
      <div className="group-totals">
        <div className="group-total-card">
          <div className="label">Today's sales</div>
          <div className="value" style={{ color: 'var(--brand)' }}>
            ${totals.sales.toFixed(2)}
          </div>
          <div className="sub">{totals.orders} orders</div>
        </div>
        <div className="group-total-card">
          <div className="label">Active tables</div>
          <div className="value">{totals.openTables}</div>
          <div className="sub">across all venues</div>
        </div>
        <div className="group-total-card">
          <div className="label">In kitchen</div>
          <div className="value" style={{ color: 'var(--amber)' }}>{totals.kitchenTickets}</div>
          <div className="sub">tickets cooking</div>
        </div>
        <div className="group-total-card">
          <div className="label">Overdue</div>
          <div className="value" style={{ color: totals.overdue > 0 ? 'var(--red)' : 'var(--text-3)' }}>
            {totals.overdue}
          </div>
          <div className="sub">over 20 min</div>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <h4>Venues</h4>
          <button className="btn btn-sm btn-primary" onClick={openNew}>+ New venue</button>
        </div>
        <div className="venue-card-grid">
          {venues.map(v => {
            const stats = venueStats[v.id] || {};
            const isCurrent = v.id === device.venueId;
            return (
              <div key={v.id} className={`venue-overview-card ${isCurrent ? 'current' : ''}`}>
                <div className="venue-overview-head">
                  <div>
                    <div className="venue-overview-name">{v.name}</div>
                    {isCurrent && <span className="venue-current-badge">This device</span>}
                    {v.address && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{v.address}</div>}
                  </div>
                  {stats.overdue > 0 && (
                    <div className="venue-overdue-badge">🔥 {stats.overdue}</div>
                  )}
                </div>
                <div className="venue-overview-stats">
                  <div><div className="ll">Today</div><div className="vv" style={{ color: 'var(--brand)' }}>${(stats.todaySales || 0).toFixed(2)}</div></div>
                  <div><div className="ll">Orders</div><div className="vv">{stats.todayOrders || 0}</div></div>
                  <div><div className="ll">Open</div><div className="vv">{stats.openOrders || 0}</div></div>
                  <div><div className="ll">Kitchen</div><div className="vv" style={{ color: stats.kitchenTickets > 0 ? 'var(--amber)' : 'var(--text-3)' }}>{stats.kitchenTickets || 0}</div></div>
                </div>
                <div className="venue-overview-foot" style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="btn btn-sm"
                    disabled={isCurrent}
                    style={{ opacity: isCurrent ? 0.4 : 1, flex: 1 }}
                    onClick={() => { switchVenue(v.id, v.name); onToast?.(`Switched to ${v.name}`, 'info'); setTimeout(() => window.location.reload(), 500); }}
                  >
                    {isCurrent ? '✓ Current' : 'Switch'}
                  </button>
                  <button className="btn btn-sm" onClick={() => openEdit(v)} title="Edit venue">✎ Edit</button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => { setDeletingVenue(v); setDeleteConfirmName(''); }}
                    title="Delete venue"
                    disabled={isCurrent}
                  >🗑</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Menu sync ── */}
      <div className="section">
        <div className="section-head"><h4>Menu sync</h4></div>
        <MenuSync venues={venues} onToast={onToast} currentId={device.venueId} />
      </div>

      {/* ── Edit / Create venue modal ── */}
      {editingVenue && (
        <div className="modal-overlay" onClick={() => !venueFormBusy && setEditingVenue(null)}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h3>{editingVenue === 'new' ? '+ New venue' : `✎ Edit "${editingVenue.name}"`}</h3>
              <button className="icon-btn" onClick={() => setEditingVenue(null)} disabled={venueFormBusy}>×</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <div className="field">
                <label>Venue name <span style={{ color: 'var(--red)' }}>*</span></label>
                <input
                  autoFocus
                  value={venueForm.name}
                  onChange={e => setVenueForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Sizzle N Sambar — Vic Park"
                />
              </div>
              <div className="field-row">
                <div className="field">
                  <label>ABN</label>
                  <input
                    value={venueForm.abn}
                    onChange={e => setVenueForm(f => ({ ...f, abn: e.target.value }))}
                    placeholder="97 668 265 683"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                </div>
                <div className="field">
                  <label>Timezone</label>
                  <select value={venueForm.timezone} onChange={e => setVenueForm(f => ({ ...f, timezone: e.target.value }))}>
                    {['Australia/Perth','Australia/Sydney','Australia/Melbourne','Australia/Brisbane','Australia/Adelaide','Australia/Darwin','Australia/Hobart','Pacific/Auckland','Asia/Singapore'].map(tz => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="field">
                <label>Phone</label>
                <input
                  value={venueForm.phone}
                  onChange={e => setVenueForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="08 9XXX XXXX"
                  type="tel"
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </div>
              <div className="field">
                <label>Address</label>
                <input
                  value={venueForm.address}
                  onChange={e => setVenueForm(f => ({ ...f, address: e.target.value }))}
                  placeholder="13/964 Albany Hwy, East Victoria Park WA 6101"
                />
              </div>
              {editingVenue === 'new' && (
                <div style={{ background: 'var(--blue-deep)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--blue)', lineHeight: 1.6 }}>
                  A venue ID is auto-generated from the name. A default manager account (PIN 1234) is created automatically — change it in the Users panel after switching to this venue.
                </div>
              )}
              {venueFormErr && (
                <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 4 }}>{venueFormErr}</div>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn-ghost" onClick={() => setEditingVenue(null)} disabled={venueFormBusy}>Cancel</button>
              <button className="btn btn-primary btn-lg" onClick={saveVenue} disabled={venueFormBusy}>
                {venueFormBusy ? 'Saving…' : editingVenue === 'new' ? 'Create venue' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete venue confirm modal ── */}
      {deletingVenue && (
        <div className="modal-overlay" onClick={() => !deleting && setDeletingVenue(null)}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div className="modal-head" style={{ background: 'var(--red-deep)', borderColor: 'rgba(248,113,113,0.3)' }}>
              <h3 style={{ color: 'var(--red)' }}>🗑 Delete venue</h3>
              <button className="icon-btn" onClick={() => setDeletingVenue(null)} disabled={deleting}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 15, fontWeight: 500, marginBottom: 12 }}>
                Permanently delete <b style={{ color: 'var(--brand)' }}>{deletingVenue.name}</b>?
              </p>
              <div style={{ background: 'var(--red-deep)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red)', lineHeight: 1.6, marginBottom: 16 }}>
                ⚠ This permanently deletes the venue and <b>all its data</b> — menu, orders, customers, tables, bookings, users. This cannot be undone.
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label style={{ color: 'var(--text-2)' }}>
                  Type <b style={{ fontFamily: 'var(--font-mono)', color: 'var(--red)' }}>{deletingVenue.name}</b> to confirm
                </label>
                <input
                  autoFocus
                  value={deleteConfirmName}
                  onChange={e => setDeleteConfirmName(e.target.value)}
                  placeholder={deletingVenue.name}
                  style={{ borderColor: deleteConfirmName.trim().toLowerCase() === deletingVenue.name.trim().toLowerCase() ? 'var(--red)' : undefined }}
                />
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn-ghost" onClick={() => setDeletingVenue(null)} disabled={deleting}>Cancel</button>
              <button
                className="btn btn-danger btn-lg"
                onClick={handleDeleteVenue}
                disabled={deleting || deleteConfirmName.trim().toLowerCase() !== deletingVenue.name.trim().toLowerCase()}
                style={{ opacity: deleteConfirmName.trim().toLowerCase() === deletingVenue.name.trim().toLowerCase() ? 1 : 0.4 }}
              >
                {deleting ? 'Deleting everything…' : '🗑 Delete venue forever'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Menu sync: copy menu from one venue to others ────────────────────
function MenuSync({ venues, onToast, currentId }) {
  const [source, setSource] = useState(currentId);
  const [targets, setTargets] = useState(new Set());
  const [busy, setBusy] = useState(false);

  const toggleTarget = (id) => {
    setTargets(t => {
      const next = new Set(t);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const sync = async () => {
    if (!source || targets.size === 0) return;
    setBusy(true);
    try {
      // Fetch source menu
      const catsSnap = await getDocs(collection(db, 'venues', source, 'menu_categories'));
      const itemsSnap = await getDocs(collection(db, 'venues', source, 'menu_items'));
      const modsSnap  = await getDocs(collection(db, 'venues', source, 'modifier_groups'));

      const cats = catsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const items = itemsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const mods = modsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      let totalCopied = 0;
      // Push to each target
      for (const targetId of targets) {
        // Map source category IDs → target category IDs
        const catIdMap = new Map();
        for (const c of cats) {
          const ref = await addDoc(collection(db, 'venues', targetId, 'menu_categories'), {
            name: c.name, order: c.order, color: c.color || '#ff7a45',
            description: c.description || '', active: c.active !== false
          });
          catIdMap.set(c.id, ref.id);
        }

        // Map modifier group IDs
        const modIdMap = new Map();
        for (const m of mods) {
          const ref = await addDoc(collection(db, 'venues', targetId, 'modifier_groups'), {
            name: m.name, type: m.type || 'single',
            required: !!m.required, minSelect: m.minSelect || 1, maxSelect: m.maxSelect || 1,
            options: m.options || []
          });
          modIdMap.set(m.id, ref.id);
        }

        // Items — remap categoryId and modifierGroupIds
        for (const it of items) {
          const remappedMods = (it.modifierGroupIds || [])
            .map(id => modIdMap.get(id))
            .filter(Boolean);
          await addDoc(collection(db, 'venues', targetId, 'menu_items'), {
            name: it.name, price: it.price || 0,
            categoryId: catIdMap.get(it.categoryId) || '',
            station: it.station || 'kitchen',
            description: it.description || '',
            taxPct: it.taxPct || 10,
            active: it.active !== false,
            modifierGroupIds: remappedMods
          });
          totalCopied++;
        }
      }
      onToast?.(`Synced ${totalCopied} items to ${targets.size} venue${targets.size === 1 ? '' : 's'}`, 'info');
      setTargets(new Set());
    } catch (e) {
      onToast?.(`Sync failed: ${e.message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="menu-sync">
      <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16, lineHeight: 1.5 }}>
        Copy menu (categories + items + modifier groups) from one venue to others.
        New items are added; existing items aren't touched. Use this when you set up a new venue
        or want to roll out a menu change to all locations.
      </div>

      <div className="field">
        <label>Copy from</label>
        <select value={source} onChange={e => setSource(e.target.value)}>
          {venues.map(v => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>Copy to (select one or more)</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {venues.filter(v => v.id !== source).map(v => (
            <label key={v.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px',
              background: targets.has(v.id) ? 'rgba(255,122,69,0.08)' : 'var(--surface-2)',
              border: `1px solid ${targets.has(v.id) ? 'var(--brand)' : 'var(--border)'}`,
              borderRadius: 8, cursor: 'pointer', fontSize: 14
            }}>
              <input
                type="checkbox"
                checked={targets.has(v.id)}
                onChange={() => toggleTarget(v.id)}
                style={{ width: 'auto', margin: 0 }}
              />
              <span style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic' }}>{v.name}</span>
            </label>
          ))}
        </div>
      </div>

      <button
        className="btn btn-primary btn-lg"
        disabled={!source || targets.size === 0 || busy}
        onClick={sync}
      >
        {busy ? 'Syncing…' : `⇆ Sync menu to ${targets.size} venue${targets.size === 1 ? '' : 's'}`}
      </button>
    </div>
  );
}
