import { useEffect, useState, useMemo } from 'react';
import { watchKitchenOrders, bumpOrderItem, updateOrder } from '../lib/data';

const STATIONS = [
  { id: 'all', label: 'All' },
  { id: 'kitchen', label: 'Kitchen' },
  { id: 'bar', label: 'Bar' },
  { id: 'expo', label: 'Expo' }
];

export default function KitchenMode() {
  const [orders, setOrders] = useState([]);
  const [station, setStation] = useState('all');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    return watchKitchenOrders(setOrders);
  }, []);

  // re-render every 15s for aging
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 15000);
    return () => clearInterval(t);
  }, []);

  // Keep the FULL items array on every ticket; mark which items are visible
  // for the current station filter. This avoids the data-loss bug where bumping
  // an item while filtered would persist a truncated items list back to Firestore.
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
  // tick re-runs the memo every 15s so aging classes update without new data
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, station, tick]);

  const totalActive = tickets.length;
  const totalItems = tickets.reduce((n, t) =>
    n + t.visibleIndices.filter(i => t.allItems[i].status !== 'ready').length, 0);

  return (
    <div className="kds">
      <div className="kds-toolbar">
        <div className="kds-filter">
          {STATIONS.map(s => (
            <button
              key={s.id}
              className={station === s.id ? 'active' : ''}
              onClick={() => setStation(s.id)}
            >{s.label}</button>
          ))}
        </div>
        <div className="kds-stats">
          <span>Active tickets: <b>{totalActive}</b></span>
          <span>Items in queue: <b>{totalItems}</b></span>
        </div>
      </div>

      {tickets.length === 0 ? (
        <div className="empty">
          <h3>All clear.</h3>
          <p>No tickets in the queue. Orders from Floor and Till devices will appear here in real time.</p>
        </div>
      ) : (
        <div className="kds-grid">
          {tickets.map(t => (
            <Ticket
              key={t.order.id}
              order={t.order}
              allItems={t.allItems}
              visibleIndices={t.visibleIndices}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Ticket({ order, allItems, visibleIndices }) {
  const sentMs = order.sentAt?.toMillis?.() || Date.now();
  const ageSec = Math.floor((Date.now() - sentMs) / 1000);
  const ageMin = Math.floor(ageSec / 60);
  const ss = (ageSec % 60).toString().padStart(2, '0');

  const cls = ageMin >= 15 ? 'urgent' : ageMin >= 8 ? 'warning' : 'fresh';

  const handleBump = async (originalIndex) => {
    const it = allItems[originalIndex];
    if (!it) return;
    const newStatus = it.status === 'ready' ? 'sent' : 'ready';
    await bumpOrderItem(order.id, originalIndex, newStatus, allItems);
  };

  const handleAllReady = async () => {
    // Only mark visible (current-station) items ready — leaves bar items alone
    // if a kitchen station bumped its tickets.
    const items = allItems.map((i, idx) =>
      visibleIndices.includes(idx) ? { ...i, status: 'ready' } : i
    );
    const everythingReady = items.every(i => i.status === 'ready' || i.status === 'served');
    await updateOrder(order.id, {
      items,
      ...(everythingReady ? { status: 'ready' } : { status: 'preparing' })
    });
  };

  const handleServed = async () => {
    await updateOrder(order.id, { status: 'served' });
  };

  const orderNumber = (order.id || '').slice(-4).toUpperCase();
  const tableLabel = order.tableId
    ? `Table ${order.tableNumber || order.tableId.replace('t', '')}`
    : (order.orderType || 'takeaway');

  return (
    <div className={`kds-ticket ${cls}`}>
      <div className="kds-ticket-head">
        <div className="num">#{orderNumber}</div>
        <div className="meta">
          <b>{ageMin}:{ss}</b>
          {tableLabel}
        </div>
      </div>
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
              <button className="bump" title="Bump" onClick={() => handleBump(idx)}>
                {it.status === 'ready' ? '✓' : '○'}
              </button>
            </div>
          );
        })}
      </div>
      <div className="kds-ticket-foot">
        {order.status === 'ready'
          ? <button className="btn btn-success" onClick={handleServed}>Mark Served</button>
          : <button className="btn" onClick={handleAllReady}>All Ready</button>
        }
      </div>
    </div>
  );
}
