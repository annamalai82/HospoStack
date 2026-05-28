import { useEffect, useState, useMemo, useRef } from 'react';
import {
  watchKitchenOrders, bumpOrderItem, updateOrder,
  extendOrderWait, watchVenue, updateVenue, watchTables,
  watchMenuItems, set86Status
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

/* ── Continuous alert beep — loops until acknowledged ───────────────────────
   Returns a controller with start()/stop(). Uses a single AudioContext and
   schedules a repeating two-tone beep every ~1.2s while active. */
function createBeepLoop() {
  let ctx = null;
  let timer = null;
  let active = false;

  const beepOnce = () => {
    if (!ctx) return;
    const now = ctx.currentTime;
    // Two rising tones — "new order" ping
    [[0, 880], [0.15, 1100]].forEach(([offset, freq]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + offset);
      gain.gain.setValueAtTime(0.5, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.32);
      osc.start(now + offset);
      osc.stop(now + offset + 0.32);
    });
  };

  return {
    start() {
      if (active) return;
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        // Some browsers start suspended until a user gesture — try to resume
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        active = true;
        beepOnce();                       // immediate first beep
        timer = setInterval(beepOnce, 1200); // then repeat
      } catch (_) { /* audio unavailable */ }
    },
    stop() {
      active = false;
      if (timer) { clearInterval(timer); timer = null; }
      if (ctx) { ctx.close().catch(() => {}); ctx = null; }
    },
    isActive() { return active; }
  };
}

/* One-shot sound for modifications (less intrusive than the new-order loop) */
function playModifiedSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(660, now);
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc.start(now);
    osc.stop(now + 0.4);
    setTimeout(() => ctx.close(), 600);
  } catch (_) { /* audio not available */ }
}

/* Build a fingerprint for an order so we can detect modifications ────────── */
function orderFingerprint(order) {
  return JSON.stringify({
    items: (order.items || []).map(i => ({ name: i.name, qty: i.qty, notes: i.notes, selections: i.selections })),
    status: order.status,
    allergyNote: order.allergyNote || '',
  });
}

