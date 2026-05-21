import { useEffect, useState, useMemo } from 'react';
import { db } from '../lib/firebase';
import { collection, onSnapshot, query, where, Timestamp } from 'firebase/firestore';
import { useDevice } from '../context/DeviceContext';

export default function EftposReconPanel() {
  const { device } = useDevice();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  // Subscribe to paid orders for the selected day
  useEffect(() => {
    if (!device?.venueId) return;
    setLoading(true);
    const start = new Date(date + 'T00:00:00');
    const end = new Date(date + 'T23:59:59');
    const q = query(
      collection(db, 'venues', device.venueId, 'orders'),
      where('paidAt', '>=', Timestamp.fromDate(start)),
      where('paidAt', '<=', Timestamp.fromDate(end))
    );
    const unsub = onSnapshot(q, snap => {
      setOrders(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [device?.venueId, date]);

  // Flatten payments — one row per EFTPOS transaction
  const eftposTxns = useMemo(() => {
    const rows = [];
    orders.forEach(o => {
      (o.payments || []).forEach((p, i) => {
        if (p.method !== 'eftpos') return;
        rows.push({
          orderId: o.id,
          orderCode: (o.id || '').slice(-4).toUpperCase(),
          tableLabel: o.tableId
            ? `Table ${o.tableNumber || o.tableId.replace('t', '')}`
            : (o.customerName || 'Takeaway'),
          amount: p.amount,
          authCode: p.authCode || '',
          last4: p.last4 || '',
          seat: p.seat,
          ts: p.ts || o.paidAt?.toMillis?.() || 0
        });
      });
    });
    return rows.sort((a, b) => a.ts - b.ts);
  }, [orders]);

  // Other payment method totals (cash, card, voucher) for full picture
  const breakdown = useMemo(() => {
    const b = { cash: 0, card: 0, eftpos: 0, voucher: 0 };
    orders.forEach(o => {
      (o.payments || []).forEach(p => {
        if (b[p.method] !== undefined) b[p.method] += p.amount;
      });
    });
    return b;
  }, [orders]);

  const eftposTotal = breakdown.eftpos;
  const eftposCount = eftposTxns.length;

  // Export to CSV
  const exportCsv = () => {
    const header = 'Time,Table/Customer,Order #,Amount,Auth Code,Last 4\n';
    const rows = eftposTxns.map(t => {
      const time = new Date(t.ts).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
      return `${time},"${t.tableLabel}",${t.orderCode},${t.amount.toFixed(2)},${t.authCode},${t.last4}`;
    }).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eftpos-${device.venueId}-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const setToday    = () => setDate(new Date().toISOString().slice(0, 10));
  const setYesterday = () => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    setDate(d.toISOString().slice(0, 10));
  };

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 32 }}>
        EFTPOS <span style={{ color: 'var(--brand)' }}>Reconciliation</span>
      </h1>
      <p className="subtitle" style={{ marginBottom: 20 }}>
        Match these transactions against your Tyro settlement report for the day.
        Use the auth code and last-4 to identify each charge.
      </p>

      {/* Date picker */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        marginBottom: 24, padding: '14px 16px',
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)'
      }}>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          style={{ maxWidth: 180, fontSize: 14 }}
        />
        <button className="btn btn-sm" onClick={setToday}>Today</button>
        <button className="btn btn-sm" onClick={setYesterday}>Yesterday</button>
        <div style={{ flex: 1 }} />
        {eftposCount > 0 && (
          <button className="btn btn-sm" onClick={exportCsv}>📥 Export CSV</button>
        )}
      </div>

      {/* Summary tiles */}
      <div className="recon-summary">
        <div className="recon-card recon-card--primary">
          <div className="label">EFTPOS — {date}</div>
          <div className="value">${eftposTotal.toFixed(2)}</div>
          <div className="sub">{eftposCount} transaction{eftposCount === 1 ? '' : 's'}</div>
        </div>
        <div className="recon-card">
          <div className="label">Cash</div>
          <div className="value" style={{ color: 'var(--green)' }}>${breakdown.cash.toFixed(2)}</div>
        </div>
        <div className="recon-card">
          <div className="label">Card (other)</div>
          <div className="value">${breakdown.card.toFixed(2)}</div>
        </div>
        <div className="recon-card">
          <div className="label">Vouchers</div>
          <div className="value" style={{ color: 'var(--amber)' }}>${breakdown.voucher.toFixed(2)}</div>
        </div>
      </div>

      {/* Transaction table */}
      <div className="section">
        <div className="section-head">
          <h4>EFTPOS transactions — {date}</h4>
          {loading && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Loading…</span>}
        </div>

        {eftposTxns.length === 0 ? (
          <div className="empty">
            <p>No EFTPOS transactions on this date.</p>
            <p style={{ fontSize: 12, marginTop: 6 }}>
              Pick a different day or check the cash/voucher totals above.
            </p>
          </div>
        ) : (
          <div className="recon-table">
            <div className="recon-row recon-row--head">
              <div>Time</div>
              <div>Order</div>
              <div>Table / Customer</div>
              <div style={{ textAlign: 'right' }}>Amount</div>
              <div>Auth code</div>
              <div>Last 4</div>
            </div>
            {eftposTxns.map((t, i) => (
              <div key={i} className="recon-row">
                <div className="mono">
                  {new Date(t.ts).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false })}
                </div>
                <div className="mono" style={{ color: 'var(--text-3)' }}>#{t.orderCode}</div>
                <div>
                  {t.tableLabel}
                  {t.seat !== undefined && t.seat !== null && (
                    <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 6 }}>· P{t.seat + 1}</span>
                  )}
                </div>
                <div className="mono" style={{ textAlign: 'right', color: 'var(--brand)', fontWeight: 600 }}>
                  ${t.amount.toFixed(2)}
                </div>
                <div className="mono" style={{ color: t.authCode ? 'var(--text-2)' : 'var(--text-3)' }}>
                  {t.authCode || '—'}
                </div>
                <div className="mono" style={{ color: t.last4 ? 'var(--text-2)' : 'var(--text-3)' }}>
                  {t.last4 ? `···${t.last4}` : '—'}
                </div>
              </div>
            ))}
            <div className="recon-row recon-row--foot">
              <div></div>
              <div></div>
              <div style={{ fontWeight: 600 }}>Total</div>
              <div className="mono" style={{ textAlign: 'right', color: 'var(--brand)', fontSize: 18, fontWeight: 700 }}>
                ${eftposTotal.toFixed(2)}
              </div>
              <div></div>
              <div></div>
            </div>
          </div>
        )}
      </div>

      <div style={{
        marginTop: 20, padding: 14,
        background: 'var(--surface-2)', borderRadius: 8,
        fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6
      }}>
        <b style={{ color: 'var(--text-2)' }}>How to reconcile:</b> open your Tyro Merchant Portal,
        print the settlement report for {date}, and tick off each line against this table.
        Differences usually mean a missed auth-code entry, a void that wasn't recorded, or a tip adjustment on the Tyro terminal.
      </div>
    </div>
  );
}
