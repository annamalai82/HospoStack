import { useState, useEffect, useMemo } from 'react';
import { db } from '../lib/firebase';
import { collection, onSnapshot, query, where, getDocs, writeBatch, doc, addDoc } from 'firebase/firestore';
import { useDevice } from '../context/DeviceContext';
import { watchVenues, setVenueId } from '../lib/data';

export default function GroupAdminPanel({ onToast }) {
  const { device, switchVenue } = useDevice();
  const [venues, setVenues] = useState([]);
  const [venueStats, setVenueStats] = useState({}); // venueId → { todaySales, openOrders, openTabs, overdue, ... }
  const [tick, setTick] = useState(0);

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

      {/* Per-venue cards */}
      <div className="section">
        <div className="section-head">
          <h4>Venues</h4>
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
            Updates every 30s · last refresh just now
          </span>
        </div>
        <div className="venue-card-grid">
          {venues.map(v => {
            const stats = venueStats[v.id] || {};
            const isCurrent = v.id === device.venueId;
            return (
              <div
                key={v.id}
                className={`venue-overview-card ${isCurrent ? 'current' : ''}`}
              >
                <div className="venue-overview-head">
                  <div>
                    <div className="venue-overview-name">{v.name}</div>
                    {isCurrent && <span className="venue-current-badge">This device</span>}
                  </div>
                  {stats.overdue > 0 && (
                    <div className="venue-overdue-badge">🔥 {stats.overdue}</div>
                  )}
                </div>
                <div className="venue-overview-stats">
                  <div>
                    <div className="ll">Today</div>
                    <div className="vv" style={{ color: 'var(--brand)' }}>
                      ${(stats.todaySales || 0).toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div className="ll">Orders</div>
                    <div className="vv">{stats.todayOrders || 0}</div>
                  </div>
                  <div>
                    <div className="ll">Open</div>
                    <div className="vv">{stats.openOrders || 0}</div>
                  </div>
                  <div>
                    <div className="ll">In kitchen</div>
                    <div className="vv" style={{ color: stats.kitchenTickets > 0 ? 'var(--amber)' : 'var(--text-3)' }}>
                      {stats.kitchenTickets || 0}
                    </div>
                  </div>
                </div>
                <div className="venue-overview-foot">
                  <button
                    className="btn btn-sm"
                    disabled={isCurrent}
                    style={{ opacity: isCurrent ? 0.4 : 1, flex: 1 }}
                    onClick={() => {
                      switchVenue(v.id, v.name);
                      onToast?.(`Switched to ${v.name}`, 'info');
                      setTimeout(() => window.location.reload(), 500);
                    }}
                  >
                    {isCurrent ? '✓ Current venue' : 'Switch to this venue'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Menu sync */}
      <div className="section">
        <div className="section-head">
          <h4>Menu sync</h4>
        </div>
        <MenuSync venues={venues} onToast={onToast} currentId={device.venueId} />
      </div>
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