export default function KitchenMode() {
  const { device } = useDevice();
  const [orders, setOrders]     = useState([]);
  const [tables, setTables]     = useState([]);
  const [station, setStation]   = useState('all');
  const [venue, setVenue]       = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  const [menuItems, setMenuItems]   = useState([]);
  const [show86, setShow86]         = useState(false);
  // collapsed: orderId -> bool. Default true (collapsed) for busy-day UX.
  const [collapsed, setCollapsed] = useState({});
  // Track which orderIds we've seen so new ones default to expanded
  const seenIds = useRef(new Set());

  // Alert system: track fingerprints to detect modifications
  const fingerprintRef = useRef({});         // orderId -> last fingerprint
  const [alertQueue, setAlertQueue] = useState([]); // { id, type: 'new'|'modified' }
  // Orders that are NEW and not yet acknowledged — these blink continuously
  // and keep the beep looping until the kitchen taps them.
  const [unackedIds, setUnackedIds] = useState(new Set());
  const beepRef = useRef(null);

  // Create the beep loop controller once
  useEffect(() => {
    beepRef.current = createBeepLoop();
    return () => beepRef.current?.stop();
  }, []);

  // Start/stop the continuous beep based on whether any order is unacknowledged
  useEffect(() => {
    if (!beepRef.current) return;
    if (unackedIds.size > 0) beepRef.current.start();
    else                     beepRef.current.stop();
  }, [unackedIds]);

  const venueId = device?.venueId;
  useEffect(() => { if (!venueId) return; return watchKitchenOrders(setOrders); }, [venueId]);
  useEffect(() => { if (!venueId) return; return watchVenue(setVenue); }, [venueId]);
  useEffect(() => { if (!venueId) return; return watchTables(setTables); }, [venueId]);
  useEffect(() => { if (!venueId) return; return watchMenuItems(setMenuItems); }, [venueId]);

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
      const newOrderIds = newAlerts.filter(a => a.type === 'new').map(a => a.id);
      const hasNew = newOrderIds.length > 0;

      if (hasNew) {
        // New orders → add to unacknowledged set (blinks + beeps until tapped)
        setUnackedIds(prev => {
          const next = new Set(prev);
          newOrderIds.forEach(id => next.add(id));
          return next;
        });
      } else {
        // Only modifications → a single soft tone, no continuous alert
        playModifiedSound();
      }

      // Android background notification (no-op if app is foreground / web)
      sendKOTNotification({ type: hasNew ? 'new' : 'modified', count: newOrderIds.length });

      setAlertQueue(prev => [...prev, ...newAlerts]);
    }
  }, [tickets]);

  // Acknowledge a single order — stops its blink (and the beep if it was last)
  const acknowledgeOrder = (id) => {
    setUnackedIds(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    // Also clear it from the alert banner queue
    setAlertQueue(prev => prev.filter(a => a.id !== id));
  };

  // Clean up unacked IDs for orders that no longer exist (paid/voided/cleared)
  useEffect(() => {
    setUnackedIds(prev => {
      if (prev.size === 0) return prev;
      const liveIds = new Set(tickets.map(t => t.order.id));
      let changed = false;
      const next = new Set();
      prev.forEach(id => {
        if (liveIds.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
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

  // Dismiss all alerts — acknowledges every blinking order + stops the beep
  const dismissAlerts = () => { setAlertQueue([]); setUnackedIds(new Set()); };

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
            onClick={() => setShow86(true)}
            className="kds-86-btn"
            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6 }}
          >
            🚫 86 Items
            {menuItems.filter(i => i.outOfStock).length > 0 && (
              <span className="kds-86-count">{menuItems.filter(i => i.outOfStock).length}</span>
            )}
          </button>
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
              unacked={unackedIds.has(t.order.id)}
              onAcknowledge={() => acknowledgeOrder(t.order.id)}
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

      {show86 && (
        <Stock86Modal
          items={menuItems}
          byName={device?.user?.name || 'Kitchen'}
          onClose={() => setShow86(false)}
        />
      )}
    </div>
  );
}

/* ── Ticket ──────────────────────────────────────────────────────────── */
function Ticket({ order, allItems, visibleIndices, warnMins, alertMins, collapsed, onToggleCollapse, tables, unacked, onAcknowledge }) {
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

  // Batch detection: items added to an existing table order carry a newer
  // sentBatch than the order's first batch. The most recent batch is "new".
  const batches = allItems.map(it => it.sentBatch || 0).filter(Boolean);
  const minBatch = batches.length ? Math.min(...batches) : 0;
  const maxBatch = batches.length ? Math.max(...batches) : 0;
  const hasNewItems = maxBatch > minBatch;
  // Acknowledge state for the "new items added" highlight (local to ticket)
  const [newItemsAcked, setNewItemsAcked] = useState(false);
  // Reset acknowledgement whenever a newer batch arrives
  useEffect(() => { setNewItemsAcked(false); }, [maxBatch]);
  const showNewHighlight = hasNewItems && !newItemsAcked;
  const isNewBatchItem = (it) => (it.sentBatch || 0) === maxBatch && maxBatch > minBatch;

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
    <div className={`kds-ticket ${cls} ${collapsed ? 'collapsed' : ''} ${isDineIn ? 'kds-ticket--dinein' : 'kds-ticket--takeaway'} ${unacked ? 'kds-ticket--alert' : ''} ${showNewHighlight ? 'kds-ticket--newitems' : ''}`}>

      {/* New-order acknowledgement banner — tap to stop blink + beep */}
      {unacked && (
        <button className="kds-ticket-ack" onClick={onAcknowledge} title="Tap to acknowledge">
          <span className="kds-ticket-ack-pulse">🔔</span>
          <span>NEW ORDER — tap to acknowledge</span>
        </button>
      )}

      {/* Added-items banner — when a waiter adds items to an existing order */}
      {showNewHighlight && !unacked && (
        <button
          className="kds-ticket-newitems-banner"
          onClick={() => setNewItemsAcked(true)}
          title="Tap to acknowledge added items"
        >
          <span className="kds-newitems-pulse">➕</span>
          <span>ITEMS ADDED — tap to acknowledge</span>
        </button>
      )}

      {/* ── Header ── */}
      <button
        className="kds-ticket-head"
        onClick={() => { if (unacked) onAcknowledge(); if (showNewHighlight) setNewItemsAcked(true); onToggleCollapse(); }}
      >
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
          {/* Order-level allergy alert — from booking note OR any item allergen */}
          {(() => {
            const itemAllergens = [...new Set(
              visibleIndices.flatMap(i => allItems[i].allergens || [])
            )];
            const note = order.allergyNote || order.customerAllergies;
            if (!note && itemAllergens.length === 0) return null;
            return (
              <div className="kds-allergy-banner">
                <span className="kds-allergy-icon">⚠</span>
                <div>
                  <div className="kds-allergy-title">ALLERGEN ALERT</div>
                  {note && <div className="kds-allergy-note">Customer: {note}</div>}
                  {itemAllergens.length > 0 && (
                    <div className="kds-allergy-tags">
                      {itemAllergens.map(a => <span key={a}>{a}</span>)}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
          <div className="kds-items">
            {visibleIndices.map(idx => {
              const it = allItems[idx];
              const itemIsNew = isNewBatchItem(it) && showNewHighlight;
              return (
                <div key={idx} className={`kds-item ${it.status === 'ready' ? 'done' : ''} ${itemIsNew ? 'kds-item--new' : ''}`}>
                  <span className="qty">{it.qty}×</span>
                  <span className="label">
                    {itemIsNew && <span className="kds-item-new-tag">NEW</span>}
                    {it.name}
                    {it.isMisc && <span style={{ fontSize: 10, color: 'var(--amber)', marginLeft: 6, fontWeight: 600 }}>MISC</span>}
                    {(it.allergens || []).length > 0 && (
                      <span className="kds-item-allergens">
                        {it.allergens.map(a => (
                          <span key={a} className="kds-allergen-tag">⚠ {a}</span>
                        ))}
                      </span>
                    )}
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

/* ── 86 / Out-of-stock manager modal ──────────────────────────────────────
   Kitchen taps an item to toggle it out of stock. Toggling fires a stock
   alert (banner + beep) on every Floor & Till device instantly. */
function Stock86Modal({ items, byName, onClose }) {
  const [search, setSearch] = useState('');
  const [busy, setBusy]     = useState(null); // itemId being toggled

  const sorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...items]
      .filter(i => !q || i.name.toLowerCase().includes(q))
      // Out-of-stock first, then alphabetical
      .sort((a, b) => {
        if (!!a.outOfStock !== !!b.outOfStock) return a.outOfStock ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [items, search]);

  const toggle = async (item) => {
    setBusy(item.id);
    try {
      await set86Status(item, !item.outOfStock, byName);
    } finally {
      setBusy(null);
    }
  };

  const oosCount = items.filter(i => i.outOfStock).length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="stock86-modal" onClick={e => e.stopPropagation()}>
        <div className="stock86-head">
          <div>
            <h3 style={{ margin: 0 }}>🚫 86 / Out of stock</h3>
            <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
              Tap an item to toggle. Waiters &amp; cashiers are alerted instantly.
              {oosCount > 0 && <b style={{ color: 'var(--red)' }}> · {oosCount} currently 86'd</b>}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}>×</button>
        </div>

        <div className="stock86-search">
          <input
            placeholder="Search menu items…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        <div className="stock86-list">
          {sorted.length === 0 && (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-3)' }}>
              No items match.
            </div>
          )}
          {sorted.map(item => (
            <button
              key={item.id}
              className={`stock86-item ${item.outOfStock ? 'is-oos' : ''}`}
              onClick={() => toggle(item)}
              disabled={busy === item.id}
            >
              <div className="stock86-item-info">
                <span className="stock86-item-name">{item.name}</span>
                <span className="stock86-item-station">{item.station}</span>
              </div>
              <span className={`stock86-toggle ${item.outOfStock ? 'on' : ''}`}>
                {busy === item.id
                  ? '…'
                  : item.outOfStock ? '86 — OUT' : 'In stock'}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
