import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from './Modal';

// ─── Tab definitions ────────────────────────────────────────────────────────
const TABS = [
  { id: 'summary',  label: '📊 Summary'    },
  { id: 'items',    label: '🍽 Items'       },
  { id: 'time',     label: '🕐 Time'        },
  { id: 'orders',   label: '📋 Orders'      },
  { id: 'payments', label: '💳 Payments'    },
];

const ORDER_TYPES = [
  { id: 'all',           label: 'All types'   },
  { id: 'dine-in-pickup',label: 'Dine-in'     },
  { id: 'takeaway',      label: 'Takeaway'    },
  { id: 'quick',         label: 'Quick'       },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtAUD(n) { return '$' + (n || 0).toFixed(2); }
function fmtPct(n, total) { return total ? ((n / total) * 100).toFixed(1) + '%' : '0%'; }

function fmtDateTime(ts) {
  if (!ts?.toMillis) return '—';
  return new Date(ts.toMillis()).toLocaleString('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true
  });
}

function fmtDate(ts) {
  if (!ts?.toMillis) return '—';
  return new Date(ts.toMillis()).toLocaleDateString('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function localStartOfDay(dateStr) {
  // dateStr = 'YYYY-MM-DD'
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
  return dt;
}
function localEndOfDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

function orderTypeLabel(o) {
  if (o.tableId) return 'dine-in-pickup';
  return o.orderType || 'takeaway';
}

// ─── Main ReportsPanel ───────────────────────────────────────────────────────
export default function ReportsPanel() {
  const [allOrders, setAllOrders] = useState([]);
  const [tab, setTab]             = useState('summary');
  const [orderType, setOrderType] = useState('all');
  const [viewOrder, setViewOrder] = useState(null);

  // Date range — default to today
  const todayStr = isoDate(new Date());
  const [fromDate, setFromDate] = useState(todayStr);
  const [toDate,   setToDate]   = useState(todayStr);

  // Quick presets
  const applyPreset = (preset) => {
    const now = new Date();
    if (preset === 'today') {
      setFromDate(isoDate(now)); setToDate(isoDate(now));
    } else if (preset === 'yesterday') {
      const d = new Date(now); d.setDate(d.getDate() - 1);
      setFromDate(isoDate(d)); setToDate(isoDate(d));
    } else if (preset === 'week') {
      const d = new Date(now); d.setDate(d.getDate() - 6);
      setFromDate(isoDate(d)); setToDate(isoDate(now));
    } else if (preset === 'month') {
      const d = new Date(now); d.setDate(d.getDate() - 29);
      setFromDate(isoDate(d)); setToDate(isoDate(now));
    } else if (preset === 'thisMonth') {
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      setFromDate(isoDate(d)); setToDate(isoDate(now));
    } else if (preset === 'lastMonth') {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0);
      setFromDate(isoDate(d)); setToDate(isoDate(e));
    }
  };

  useEffect(() => watchSettledOrders(setAllOrders), []);

  // Filter by date range + order type
  const orders = useMemo(() => {
    const from = localStartOfDay(fromDate).getTime();
    const to   = localEndOfDay(toDate).getTime();
    return allOrders.filter(o => {
      const ms = o.paidAt?.toMillis?.() || 0;
      if (ms < from || ms > to) return false;
      if (orderType !== 'all' && orderTypeLabel(o) !== orderType) return false;
      return true;
    });
  }, [allOrders, fromDate, toDate, orderType]);

  // Core stats always computed
  const stats = useMemo(() => computeStats(orders), [orders]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div>
          <h3 style={{ marginBottom: 2 }}>Sales Reports</h3>
          <p className="subtitle" style={{ marginBottom: 0 }}>
            {orders.length} orders · {fmtAUD(stats.gross)} gross · {fmtAUD(stats.gst)} GST
          </p>
        </div>
        <button className="btn btn-sm" onClick={() => exportCSV(orders, fromDate, toDate)}>
          ⬇ Export CSV
        </button>
      </div>

      {/* ── Filters ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        {/* Presets */}
        {[
          { id: 'today',     label: 'Today'      },
          { id: 'yesterday', label: 'Yesterday'  },
          { id: 'week',      label: 'Last 7 days'},
          { id: 'month',     label: 'Last 30 days'},
          { id: 'thisMonth', label: 'This month' },
          { id: 'lastMonth', label: 'Last month' },
        ].map(p => (
          <button
            key={p.id}
            className="cat-chip"
            style={{ fontSize: 12 }}
            onClick={() => applyPreset(p.id)}
          >{p.label}</button>
        ))}

        {/* Custom date pickers */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
          <input
            type="date" value={fromDate} max={toDate}
            onChange={e => setFromDate(e.target.value)}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 13, padding: '6px 10px',
              background: 'var(--surface-2)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', color: 'var(--text)' }}
          />
          <span style={{ color: 'var(--text-3)', fontSize: 12 }}>→</span>
          <input
            type="date" value={toDate} min={fromDate}
            onChange={e => setToDate(e.target.value)}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 13, padding: '6px 10px',
              background: 'var(--surface-2)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', color: 'var(--text)' }}
          />
        </div>

        {/* Order type filter */}
        <div style={{ display: 'flex', gap: 4, borderLeft: '1px solid var(--border)', paddingLeft: 12 }}>
          {ORDER_TYPES.map(t => (
            <button
              key={t.id}
              className={`cat-chip ${orderType === t.id ? 'active' : ''}`}
              style={{ fontSize: 12 }}
              onClick={() => setOrderType(t.id)}
            >{t.label}</button>
          ))}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '8px 14px', fontSize: 13, fontWeight: tab === t.id ? 600 : 400,
              color: tab === t.id ? 'var(--brand)' : 'var(--text-2)',
              borderBottom: tab === t.id ? '2px solid var(--brand)' : '2px solid transparent',
              background: 'none', marginBottom: -1
            }}
          >{t.label}</button>
        ))}
      </div>

      {orders.length === 0 ? (
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-3)' }}>
          No settled orders for this range &amp; filter.
        </div>
      ) : (
        <>
          {tab === 'summary'  && <SummaryTab  stats={stats} orders={orders} />}
          {tab === 'items'    && <ItemsTab    orders={orders} />}
          {tab === 'time'     && <TimeTab     orders={orders} fromDate={fromDate} toDate={toDate} />}
          {tab === 'orders'   && <OrdersTab   orders={orders} onView={setViewOrder} />}
          {tab === 'payments' && <PaymentsTab orders={orders} stats={stats} />}
        </>
      )}

      {viewOrder && <OrderDetailModal order={viewOrder} onClose={() => setViewOrder(null)} />}
    </div>
  );
}

