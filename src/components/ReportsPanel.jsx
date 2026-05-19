import { useEffect, useMemo, useState } from 'react';
import { watchSettledOrders } from '../lib/data';
import Modal from './Modal';

const RANGES = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'Last 7 days' },
  { id: 'month', label: 'Last 30 days' }
];

export default function ReportsPanel() {
  const [orders, setOrders] = useState([]);
  const [range, setRange] = useState('today');
  const [viewOrder, setViewOrder] = useState(null);

  useEffect(() => watchSettledOrders(setOrders), []);

  const filtered = useMemo(() => {
    const cutoff = rangeStart(range);
    return orders.filter(o => (o.paidAt?.toMillis?.() || 0) >= cutoff.getTime());
  }, [orders, range]);

  const stats = useMemo(() => computeStats(filtered), [filtered]);

  return (
    <>
      <h3>Sales reports</h3>
      <p className="subtitle">Real-time sales, GST, payment mix and top items. Updates as orders settle.</p>

      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {RANGES.map(r => (
          <button
            key={r.id}
            className={`cat-chip ${range === r.id ? 'active' : ''}`}
            onClick={() => setRange(r.id)}
          >{r.label}</button>
        ))}
      </div>

      <div className="stat-grid">
        <Stat label="Gross sales" value={`$${stats.gross.toFixed(2)}`} />
        <Stat label="Net (ex GST)" value={`$${stats.net.toFixed(2)}`} />
        <Stat label="GST collected" value={`$${stats.gst.toFixed(2)}`} />
        <Stat label="Orders" value={stats.count} />
        <Stat label="Avg order" value={`$${stats.avg.toFixed(2)}`} />
        <Stat label="Items sold" value={stats.itemsCount} />
      </div>

      {filtered.length > 0 && (
        <>
          <div className="section-head"><h4>By hour</h4></div>
          <div className="bar-chart">
            <div className="chart-area">
              {stats.byHour.map((v, h) => (
                <div
                  key={h}
                  className="bar"
                  style={{ height: `${stats.maxHour > 0 ? (v / stats.maxHour) * 100 : 0}%` }}
                  title={`${h}:00 — $${v.toFixed(2)}`}
                />
              ))}
            </div>
            <div className="axis">
              {Array.from({ length: 24 }, (_, h) => <span key={h}>{h}</span>)}
            </div>
          </div>

          <div className="section-head"><h4>Top items</h4></div>
          <div className="top-items" style={{ marginBottom: 24 }}>
            {stats.topItems.slice(0, 8).map((it, i) => (
              <div key={it.name} className="item">
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span className="rank">{i + 1}</span>
                  <span>{it.name}</span>
                </div>
                <span className="qty">×{it.qty}</span>
                <span className="rev">${it.revenue.toFixed(2)}</span>
              </div>
            ))}
          </div>

          <div className="section-head">
            <h4>Settled orders ({filtered.length})</h4>
          </div>
          <div className="data-table">
            <div className="row head" style={{ gridTemplateColumns: '110px 80px 1fr 1fr 100px 60px' }}>
              <div>Time</div>
              <div>Type</div>
              <div>Items</div>
              <div>Payment</div>
              <div>Total</div>
              <div></div>
            </div>
            {filtered.slice(0, 30).map(o => (
              <div key={o.id} className="row" style={{ gridTemplateColumns: '110px 80px 1fr 1fr 100px 60px' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>
                  {fmtTime(o.paidAt)}
                </div>
                <div style={{ fontSize: 12 }}>
                  {o.tableId ? `T${o.tableNumber || o.tableId.replace('t','')}` : (o.orderType || '—')}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
                  {(o.items || []).slice(0, 2).map(i => i.name).join(', ')}
                  {o.items?.length > 2 && <span style={{ color: 'var(--text-3)' }}> +{o.items.length - 2}</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  {(o.payments || []).map(p => p.method).join(', ') || '—'}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--brand)', fontWeight: 600 }}>
                  ${(o.total || 0).toFixed(2)}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="icon-btn" onClick={() => setViewOrder(o)}>›</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {filtered.length === 0 && (
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-3)' }}>
          <p>No settled orders in this range yet.</p>
        </div>
      )}

      {viewOrder && <OrderDetailModal order={viewOrder} onClose={() => setViewOrder(null)} />}
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

function OrderDetailModal({ order, onClose }) {
  return (
    <Modal title={`Order · ${fmtTime(order.paidAt)}`} onClose={onClose}>
      <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 16 }}>
        {order.tableId ? <span>Table <b style={{ color: 'var(--brand)' }}>{order.tableNumber || order.tableId.replace('t','')}</b></span> : <span>{order.orderType || 'takeaway'}</span>}
      </div>

      <div className="data-table" style={{ marginBottom: 18 }}>
        {(order.items || []).map((it, i) => (
          <div key={i} className="row" style={{ gridTemplateColumns: '40px 1fr 80px' }}>
            <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>{it.qty}×</div>
            <div>{it.name}</div>
            <div style={{ fontFamily: 'var(--font-mono)', textAlign: 'right' }}>${(it.price * it.qty).toFixed(2)}</div>
          </div>
        ))}
      </div>

      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-2)' }}>
          <span>Subtotal (ex GST)</span>
          <span>${((order.total || 0) - (order.gst || 0)).toFixed(2)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-2)' }}>
          <span>GST</span>
          <span>${(order.gst || 0).toFixed(2)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, paddingTop: 6, borderTop: '1px dashed var(--border-strong)', fontSize: 18, color: 'var(--text)' }}>
          <span>Total</span>
          <span>${(order.total || 0).toFixed(2)}</span>
        </div>
      </div>

      {order.payments?.length > 0 && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)', marginBottom: 8 }}>
            Payments
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {order.payments.map((p, i) => (
              <span key={i} className="payment-chip">{p.method} ${p.amount.toFixed(2)}</span>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

function rangeStart(range) {
  const now = new Date();
  if (range === 'today') { now.setHours(0,0,0,0); return now; }
  if (range === 'yesterday') {
    const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(0,0,0,0); return d;
  }
  if (range === 'week') {
    const d = new Date(); d.setDate(d.getDate() - 7); return d;
  }
  if (range === 'month') {
    const d = new Date(); d.setDate(d.getDate() - 30); return d;
  }
  return new Date(0);
}

function computeStats(orders) {
  const gross = orders.reduce((s, o) => s + (o.total || 0), 0);
  const gst = orders.reduce((s, o) => s + (o.gst || 0), 0);
  const net = gross - gst;
  const count = orders.length;
  const avg = count ? gross / count : 0;

  const itemsCount = orders.reduce((s, o) => s + (o.items || []).reduce((n, i) => n + i.qty, 0), 0);

  // By hour
  const byHour = Array(24).fill(0);
  orders.forEach(o => {
    const ms = o.paidAt?.toMillis?.();
    if (!ms) return;
    const h = new Date(ms).getHours();
    byHour[h] += o.total || 0;
  });
  const maxHour = Math.max(...byHour, 0);

  // Top items
  const itemAgg = {};
  orders.forEach(o => (o.items || []).forEach(it => {
    if (!itemAgg[it.name]) itemAgg[it.name] = { name: it.name, qty: 0, revenue: 0 };
    itemAgg[it.name].qty += it.qty;
    itemAgg[it.name].revenue += it.qty * it.price;
  }));
  const topItems = Object.values(itemAgg).sort((a, b) => b.revenue - a.revenue);

  return { gross, net, gst, count, avg, itemsCount, byHour, maxHour, topItems };
}

function fmtTime(ts) {
  if (!ts?.toMillis) return '—';
  const d = new Date(ts.toMillis());
  return d.toLocaleString('en-AU', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
}
