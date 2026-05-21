import { useEffect, useState, useMemo } from 'react';
import {
  watchKitchenOrders, bumpOrderItem, updateOrder,
  extendOrderWait, watchVenue, updateVenue
} from '../lib/data';
import { useDevice } from '../context/DeviceContext';

const STATIONS = [
  { id: 'all', label: 'All' },
  { id: 'kitchen', label: 'Kitchen' },
  { id: 'bar', label: 'Bar' }
];

const DEFAULT_WARN_MINS  = 8;
const DEFAULT_ALERT_MINS = 20; // configurable
const EXTEND_MINS = 5;         // each extension adds 5 minutes

export default function KitchenMode() {
  const { device } = useDevice();
  const [orders, setOrders] = useState([]);
  const [station, setStation] = useState('all');
  const [tick, setTick] = useState(0);
  const [venue, setVenue] = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  const [collapsed, setCollapsed] = useState({});

  // Re-subscribe whenever venueId changes (ensures we're watching the right venue)
  const venueId = device?.venueId;
  useEffect(() => {
    if (!venueId) return;
    return watchKitchenOrders(setOrders);
  }, [venueId]);
  useEffect(() => {
    if (!venueId) return;
    return watchVenue(setVenue);
  }, [venueId]);

  // Re-render every 10s for live timing
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 10000);
    return () => clearInterval(t);
  }, []);

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
      .sort((a, b) =>
        (a.order.sentAt?.toMillis?.() || 0) - (b.order.sentAt?.toMillis?.() || 0)
      );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, station, tick]);

  const toggleCollapse = (orderId) =>
    setCollapsed(c => ({ ...c, [orderId]: !c[orderId] }));

  const totalActive = tickets.length;
  const totalItems = tickets.reduce((n, t) =>
    n + t.visibleIndices.filter(i => t.allItems[i].status !== 'ready').length, 0);
  const overdueCount = tickets.filter(t => {
    const ms = t.order.sentAt?.toMillis?.() || Date.now();
    return (Date.now() - ms) / 60000 >= alertMins;
  }).length;

  return (
    <div className="kds">
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
            <span style={{ color: 'var(--red)', fontWeight: 600 }}>
              🔥 {overdueCount} overdue
            </span>
          )}
          <button
            onClick={() => setShowConfig(true)}
            style={{ fontSize: 11, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-3)', marginLeft: 4 }}
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
function Ticket({ order, allItems, visibleIndices, warnMins, alertMins, collapsed, onToggleCollapse }) {
  const sentMs = order.sentAt?.toMillis?.() || Date.now();
  const ageMs  = Date.now() - sentMs;
  const ageSec = Math.floor(ageMs / 1000);
  const ageMin = Math.floor(ageSec / 60);
  const ss = (ageSec % 60).toString().padStart(2, '0');

  const isOverdue = ageMin >= alertMins;
  const isWarning = ageMin >= warnMins && !isOverdue;
  const cls = isOverdue ? 'urgent' : isWarning ? 'warning' : 'fresh';

  const extensions = order.waitExtensions || 0;
  const doneCount  = visibleIndices.filter(i => allItems[i].status === 'ready').length;
  const totalCount = visibleIndices.length;

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

  const orderNumber = (order.id || '').slice(-4).toUpperCase();
  const isDineIn = !!order.tableId;
  const primaryLabel = isDineIn
    ? `Table ${order.tableNumber || order.tableId.replace('t', '')}`
    : (order.customerName || `Takeaway #${orderNumber}`);
  const typeBadge = isDineIn ? 'DINE-IN' : 'TAKEAWAY';

  return (
    <div className={`kds-ticket ${cls} ${collapsed ? 'collapsed' : ''} ${isDineIn ? 'kds-ticket--dinein' : 'kds-ticket--takeaway'}`}>
      {/* ── Header — tap to collapse/expand ── */}
      <button className="kds-ticket-head" onClick={onToggleCollapse}>
        <div className="kds-ticket-head-left">
          <div className={`kds-type-badge ${isDineIn ? 'dinein' : 'takeaway'}`}>
            {isDineIn ? '🍽' : '🥡'} {typeBadge}
          </div>
          <div className="kds-primary-label">{primaryLabel}</div>
          <div className="kds-secondary">
            {!order.customerName && <span className="kds-order-num">#{orderNumber}</span>}
            <span className={`kds-progress ${doneCount === totalCount ? 'done' : ''}`}>
              {doneCount}/{totalCount}
            </span>
            {extensions > 0 && (
              <span className="kds-extensions" title={`Wait extended ${extensions} time${extensions === 1 ? '' : 's'}`}>
                +{extensions}⏱
              </span>
            )}
          </div>
        </div>
        <div className="kds-ticket-head-right">
          <b className={`kds-time ${isOverdue ? 'time-overdue' : isWarning ? 'time-warn' : ''}`}>
            {ageMin}:{ss}
          </b>
          <span className="collapse-icon">{collapsed ? '▸ tap to expand' : '▾'}</span>
        </div>
      </button>

      {/* ── Items — hidden when collapsed ── */}
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
            {/* Extend wait time */}
            <button
              className="btn btn-extend"
              onClick={handleExtend}
              title={`Add ${EXTEND_MINS} min`}
            >
              +{EXTEND_MINS}m
              {extensions > 0 && <span className="ext-badge">{extensions}</span>}
            </button>
            {/* Ready / Served */}
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
            Tickets change colour when they exceed these thresholds. Kitchen staff can also extend a ticket's timer using the +5m button.
          </p>
          <div className="field">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 12, height: 12, borderRadius: 999, background: 'var(--amber)', display: 'inline-block', flexShrink: 0 }} />
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
              <span style={{ width: 12, height: 12, borderRadius: 999, background: 'var(--red)', display: 'inline-block', flexShrink: 0 }} />
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
            These settings apply to all Kitchen Display devices for this venue immediately.
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