// ─── Summary tab ─────────────────────────────────────────────────────────────
function SummaryTab({ stats, orders }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* KPI row */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        <StatCard label="Gross sales"   value={fmtAUD(stats.gross)}      highlight />
        <StatCard label="Net (ex GST)"  value={fmtAUD(stats.net)}         />
        <StatCard label="GST collected" value={fmtAUD(stats.gst)}         />
        <StatCard label="Total orders"  value={stats.count}               />
        <StatCard label="Avg order"     value={fmtAUD(stats.avg)}         />
        <StatCard label="Items sold"    value={stats.itemsCount}          />
        <StatCard label="Unique items"  value={stats.uniqueItems}         />
        <StatCard label="Busiest hour"  value={stats.busiestHour !== null ? `${stats.busiestHour}:00` : '—'} />
      </div>

      {/* Order type breakdown */}
      <div className="section">
        <div className="section-head"><h4>By order type</h4></div>
        <div className="data-table">
          <div className="row head" style={{ gridTemplateColumns: '1fr 80px 100px 100px 100px' }}>
            <div>Type</div><div>Orders</div><div>Gross</div><div>GST</div><div>% of sales</div>
          </div>
          {Object.entries(stats.byType).sort((a,b) => b[1].gross - a[1].gross).map(([type, s]) => (
            <div key={type} className="row" style={{ gridTemplateColumns: '1fr 80px 100px 100px 100px' }}>
              <div style={{ textTransform: 'capitalize', fontWeight: 500 }}>{typeLabel(type)}</div>
              <div style={{ fontFamily: 'var(--font-mono)' }}>{s.count}</div>
              <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--brand)' }}>{fmtAUD(s.gross)}</div>
              <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>{fmtAUD(s.gst)}</div>
              <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>{fmtPct(s.gross, stats.gross)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Payment method breakdown */}
      <div className="section">
        <div className="section-head"><h4>By payment method</h4></div>
        <div className="data-table">
          <div className="row head" style={{ gridTemplateColumns: '1fr 80px 100px 100px' }}>
            <div>Method</div><div>Count</div><div>Amount</div><div>% of sales</div>
          </div>
          {Object.entries(stats.byPayment).sort((a,b) => b[1].amount - a[1].amount).map(([method, s]) => (
            <div key={method} className="row" style={{ gridTemplateColumns: '1fr 80px 100px 100px' }}>
              <div style={{ textTransform: 'capitalize', fontWeight: 500 }}>{method}</div>
              <div style={{ fontFamily: 'var(--font-mono)' }}>{s.count}</div>
              <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--brand)' }}>{fmtAUD(s.amount)}</div>
              <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>{fmtPct(s.amount, stats.gross)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Top 10 items preview */}
      <div className="section">
        <div className="section-head"><h4>Top items (preview)</h4></div>
        <div className="data-table">
          <div className="row head" style={{ gridTemplateColumns: '30px 1fr 70px 100px 100px' }}>
            <div>#</div><div>Item</div><div>Qty</div><div>Revenue</div><div>% of sales</div>
          </div>
          {stats.topItems.slice(0, 10).map((it, i) => (
            <div key={it.name} className="row" style={{ gridTemplateColumns: '30px 1fr 70px 100px 100px' }}>
              <div style={{ color: 'var(--text-3)', fontSize: 12 }}>{i + 1}</div>
              <div>{it.name}</div>
              <div style={{ fontFamily: 'var(--font-mono)' }}>×{it.qty}</div>
              <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--brand)' }}>{fmtAUD(it.revenue)}</div>
              <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>{fmtPct(it.revenue, stats.gross)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Items tab ───────────────────────────────────────────────────────────────
function ItemsTab({ orders }) {
  const [sortBy, setSortBy]       = useState('revenue'); // revenue | qty | name | avg
  const [filterText, setFilter]   = useState('');
  const [showVariants, setVariants] = useState(false);

  const itemRows = useMemo(() => {
    const map = {};
    orders.forEach(o => {
      const orderTyp = orderTypeLabel(o);
      (o.items || []).forEach(it => {
        // Key by name + variant (if showVariants) or just name
        const variant = showVariants && it.selections?.length
          ? it.selections.map(s => s.label).join(' · ')
          : null;
        const key = variant ? `${it.name} — ${variant}` : it.name;

        if (!map[key]) map[key] = { name: key, baseName: it.name, variant, qty: 0, revenue: 0, orders: 0, byType: {} };
        map[key].qty     += it.qty;
        map[key].revenue += it.qty * (it.price || 0);
        map[key].orders  += 1;
        if (!map[key].byType[orderTyp]) map[key].byType[orderTyp] = { qty: 0, revenue: 0 };
        map[key].byType[orderTyp].qty     += it.qty;
        map[key].byType[orderTyp].revenue += it.qty * (it.price || 0);
      });
    });
    let rows = Object.values(map);
    if (filterText.trim()) {
      const q = filterText.toLowerCase();
      rows = rows.filter(r => r.name.toLowerCase().includes(q));
    }
    rows.sort((a, b) => {
      if (sortBy === 'revenue') return b.revenue - a.revenue;
      if (sortBy === 'qty')     return b.qty - a.qty;
      if (sortBy === 'avg')     return (b.revenue / b.qty) - (a.revenue / a.qty);
      return a.name.localeCompare(b.name);
    });
    return rows;
  }, [orders, sortBy, filterText, showVariants]);

  const totalRevenue = itemRows.reduce((s, r) => s + r.revenue, 0);
  const totalQty     = itemRows.reduce((s, r) => s + r.qty, 0);

  const SortBtn = ({ id, label }) => (
    <button
      className={`cat-chip ${sortBy === id ? 'active' : ''}`}
      style={{ fontSize: 11 }}
      onClick={() => setSortBy(id)}
    >{label}</button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={filterText}
          onChange={e => setFilter(e.target.value)}
          placeholder="Search items…"
          style={{ padding: '6px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', color: 'var(--text)', fontSize: 13, minWidth: 180 }}
        />
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Sort:</span>
        <SortBtn id="revenue" label="Revenue ↓" />
        <SortBtn id="qty"     label="Qty ↓" />
        <SortBtn id="avg"     label="Avg price ↓" />
        <SortBtn id="name"    label="Name A–Z" />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)', cursor: 'pointer', marginLeft: 8 }}>
          <input type="checkbox" checked={showVariants} onChange={e => setVariants(e.target.checked)} style={{ width: 'auto' }} />
          Show variants
        </label>
        <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => exportItemsCSV(itemRows)}>
          ⬇ CSV
        </button>
      </div>

      {/* Summary row */}
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
          <b style={{ color: 'var(--text)' }}>{itemRows.length}</b> unique items ·
          <b style={{ color: 'var(--text)' }}> {totalQty}</b> units sold ·
          <b style={{ color: 'var(--brand)' }}> {fmtAUD(totalRevenue)}</b> revenue
        </div>
      </div>

      <div className="data-table">
        <div className="row head" style={{ gridTemplateColumns: '30px 1fr 70px 110px 90px 90px 90px' }}>
          <div>#</div>
          <div>Item</div>
          <div>Qty</div>
          <div>Revenue</div>
          <div>Avg price</div>
          <div>% revenue</div>
          <div>Dine / T/A</div>
        </div>
        {itemRows.map((it, i) => {
          const dine    = it.byType['dine-in-pickup'];
          const take    = it.byType['takeaway'];
          const dineQty = dine?.qty || 0;
          const takeQty = take?.qty || 0;
          return (
            <div key={it.name} className="row" style={{ gridTemplateColumns: '30px 1fr 70px 110px 90px 90px 90px' }}>
              <div style={{ color: 'var(--text-3)', fontSize: 11 }}>{i + 1}</div>
              <div>
                <div style={{ fontSize: 14 }}>{it.name}</div>
                {it.variant && <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{it.variant}</div>}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)' }}>×{it.qty}</div>
              <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--brand)', fontWeight: 600 }}>{fmtAUD(it.revenue)}</div>
              <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>{fmtAUD(it.revenue / it.qty)}</div>
              <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>
                <BarInline pct={totalRevenue ? it.revenue / totalRevenue : 0} />
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-3)' }}>
                {dineQty}/{takeQty}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Time tab ─────────────────────────────────────────────────────────────────
function TimeTab({ orders, fromDate, toDate }) {
  const [groupBy, setGroupBy] = useState('hour'); // hour | day | week | dayofweek

  const { rows, maxVal } = useMemo(() => {
    if (groupBy === 'hour') {
      const byHour = Array(24).fill(null).map((_, h) => ({ label: `${String(h).padStart(2,'0')}:00`, gross: 0, count: 0, h }));
      orders.forEach(o => {
        if (!o.paidAt?.toMillis) return;
        const h = new Date(o.paidAt.toMillis()).getHours();
        byHour[h].gross += o.total || 0;
        byHour[h].count += 1;
      });
      // trim leading/trailing zeros
      const first = byHour.findIndex(r => r.count > 0);
      const last  = [...byHour].reverse().findIndex(r => r.count > 0);
      const trimmed = first < 0 ? byHour : byHour.slice(Math.max(0, first - 1), byHour.length - Math.max(0, last - 1));
      return { rows: trimmed, maxVal: Math.max(...trimmed.map(r => r.gross), 1) };
    }
    if (groupBy === 'dayofweek') {
      const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const byDay = DAYS.map(d => ({ label: d, gross: 0, count: 0 }));
      orders.forEach(o => {
        if (!o.paidAt?.toMillis) return;
        const d = new Date(o.paidAt.toMillis()).getDay();
        byDay[d].gross += o.total || 0;
        byDay[d].count += 1;
      });
      return { rows: byDay, maxVal: Math.max(...byDay.map(r => r.gross), 1) };
    }
    if (groupBy === 'day') {
      const map = {};
      orders.forEach(o => {
        if (!o.paidAt?.toMillis) return;
        const d = isoDate(new Date(o.paidAt.toMillis()));
        if (!map[d]) map[d] = { label: d, gross: 0, count: 0 };
        map[d].gross += o.total || 0;
        map[d].count += 1;
      });
      const rows = Object.values(map).sort((a, b) => a.label.localeCompare(b.label));
      return { rows, maxVal: Math.max(...rows.map(r => r.gross), 1) };
    }
    if (groupBy === 'week') {
      const map = {};
      orders.forEach(o => {
        if (!o.paidAt?.toMillis) return;
        const d = new Date(o.paidAt.toMillis());
        const wday = d.getDay();
        const monday = new Date(d); monday.setDate(d.getDate() - ((wday + 6) % 7));
        const key = isoDate(monday);
        if (!map[key]) map[key] = { label: `w/c ${key}`, gross: 0, count: 0 };
        map[key].gross += o.total || 0;
        map[key].count += 1;
      });
      const rows = Object.values(map).sort((a, b) => a.label.localeCompare(b.label));
      return { rows, maxVal: Math.max(...rows.map(r => r.gross), 1) };
    }
    return { rows: [], maxVal: 1 };
  }, [orders, groupBy]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {[
          { id: 'hour',     label: 'By hour'       },
          { id: 'day',      label: 'By day'        },
          { id: 'week',     label: 'By week'       },
          { id: 'dayofweek',label: 'Day of week'   },
        ].map(g => (
          <button
            key={g.id}
            className={`cat-chip ${groupBy === g.id ? 'active' : ''}`}
            onClick={() => setGroupBy(g.id)}
          >{g.label}</button>
        ))}
      </div>

      {/* Horizontal bar chart */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '72px 1fr 110px 60px', gap: 10, alignItems: 'center', fontSize: 13 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)', textAlign: 'right' }}>{r.label}</div>
            <div style={{ height: 22, background: 'var(--surface-2)', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
              <div style={{
                position: 'absolute', left: 0, top: 0, bottom: 0,
                width: `${(r.gross / maxVal) * 100}%`,
                background: r.gross > 0
                  ? `linear-gradient(90deg, var(--brand), var(--brand-2))`
                  : 'transparent',
                borderRadius: 4, transition: 'width 300ms ease'
              }} />
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--brand)', fontWeight: 600, textAlign: 'right' }}>
              {r.gross > 0 ? fmtAUD(r.gross) : <span style={{ color: 'var(--text-3)' }}>—</span>}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>
              {r.count > 0 ? `×${r.count}` : ''}
            </div>
          </div>
        ))}
      </div>

      {/* Tabular data */}
      <div className="section">
        <div className="section-head"><h4>Detail table</h4></div>
        <div className="data-table">
          <div className="row head" style={{ gridTemplateColumns: '1fr 80px 110px 100px 100px' }}>
            <div>Period</div><div>Orders</div><div>Gross</div><div>Avg order</div><div>GST</div>
          </div>
          {rows.filter(r => r.count > 0).map((r, i) => (
            <div key={i} className="row" style={{ gridTemplateColumns: '1fr 80px 110px 100px 100px' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{r.label}</div>
              <div style={{ fontFamily: 'var(--font-mono)' }}>{r.count}</div>
              <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--brand)', fontWeight: 600 }}>{fmtAUD(r.gross)}</div>
              <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>{fmtAUD(r.count ? r.gross / r.count : 0)}</div>
              <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>{fmtAUD(r.gross * 10 / 110)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Orders tab ───────────────────────────────────────────────────────────────
function OrdersTab({ orders, onView }) {
  const [search, setSearch]       = useState('');
  const [sortBy, setSortBy]       = useState('time'); // time | total | items
  const [sortDir, setSortDir]     = useState('desc');
  const [page, setPage]           = useState(0);
  const PAGE = 50;

  const filtered = useMemo(() => {
    let rows = [...orders];
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(o =>
        (o.customer?.name || '').toLowerCase().includes(q) ||
        (o.tableNumber ? `table ${o.tableNumber}` : '').toLowerCase().includes(q) ||
        (o.items || []).some(i => i.name.toLowerCase().includes(q)) ||
        (o.id || '').toLowerCase().includes(q)
      );
    }
    rows.sort((a, b) => {
      let av, bv;
      if (sortBy === 'time')  { av = a.paidAt?.toMillis?.() || 0; bv = b.paidAt?.toMillis?.() || 0; }
      if (sortBy === 'total') { av = a.total || 0; bv = b.total || 0; }
      if (sortBy === 'items') { av = (a.items || []).length; bv = (b.items || []).length; }
      return sortDir === 'desc' ? bv - av : av - bv;
    });
    return rows;
  }, [orders, search, sortBy, sortDir]);

  const pageRows = filtered.slice(page * PAGE, (page + 1) * PAGE);
  const pages    = Math.ceil(filtered.length / PAGE);

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortBy(col); setSortDir('desc'); }
  };

  const ColHead = ({ id, label }) => (
    <div
      onClick={() => toggleSort(id)}
      style={{ cursor: 'pointer', userSelect: 'none',
        color: sortBy === id ? 'var(--brand)' : undefined }}
    >
      {label} {sortBy === id ? (sortDir === 'desc' ? '↓' : '↑') : ''}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          value={search} onChange={e => { setSearch(e.target.value); setPage(0); }}
          placeholder="Search by customer, table, item, order ID…"
          style={{ flex: 1, padding: '6px 12px', background: 'var(--surface-2)',
            border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontSize: 13 }}
        />
        <span style={{ fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
          {filtered.length} of {orders.length}
        </span>
      </div>

      <div className="data-table">
        <div className="row head" style={{ gridTemplateColumns: '140px 80px 1fr 1fr 110px 100px 36px' }}>
          <ColHead id="time"  label="Paid at" />
          <div>Type</div>
          <div>Customer / Table</div>
          <div>Items</div>
          <div>Payment</div>
          <ColHead id="total" label="Total" />
          <div />
        </div>
        {pageRows.map(o => {
          const label = o.tableId
            ? `Table ${o.tableNumber || o.tableId.replace('t','')}`
            : (o.customer?.name || o.customerName || '—');
          return (
            <div key={o.id} className="row" style={{ gridTemplateColumns: '140px 80px 1fr 1fr 110px 100px 36px' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)' }}>
                {fmtDateTime(o.paidAt)}
              </div>
              <div>
                <span style={{
                  fontSize: 11, padding: '2px 7px', borderRadius: 999, fontWeight: 600,
                  background: o.tableId ? 'var(--blue-deep)' : 'var(--amber-deep)',
                  color: o.tableId ? 'var(--blue)' : 'var(--amber)'
                }}>
                  {o.tableId ? 'Dine-in' : typeLabel(o.orderType || 'takeaway')}
                </span>
              </div>
              <div style={{ fontSize: 13 }}>{label}</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                {(o.items || []).slice(0, 2).map(i => i.name).join(', ')}
                {(o.items || []).length > 2 && <span style={{ color: 'var(--text-3)' }}> +{o.items.length - 2}</span>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                {[...new Set((o.payments || []).map(p => p.method))].join(', ') || '—'}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--brand)', fontWeight: 600 }}>
                {fmtAUD(o.total)}
              </div>
              <div>
                <button className="icon-btn" onClick={() => onView(o)}>›</button>
              </div>
            </div>
          );
        })}
      </div>

      {pages > 1 && (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 8 }}>
          <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage(0)}>«</button>
          <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹</button>
          <span style={{ fontSize: 13, color: 'var(--text-2)', padding: '6px 10px' }}>
            Page {page + 1} of {pages}
          </span>
          <button className="btn btn-sm" disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)}>›</button>
          <button className="btn btn-sm" disabled={page >= pages - 1} onClick={() => setPage(pages - 1)}>»</button>
        </div>
      )}
    </div>
  );
}

// ─── Payments tab ─────────────────────────────────────────────────────────────
function PaymentsTab({ orders, stats }) {
  const splits = useMemo(() => {
    // All individual payment rows across orders
    const rows = [];
    orders.forEach(o => {
      (o.payments || []).forEach(p => {
        rows.push({
          method: p.method,
          amount: p.amount,
          paidAt: o.paidAt,
          orderId: o.id,
          orderTotal: o.total,
          customer: o.customer?.name || o.customerName || '',
          label: o.tableId
            ? `Table ${o.tableNumber || ''}`
            : (o.customer?.name || o.customerName || '—')
        });
      });
    });
    rows.sort((a, b) => (b.paidAt?.toMillis?.() || 0) - (a.paidAt?.toMillis?.() || 0));
    return rows;
  }, [orders]);

  const totalPayments = splits.reduce((s, p) => s + p.amount, 0);

  const methodSummary = useMemo(() => {
    const map = {};
    splits.forEach(p => {
      if (!map[p.method]) map[p.method] = { method: p.method, count: 0, total: 0 };
      map[p.method].count++;
      map[p.method].total += p.amount;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [splits]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Method breakdown */}
      <div className="section">
        <div className="section-head"><h4>Payment method breakdown</h4></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {methodSummary.map(m => (
            <div key={m.method} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 80, fontSize: 13, textTransform: 'capitalize', fontWeight: 600 }}>{m.method}</div>
              <div style={{ flex: 1, height: 28, background: 'var(--surface-2)', borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
                <div style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0,
                  width: `${totalPayments ? (m.total / totalPayments) * 100 : 0}%`,
                  background: methodColor(m.method), borderRadius: 6
                }} />
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--brand)', fontWeight: 600, width: 90, textAlign: 'right' }}>
                {fmtAUD(m.total)}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-3)', width: 60, textAlign: 'right' }}>
                {fmtPct(m.total, totalPayments)}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-3)', width: 60, textAlign: 'right' }}>
                ×{m.count}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Individual payment rows */}
      <div className="section">
        <div className="section-head">
          <h4>All payment records ({splits.length})</h4>
        </div>
        <div className="data-table">
          <div className="row head" style={{ gridTemplateColumns: '140px 90px 1fr 110px' }}>
            <div>Time</div><div>Method</div><div>Customer / Table</div><div>Amount</div>
          </div>
          {splits.slice(0, 200).map((p, i) => (
            <div key={i} className="row" style={{ gridTemplateColumns: '140px 90px 1fr 110px' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)' }}>
                {fmtDateTime(p.paidAt)}
              </div>
              <div>
                <span style={{
                  fontSize: 12, padding: '2px 8px', borderRadius: 999, fontWeight: 600,
                  background: methodBg(p.method), color: methodFg(p.method),
                  textTransform: 'capitalize'
                }}>{p.method}</span>
              </div>
              <div style={{ fontSize: 13 }}>{p.label}</div>
              <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--brand)', fontWeight: 600 }}>
                {fmtAUD(p.amount)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Order detail modal ───────────────────────────────────────────────────────
function OrderDetailModal({ order, onClose }) {
  const subtotal = (order.total || 0) - (order.gst || 0);
  const label    = order.tableId
    ? `Table ${order.tableNumber || order.tableId.replace('t','')}`
    : (order.customer?.name || order.customerName || 'Takeaway');

  const [resendEmail, setResendEmail] = useState(order.customer?.email || '');
  const [resendPhone, setResendPhone] = useState(order.customer?.phone || '');
  const [resendStatus, setResendStatus] = useState('idle'); // idle | sending | sent | error
  const [resendMsg,   setResendMsg]   = useState('');

  const handleResend = async () => {
    if (!resendEmail.trim() && !resendPhone.trim()) return;
    setResendStatus('sending');
    setResendMsg('');
    try {
      const { resendReceipt } = await import('../lib/data');
      await resendReceipt(order.id, {
        name:  order.customer?.name || order.customerName || '',
        email: resendEmail.trim(),
        phone: resendPhone.trim()
      });
      setResendStatus('sent');
      setResendMsg(`Receipt queued — will deliver to ${[resendEmail, resendPhone].filter(Boolean).join(' and ')}`);
    } catch (e) {
      setResendStatus('error');
      setResendMsg(e.message || 'Failed to queue receipt');
    }
  };

  const deliveryBadge = order.receiptDelivery ? (
    <span style={{
      fontSize: 12, padding: '3px 10px', borderRadius: 999,
      background: order.receiptDelivery.status === 'delivered' ? 'var(--green-deep)' : 'var(--amber-deep)',
      color:      order.receiptDelivery.status === 'delivered' ? 'var(--green)' : 'var(--amber)'
    }}>
      {order.receiptDelivery.status === 'delivered'
        ? `✅ Receipt sent via ${[order.receiptDelivery.email === 'sent' && '📧', order.receiptDelivery.sms === 'sent' && '💬'].filter(Boolean).join(' ')}`
        : `Receipt: ${order.receiptDelivery.status}`}
    </span>
  ) : null;

  return (
    <Modal title={`${label} · ${fmtDateTime(order.paidAt)}`} onClose={onClose}>
      {/* Status badges */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 999, background: 'var(--surface-2)', color: 'var(--text-2)' }}>
          {order.tableId ? 'Dine-in' : typeLabel(order.orderType || 'takeaway')}
        </span>
        {order.customer?.email && (
          <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 999, background: 'var(--blue-deep)', color: 'var(--blue)' }}>
            📧 {order.customer.email}
          </span>
        )}
        {order.customer?.phone && (
          <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 999, background: 'var(--blue-deep)', color: 'var(--blue)' }}>
            💬 {order.customer.phone}
          </span>
        )}
        {deliveryBadge}
      </div>

      {/* Items */}
      <div className="data-table" style={{ marginBottom: 16 }}>
        <div className="row head" style={{ gridTemplateColumns: '40px 1fr 80px 80px' }}>
          <div>Qty</div><div>Item</div><div>Unit</div><div>Total</div>
        </div>
        {(order.items || []).map((it, i) => (
          <div key={i} className="row" style={{ gridTemplateColumns: '40px 1fr 80px 80px' }}>
            <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--brand)', fontWeight: 600 }}>×{it.qty}</div>
            <div>
              <div>{it.name}</div>
              {it.selections?.length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  {it.selections.map(s => s.label).join(' · ')}
                </div>
              )}
              {it.notes && <div style={{ fontSize: 11, color: 'var(--text-3)', fontStyle: 'italic' }}>{it.notes}</div>}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>{fmtAUD(it.price)}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fmtAUD(it.price * it.qty)}</div>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-2)' }}>
          <span>Subtotal (ex GST)</span><span>{fmtAUD(subtotal)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-2)' }}>
          <span>GST (10%)</span><span>{fmtAUD(order.gst)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, paddingTop: 8,
          borderTop: '1px dashed var(--border-strong)', fontSize: 20, color: 'var(--text)', fontWeight: 700 }}>
          <span>Total</span><span style={{ color: 'var(--brand)' }}>{fmtAUD(order.total)}</span>
        </div>
      </div>

      {/* Payments */}
      {order.payments?.length > 0 && (
        <div style={{ paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)', marginBottom: 8 }}>Payments</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {order.payments.map((p, i) => (
              <span key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--surface-2)', border: '1px solid var(--border)', padding: '3px 10px', borderRadius: 999, textTransform: 'capitalize' }}>
                {p.method} {fmtAUD(p.amount)}{p.last4 ? ` ····${p.last4}` : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Resend receipt ── */}
      <div style={{ marginTop: 16, background: 'var(--bg-2)', borderRadius: 'var(--radius)', padding: '16px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          📨 Send / Resend receipt
          <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-3)' }}>— edit contact if needed</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: 11 }}>📧 Email</label>
            <input
              type="email"
              value={resendEmail}
              onChange={e => setResendEmail(e.target.value)}
              placeholder="customer@email.com"
              style={{ fontSize: 13 }}
              disabled={resendStatus === 'sending'}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: 11 }}>💬 Mobile</label>
            <input
              type="tel"
              value={resendPhone}
              onChange={e => setResendPhone(e.target.value)}
              placeholder="04xx xxx xxx"
              style={{ fontSize: 13, fontFamily: 'var(--font-mono)' }}
              disabled={resendStatus === 'sending'}
            />
          </div>
        </div>
        {resendMsg && (
          <div style={{
            fontSize: 12, marginBottom: 10, padding: '7px 12px', borderRadius: 6,
            background: resendStatus === 'sent' ? 'var(--green-deep)' : 'var(--red-deep)',
            color:      resendStatus === 'sent' ? 'var(--green)' : 'var(--red)',
            border: `1px solid ${resendStatus === 'sent' ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.2)'}`
          }}>
            {resendStatus === 'sent' ? '✅ ' : '❌ '}{resendMsg}
          </div>
        )}
        <button
          className="btn btn-primary btn-sm"
          style={{ width: '100%' }}
          disabled={(!resendEmail.trim() && !resendPhone.trim()) || resendStatus === 'sending'}
          onClick={handleResend}
        >
          {resendStatus === 'sending' ? '⏳ Sending…' : resendStatus === 'sent' ? '✅ Sent — send again?' : '📨 Send receipt'}
        </button>
      </div>
    </Modal>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function StatCard({ label, value, highlight }) {
  return (
    <div className="stat-card">
      <div className="label">{label}</div>
      <div className="value" style={highlight ? { color: 'var(--brand)' } : {}}>{value}</div>
    </div>
  );
}

function BarInline({ pct }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--surface-3)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct * 100}%`, height: '100%', background: 'var(--brand)', borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-3)', minWidth: 36 }}>
        {(pct * 100).toFixed(1)}%
      </span>
    </div>
  );
}

function typeLabel(t) {
  if (t === 'dine-in-pickup') return 'Dine-in';
  if (t === 'takeaway')       return 'Takeaway';
  if (t === 'quick')          return 'Quick';
  return t || '—';
}

function methodColor(m) {
  if (m === 'cash')   return 'var(--green)';
  if (m === 'card')   return 'var(--blue)';
  if (m === 'eftpos') return 'var(--violet)';
  if (m === 'voucher')return 'var(--amber)';
  return 'var(--brand)';
}
function methodBg(m) {
  if (m === 'cash')   return 'var(--green-deep)';
  if (m === 'card')   return 'var(--blue-deep)';
  if (m === 'eftpos') return 'rgba(124,58,237,0.12)';
  if (m === 'voucher')return 'var(--amber-deep)';
  return 'var(--brand-deep)';
}
function methodFg(m) {
  if (m === 'cash')   return 'var(--green)';
  if (m === 'card')   return 'var(--blue)';
  if (m === 'eftpos') return 'var(--violet)';
  if (m === 'voucher')return 'var(--amber)';
  return 'var(--brand)';
}

function computeStats(orders) {
  const gross      = orders.reduce((s, o) => s + (o.total || 0), 0);
  const gst        = orders.reduce((s, o) => s + (o.gst   || 0), 0);
  const net        = gross - gst;
  const count      = orders.length;
  const avg        = count ? gross / count : 0;
  const itemsCount = orders.reduce((s, o) => s + (o.items || []).reduce((n, i) => n + i.qty, 0), 0);

  // Hour aggregation
  const byHour  = Array(24).fill(0);
  orders.forEach(o => {
    if (!o.paidAt?.toMillis) return;
    byHour[new Date(o.paidAt.toMillis()).getHours()] += o.total || 0;
  });
  const maxHour      = Math.max(...byHour, 0);
  const busiestHour  = maxHour > 0 ? byHour.indexOf(maxHour) : null;

  // By order type
  const byType = {};
  orders.forEach(o => {
    const t = orderTypeLabel(o);
    if (!byType[t]) byType[t] = { count: 0, gross: 0, gst: 0 };
    byType[t].count++;
    byType[t].gross += o.total || 0;
    byType[t].gst   += o.gst   || 0;
  });

  // By payment method
  const byPayment = {};
  orders.forEach(o => {
    (o.payments || []).forEach(p => {
      if (!byPayment[p.method]) byPayment[p.method] = { count: 0, amount: 0 };
      byPayment[p.method].count++;
      byPayment[p.method].amount += p.amount;
    });
  });

  // Top items
  const itemAgg = {};
  orders.forEach(o => (o.items || []).forEach(it => {
    const k = it.name;
    if (!itemAgg[k]) itemAgg[k] = { name: k, qty: 0, revenue: 0 };
    itemAgg[k].qty     += it.qty;
    itemAgg[k].revenue += it.qty * (it.price || 0);
  }));
  const topItems    = Object.values(itemAgg).sort((a, b) => b.revenue - a.revenue);
  const uniqueItems = topItems.length;

  return { gross, net, gst, count, avg, itemsCount, uniqueItems,
    byHour, maxHour, busiestHour, byType, byPayment, topItems };
}

// ─── CSV export ───────────────────────────────────────────────────────────────
function exportCSV(orders, from, to) {
  const rows = [
    ['Order ID','Paid At','Type','Customer','Table','Items','Subtotal (ex GST)','GST','Total','Payments']
  ];
  orders.forEach(o => {
    rows.push([
      o.id,
      fmtDateTime(o.paidAt),
      o.tableId ? 'dine-in' : (o.orderType || 'takeaway'),
      o.customer?.name || o.customerName || '',
      o.tableNumber || '',
      (o.items || []).map(i => `${i.qty}x ${i.name}`).join('; '),
      ((o.total || 0) - (o.gst || 0)).toFixed(2),
      (o.gst || 0).toFixed(2),
      (o.total || 0).toFixed(2),
      (o.payments || []).map(p => `${p.method} $${p.amount.toFixed(2)}`).join('; ')
    ]);
  });
  downloadCSV(rows, `sns-sales-${from}-to-${to}.csv`);
}

function exportItemsCSV(items) {
  const rows = [['Item','Qty Sold','Revenue','Avg Price','Dine-in Qty','Takeaway Qty']];
  items.forEach(it => {
    rows.push([
      it.name,
      it.qty,
      it.revenue.toFixed(2),
      (it.revenue / it.qty).toFixed(2),
      it.byType?.['dine-in-pickup']?.qty || 0,
      it.byType?.['takeaway']?.qty || 0
    ]);
  });
  downloadCSV(rows, `sns-items-${isoDate(new Date())}.csv`);
}

function downloadCSV(rows, filename) {
  const csv = rows.map(r =>
    r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')
  ).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
