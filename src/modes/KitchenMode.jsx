import { useEffect, useState, useMemo, useRef } from 'react';
import {
  watchKitchenOrders, bumpOrderItem, updateOrder,
  extendOrderWait, watchVenue, updateVenue, watchTables
} from '../lib/data';
import { useDevice } from '../context/DeviceContext';
import { sendKOTNotification } from '../lib/native';

const STATIONS = [
  { id: 'all', label: 'All' },
  { id: 'kitchen', label: 'Kitchen' },
  { id: 'bar', label: 'Bar' }
];

const DEFAULT_WARN_MINS  = 8;
const DEFAULT_ALERT_MINS = 20;
const EXTEND_MINS = 5;

/* ── Alert sound synthesised via Web Audio API (no file needed) ─────────── */
function playAlertSound(type = 'new') {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;

    if (type === 'new') {
      // Two rising tones — unmistakable "new order" ping
      [[0, 880], [0.15, 1100]].forEach(([offset, freq]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + offset);
        gain.gain.setValueAtTime(0.5, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.35);
        osc.start(now + offset);
        osc.stop(now + offset + 0.35);
      });
    } else {
      // Single lower tone — "order modified"
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(660, now);
      gain.gain.setValueAtTime(0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.start(now);
      osc.stop(now + 0.4);
    }
    // Auto-close context after sound finishes
    setTimeout(() => ctx.close(), 800);
  } catch (_) { /* audio not available */ }
}

/* Build a fingerprint for an order so we can detect modifications ────────── */
function orderFingerprint(order) {
  return JSON.stringify({
    items: (order.items || []).map(i => ({ name: i.name, qty: i.qty, notes: i.notes, selections: i.selections })),
    status: order.status,
  });
}

export default function KitchenMode() {
  const { device } = useDevice();
  const [orders, setOrders]     = useState([]);
  const [tables, setTables]     = useState([]);
  const [station, setStation]   = useState('all');
  const [venue, setVenue]       = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  // collapsed: orderId -> bool. Default true (collapsed) for busy-day UX.
  const [collapsed, setCollapsed] = useState({});
  // Track which orderIds we've seen so new ones default to expanded
  const seenIds = useRef(new Set());

  // Alert system: track fingerprints to detect modifications
  const fingerprintRef = useRef({});         // orderId -> last fingerprint
  const [alertQueue, setAlertQueue] = useState([]); // { id, type: 'new'|'modified' }
  const [flashIds, setFlashIds] = useState(new Set()); // orderIds currently flashing

  const venueId = device?.venueId;
  useEffect(() => { if (!venueId) return; return watchKitchenOrders(setOrders); }, [venueId]);
  useEffect(() => { if (!venueId) return; return watchVenue(setVenue); }, [venueId]);
  useEffect(() => { if (!venueId) return; return watchTables(setTables); }, [venueId]);

  const alertMins = venue?.kdsAlertMins ?? DEFAULT_ALERT_MINS;
  const warnMins  = venue?.kdsWarnMins  ?? DEFAULT_WARN_MINS;

  const tickets = useMemo(() => {
    return orders
      .filter(o => o.status !== 'paid' && o.status !== 'voided' && !o.clearedFromKitchen)
      .map(o => {
        const allItems = o.items || [];
        const visibleIndices = allItems
          .map((it, i) => (station === 'all' || it.station === station) ? i : -1)
          .filter(i => i >= 0);
        return { order: o, allItems, visibleIndices };
      })
      .filter(t => t.visibleIndices.length > 0)
      // Newest first — most recent order at top
      .sort((a, b) =>
        (b.order.sentAt?.toMillis?.() || 0) - (a.order.sentAt?.toMillis?.() || 0)
      );
  }, [orders, station]);

  // Auto-expand new tickets as they arrive; keep existing collapse state
  useEffect(() => {
    setCollapsed(prev => {
      const next = { ...prev };
      let changed = false;
      tickets.forEach(t => {
        const id = t.order.id;
        if (!seenIds.current.has(id)) {
          seenIds.current.add(id);
          next[id] = false; // new ticket: expanded
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [tickets]);

  // ── Alert detection: new orders + modifications ──────────────────────────
  const isFirstLoad = useRef(true);
  useEffect(() => {
    // Skip the very first snapshot (page load) — no alerts for existing tickets
    if (isFirstLoad.current) {
      tickets.forEach(t => {
        fingerprintRef.current[t.order.id] = orderFingerprint(t.order);
      });
      isFirstLoad.current = false;
      return;
    }

    const newAlerts = [];
    tickets.forEach(t => {
      const id = t.order.id;
      const fp = orderFingerprint(t.order);
      const prevFp = fingerprintRef.current[id];

      if (!prevFp) {
        // Brand new order
        newAlerts.push({ id, type: 'new' });
      } else if (prevFp !== fp) {
        // Existing order was modified
        newAlerts.push({ id, type: 'modified' });
      }
      fingerprintRef.current[id] = fp;
    });

    if (newAlerts.length > 0) {
      // Play sound — use type of first alert (new takes priority)
      const type = newAlerts.some(a => a.type === 'new') ? 'new' : 'modified';
      playAlertSound(type);

      // Android background notification (no-op if app is foreground / web)
      sendKOTNotification({ type, count: newAlerts.filter(a => a.type === 'new').length });

      // Flash the affected tickets
      const ids = new Set(newAlerts.map(a => a.id));
      setFlashIds(ids);
      setTimeout(() => setFlashIds(new Set()), 2500);

      setAlertQueue(prev => [...prev, ...newAlerts]);
    }
  }, [tickets]);

  const toggleCollapse   = (id) => setCollapsed(c => ({ ...c, [id]: !c[id] }));
  const collapseAll      = () => setCollapsed(Object.fromEntries(tickets.map(t => [t.order.id, true])));
  const expandAll        = () => setCollapsed(Object.fromEntries(tickets.map(t => [t.order.id, false])));

  const totalActive  = tickets.length;
  const totalItems   = tickets.reduce((n, t) =>
    n + t.visibleIndices.filter(i => t.allItems[i].status !== 'ready').length, 0);
  const overdueCount = tickets.filter(t => {
    const ms = t.order.sentAt?.toMillis?.() || Date.now();
    return (Date.now() - ms) / 60000 >= alertMins;
  }).length;

  const allCollapsed = tickets.length > 0 && tickets.every(t => collapsed[t.order.id]);

  // Dismiss all alerts
  const dismissAlerts = () => setAlertQueue([]);

  return (
    <div className="kds">
      {/* ── Alert banner ── */}
      {alertQueue.length > 0 && (
        <div className="kds-alert-banner" onClick={dismissAlerts}>
          <span className="kds-alert-icon">🔔</span>
          <span className="kds-alert-text">
            {alertQueue.filter(a => a.type === 'new').length > 0 && (
              <b>{alertQueue.filter(a => a.type === 'new').length} new order{alertQueue.filter(a => a.type === 'new').length !== 1 ? 's' : ''}</b>
            )}
            {alertQueue.filter(a => a.type === 'new').length > 0 && alertQueue.filter(a => a.type === 'modified').length > 0 && ' · '}
            {alertQueue.filter(a => a.type === 'modified').length > 0 && (
              <span>{alertQueue.filter(a => a.type === 'modified').length} order{alertQueue.filter(a => a.type === 'modified').length !== 1 ? 's' : ''} updated</span>
            )}
          </span>
          <span className="kds-alert-dismiss">Tap to dismiss ×</span>
        </div>
      )}

      <div className="kds-toolbar">
        <div className="kds-filter">
          {STATIONS.map(s => (
            <button key={s.id} className={station === s.id ? 'active' : ''} onClick={() => setStation(s.id)}>
              {s.label}
            </button>
          ))}
        </div>

        <div className="kds-stats">
          <span>Tickets: <b>{totalActive}</b></span>
          <span>Items: <b>{totalItems}</b></span>
          {overdueCount > 0 && (
            <span style={{ color: 'var(--red)', fontWeight: 600 }}>🔥 {overdueCount} overdue</span>
          )}
        </div>

        <div className="kds-toolbar-actions">
          {tickets.length > 0 && (
            <button
              onClick={allCollapsed ? expandAll : collapseAll}
              style={{ fontSize: 11, padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-2)' }}
            >
              {allCollapsed ? '▸ Expand All' : '▾ Collapse All'}
            </button>
          )}
          <button
            onClick={() => setShowConfig(true)}
            style={{ fontSize: 11, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-3)' }}
          >⚙ Timers</button>
        </div>
      </div>

      {tickets.length === 0 ? (
        <div className="empty">
          <h3>All clear.</h3>
          <p>No tickets in the queue. Orders from Floor and Till will appear here in real time.</p>
        </div>
      ) : (
        <div className="kds-grid">
          {tickets.map(t => (
            <Ticket
              key={t.order.id}
              order={t.order}
              allItems={t.allItems}
              visibleIndices={t.visibleIndices}
              warnMins={warnMins}
              alertMins={alertMins}
              collapsed={!!collapsed[t.order.id]}
              onToggleCollapse={() => toggleCollapse(t.order.id)}
              tables={tables}
              flashing={flashIds.has(t.order.id)}
            />
          ))}
        </div>
      )}

      {showConfig && (
        <WaitConfigModal
          warnMins={warnMins}
          alertMins={alertMins}
          onSave={async (warn, alert) => {
            await updateVenue({ kdsWarnMins: warn, kdsAlertMins: alert });
            setShowConfig(false);
          }}
          onClose={() => setShowConfig(false)}
        />
      )}
    </div>
  );
}

/* ── Ticket ──────────────────────────────────────────────────────────── */
function Ticket({ order, allItems, visibleIndices, warnMins, alertMins, collapsed, onToggleCollapse, tables, flashing }) {
  // Own 1-second interval so the clock actually ticks every second
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const sentMs  = order.sentAt?.toMillis?.() || Date.now();
  const ageMs   = Date.now() - sentMs;
  const ageSec  = Math.floor(ageMs / 1000);
  const ageMin  = Math.floor(ageSec / 60);
  const ss      = (ageSec % 60).toString().padStart(2, '0');

  const isOverdue = ageMin >= alertMins;
  const isWarning = ageMin >= warnMins && !isOverdue;
  const cls = isOverdue ? 'urgent' : isWarning ? 'warning' : 'fresh';

  const extensions = order.waitExtensions || 0;
  const doneCount  = visibleIndices.filter(i => allItems[i].status === 'ready').length;
  const totalCount = visibleIndices.length;

  const [showMoveTable, setShowMoveTable] = useState(false);

  const handleBump = async (originalIndex) => {
    const it = allItems[originalIndex];
    if (!it) return;
    const newStatus = it.status === 'ready' ? 'sent' : 'ready';
    await bumpOrderItem(order.id, originalIndex, newStatus, allItems);
  };

  const handleAllReady = async () => {
    const items = allItems.map((item, idx) =>
      visibleIndices.includes(idx) ? { ...item, status: 'ready' } : item
    );
    const everythingReady = items.every(i => i.status === 'ready' || i.status === 'served');
    await updateOrder(order.id, {
      items,
      ...(everythingReady ? { status: 'ready' } : { status: 'preparing' })
    });
  };

  const handleServed = async () => updateOrder(order.id, { status: 'served' });

  const handleExtend = async (e) => {
    e.stopPropagation();
    await extendOrderWait(order.id, EXTEND_MINS);
  };

  const handleMoveTable = async (newTable) => {
    await updateOrder(order.id, {
      tableId: newTable.id,
      tableNumber: newTable.number
    });
    setShowMoveTable(false);
  };

  const isDineIn     = !!order.tableId;
  const primaryLabel = isDineIn
    ? `Table ${order.tableNumber || order.tableId.replace('t', '')}`
    : (order.customerName || 'Takeaway');
  const typeBadge = isDineIn ? 'DINE-IN' : 'TAKEAWAY';

  return (
    <div className={`kds-ticket ${cls} ${collapsed ? 'collapsed' : ''} ${isDineIn ? 'kds-ticket--dinein' : 'kds-ticket--takeaway'} ${flashing ? 'kds-ticket--flash' : ''}`}>

      {/* ── Header ── */}
      <button className="kds-ticket-head" onClick={onToggleCollapse}>
        <div className="kds-ticket-head-left">
          <div className={`kds-type-badge ${isDineIn ? 'dinein' : 'takeaway'}`}>
            {isDineIn ? '🍽' : '🥡'} {typeBadge}
          </div>
          <div className="kds-primary-label">{primaryLabel}</div>
          <div className="kds-secondary">
            <span className={`kds-progress ${doneCount === totalCount ? 'done' : ''}`}>
              {doneCount}/{totalCount} done
            </span>
            {extensions > 0 && (
              <span className="kds-extensions" title={`Extended ${extensions}×`}>
                +{extensions}⏱
              </span>
            )}
          </div>
        </div>
        <div className="kds-ticket-head-right">
          <b className={`kds-time ${isOverdue ? 'time-overdue' : isWarning ? 'time-warn' : ''}`}>
            {ageMin}:{ss}
          </b>
          <span className="collapse-icon">{collapsed ? '▸' : '▾'}</span>
        </div>
      </button>

      {/* ── Items ── */}
      {!collapsed && (
        <>
          <div className="kds-items">
            {visibleIndices.map(idx => {
              const it = allItems[idx];
              return (
                <div key={idx} className={`kds-item ${it.status === 'ready' ? 'done' : ''}`}>
                  <span className="qty">{it.qty}×</span>
                  <span className="label">
                    {it.name}
                    {it.isMisc && <span style={{ fontSize: 10, color: 'var(--amber)', marginLeft: 6, fontWeight: 600 }}>MISC</span>}
                    {(it.selections || []).length > 0 && (
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--blue)', marginTop: 2, fontWeight: 500 }}>
                        {it.selections.map(s => s.label).join(' · ')}
                      </span>
                    )}
                    {it.notes && <span className="notes">↳ {it.notes}</span>}
                  </span>
                  <button className="bump" onClick={() => handleBump(idx)}>
                    {it.status === 'ready' ? '✓' : '○'}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="kds-ticket-foot">
            <button className="btn btn-extend" onClick={handleExtend} title={`Add ${EXTEND_MINS} min`}>
              +{EXTEND_MINS}m
              {extensions > 0 && <span className="ext-badge">{extensions}</span>}
            </button>

            {/* Move table — only for dine-in */}
            {isDineIn && (
              <button
                className="btn"
                style={{ fontSize: 12, background: 'var(--surface-3)', color: 'var(--text-2)' }}
                onClick={e => { e.stopPropagation(); setShowMoveTable(true); }}
              >
                ⇄ Move Table
              </button>
            )}

            {order.status === 'ready'
              ? <button className="btn btn-success" onClick={handleServed}>Mark Served</button>
              : <button className="btn btn-ready" onClick={handleAllReady}>All Ready</button>
            }
          </div>
        </>
      )}

      {/* ── Collapsed summary ── */}
      {collapsed && (
        <div className="kds-ticket-collapsed">
          <span className="collapsed-items">{totalCount} item{totalCount !== 1 ? 's' : ''}</span>
          <span className={`collapsed-time ${isOverdue ? 'time-overdue' : isWarning ? 'time-warn' : ''}`}>
            {ageMin}:{ss}
          </span>
          {doneCount > 0 && <span className="collapsed-progress">{doneCount}/{totalCount} done</span>}
        </div>
      )}

      {/* ── Move Table modal ── */}
      {showMoveTable && (
        <MoveTableModal
          currentTableId={order.tableId}
          tables={tables}
          onMove={handleMoveTable}
          onClose={() => setShowMoveTable(false)}
        />
      )}
    </div>
  );
}

/* ── Move Table Modal ────────────────────────────────────────────────── */
function MoveTableModal({ currentTableId, tables, onMove, onClose }) {
  const available = tables.filter(t => t.id !== currentTableId);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 340 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Move to Table</h3>
          <button className="icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ padding: '8px 0' }}>
          {available.length === 0 ? (
            <p style={{ color: 'var(--text-3)', padding: '0 16px' }}>No other tables available.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, padding: '0 16px' }}>
              {available.map(t => (
                <button
                  key={t.id}
                  onClick={() => onMove(t)}
                  style={{
                    padding: '12px 6px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: t.status === 'free' ? 'var(--surface-2)' : 'var(--surface-3)',
                    color: t.status === 'free' ? 'var(--text-1)' : 'var(--text-3)',
                    fontWeight: 600,
                    fontSize: 15,
                    cursor: 'pointer'
                  }}
                >
                  T{t.number}
                  <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-3)', marginTop: 2 }}>
                    {t.status === 'free' ? 'free' : t.status}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/* ── Wait config modal ───────────────────────────────────────────────── */
function WaitConfigModal({ warnMins, alertMins, onSave, onClose }) {
  const [warn,  setWarn]  = useState(String(warnMins));
  const [alert, setAlert] = useState(String(alertMins));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Timer settings</h3>
          <button className="icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 18, lineHeight: 1.5 }}>
            Tickets change colour when they exceed these thresholds.
          </p>
          <div className="field">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 12, height: 12, borderRadius: 999, background: 'var(--amber)', display: 'inline-block' }} />
              Amber warning after (mins)
            </label>
            <input
              value={warn}
              onChange={e => setWarn(e.target.value.replace(/\D/g,''))}
              inputMode="numeric"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 20, textAlign: 'center' }}
            />
          </div>
          <div className="field">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 12, height: 12, borderRadius: 999, background: 'var(--red)', display: 'inline-block' }} />
              Red alert after (mins)
            </label>
            <input
              value={alert}
              onChange={e => setAlert(e.target.value.replace(/\D/g,''))}
              inputMode="numeric"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 20, textAlign: 'center' }}
            />
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5, marginTop: 4 }}>
            These settings apply to all KDS devices for this venue immediately.
          </p>
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => {
            const w = Math.max(1, parseInt(warn)  || 8);
            const a = Math.max(w + 1, parseInt(alert) || 20);
            onSave(w, a);
          }}>Save</button>
        </div>
      </div>
    </div>
  );
}
