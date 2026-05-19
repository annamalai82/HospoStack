import { useEffect, useMemo, useState } from 'react';
import {
  watchTables, watchOpenOrders, updateTableStatus,
  createOrder, sendOrderToKitchen, settleOrder,
  upsertCustomer, queueReceiptDelivery, previewVoucherRedemption,
  watchVenue, updateOrder
} from '../lib/data';
import { useDevice } from '../context/DeviceContext';
import OrderPane from '../components/OrderPane';

/**
 * Till POS flow (two-step):
 *
 *   1. Build cart → tap "Send to Kitchen" → order created with status='sent',
 *      KDS lights up, table card flips. Order shows in "open tabs" pane.
 *   2. Later, tap the open tab → "Take Payment" → capture customer name/email/phone
 *      → settle → queue receipt delivery (handled by Cloud Function).
 *
 * The right-hand sidebar shows all currently-open orders (sent or in-kitchen),
 * so the cashier sees what's waiting to be paid at a glance.
 */
export default function TillMode() {
  const { device } = useDevice();
  const [orderType, setOrderType] = useState('takeaway');
  const [tables, setTables] = useState([]);
  const [orders, setOrders] = useState([]);
  const [activeOrderId, setActiveOrderId] = useState(null);
  const [cart, setCart] = useState([]);
  const [showPay, setShowPay] = useState(false);
  const [toast, setToast] = useState(null);
  const [venue, setVenue] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => watchTables(setTables), []);
  useEffect(() => watchOpenOrders(setOrders), []);
  useEffect(() => watchVenue(setVenue), []);
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const alertMins = venue?.kdsAlertMins ?? 20;

  const showToast = (msg, kind = 'success') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2400);
  };

  // Open tabs visible in the sidebar — everything not yet paid, sorted by recency
  const openTabs = useMemo(
    () => orders
      .filter(o => o.status !== 'paid' && o.status !== 'voided')
      .sort((a, b) => (b.sentAt?.toMillis?.() || b.openedAt?.toMillis?.() || 0)
                    - (a.sentAt?.toMillis?.() || a.openedAt?.toMillis?.() || 0)),
    [orders]
  );

  const activeOrder = activeOrderId ? orders.find(o => o.id === activeOrderId) : null;

  // ── Cart ops ─────────────────────────────────────────────────────────
  const addToCart = (item) => {
    setCart(c => {
      const found = c.findIndex(l => l.itemId === item.id);
      if (found >= 0) {
        const next = [...c]; next[found] = { ...next[found], qty: next[found].qty + 1 }; return next;
      }
      return [...c, {
        itemId: item.id, name: item.name, qty: 1,
        price: item.price, station: item.station, course: item.course,
        notes: '', status: 'pending'
      }];
    });
  };
  const setQty = (i, q) => setCart(c => c.map((l, j) => j === i ? { ...l, qty: q } : l));
  const removeLine = (i) => setCart(c => c.filter((_, j) => j !== i));
  const addLine = (line) => setCart(c => [...c, line]);

  // ── Modify already-sent items directly on the active order ───────────
  const modifySentItem = async (sentIndex, newQty) => {
    if (!activeOrder) return;
    const items = [...(activeOrder.items || [])];
    if (sentIndex < 0 || sentIndex >= items.length) return;
    items[sentIndex] = { ...items[sentIndex], qty: newQty };
    const totals = calcTotals(items);
    await updateOrder(activeOrder.id, { items, ...totals });
  };

  const removeSentItem = async (sentIndex) => {
    if (!activeOrder) return;
    const items = (activeOrder.items || []).filter((_, i) => i !== sentIndex);
    if (items.length === 0) {
      await updateOrder(activeOrder.id, { status: 'voided', items: [] });
      setActiveOrderId(null);
      showToast('Order removed');
      return;
    }
    const totals = calcTotals(items);
    await updateOrder(activeOrder.id, { items, ...totals });
  };

  // ── Send to Kitchen (step 1) ────────────────────────────────────────
  const handleSendToKitchen = async () => {
    if (cart.length === 0) return;

    // If a tab is active, append to it. Otherwise create a new tab.
    const sentCart = cart.map(l => ({ ...l, status: 'sent' }));

    if (activeOrder) {
      const items = [...(activeOrder.items || []), ...sentCart];
      const totals = calcTotals(items);
      await sendOrderToKitchen(activeOrder.id, items, totals);
      showToast(`+${cart.length} item${cart.length === 1 ? '' : 's'} sent to kitchen`);
    } else {
      const totals = calcTotals(sentCart);
      const orderId = await createOrder({
        tableId: null,
        orderType,
        openedBy: device.user.id,
        items: []
      });
      await sendOrderToKitchen(orderId, sentCart, totals);
      setActiveOrderId(orderId);
      showToast(`Sent to kitchen · order opened`);
    }
    setCart([]);
  };

  // ── Take Payment (step 2) ───────────────────────────────────────────
  const handleTakePayment = (order) => {
    setActiveOrderId(order.id);
    setCart([]);
    setShowPay(true);
  };

  // ── Settle existing dine-in (from Floor) ─────────────────────────────
  const handleSettleFromFloor = (order) => {
    setActiveOrderId(order.id);
    setCart([]);
    setShowPay(true);
  };

  const cancelActive = () => {
    setCart([]);
    setActiveOrderId(null);
  };

  const handlePaid = async (payments, customer) => {
    if (!activeOrder) return;

    const total = activeOrder.total || 0;

    // 1. Persist customer (if provided) so we can market to them later
    if (customer?.email || customer?.phone) {
      try {
        await upsertCustomer(customer);
      } catch (e) {
        // non-fatal
        console.warn('Customer upsert failed', e);
      }
    }

    // 2. Settle the order, attaching customer + payments
    await settleOrder(activeOrder.id, payments, total, customer || null);

    // 3. Queue receipt delivery if customer gave contact details
    if (customer && (customer.email || customer.phone)) {
      try {
        await queueReceiptDelivery(activeOrder.id, customer);
      } catch (e) {
        console.warn('Receipt queue failed', e);
      }
    }

    // 4. Free dine-in table if linked
    if (activeOrder.tableId) {
      await updateTableStatus(activeOrder.tableId, 'free');
    }

    setCart([]);
    setActiveOrderId(null);
    setShowPay(false);

    // The receipt delivery doc is queued in Firestore so a Cloud Function
    // can pick it up later. Without that function deployed, nothing actually
    // sends — but the customer is captured in the marketing DB and we leave
    // an honest message instead of promising a receipt that won't arrive.
    if (customer && (customer.email || customer.phone)) {
      showToast(`Paid $${total.toFixed(2)} · Customer details saved`);
    } else {
      showToast(`Paid $${total.toFixed(2)}`);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────
  const sentItems = activeOrder?.items || [];
  const headerContent = (
    <div className="cart-head">
      <div className="tbl">
        {activeOrder
          ? activeOrder.tableId
            ? <>Table <b>{activeOrder.tableNumber || activeOrder.tableId?.replace('t','')}</b></>
            : <>Tab <b style={{ fontSize: 14, fontFamily: 'var(--font-mono)' }}>#{activeOrder.id.slice(-4).toUpperCase()}</b></>
          : <>{orderType === 'takeaway' ? 'New Takeaway' : 'Counter / Dine-in'}</>
        }
      </div>
      <div>
        {!activeOrder ? (
          <select
            value={orderType}
            onChange={e => setOrderType(e.target.value)}
            style={{ padding: '6px 10px', fontSize: 12 }}
          >
            <option value="takeaway">Takeaway</option>
            <option value="dine-in-pickup">Counter / Dine-in</option>
          </select>
        ) : (
          <button className="btn-ghost" onClick={cancelActive}>← Back</button>
        )}
      </div>
    </div>
  );

  const footerContent = activeOrder ? (
    <div className="cart-actions">
      {cart.length > 0 ? (
        <>
          <button className="btn" onClick={() => setCart([])}>Clear new</button>
          <button className="btn btn-primary" onClick={handleSendToKitchen}>
            Send +{cart.length} to Kitchen
          </button>
        </>
      ) : (
        <button className="btn btn-success btn-lg btn-block" onClick={() => setShowPay(true)} style={{ gridColumn: '1 / -1' }}>
          Take Payment · ${(activeOrder.total || 0).toFixed(2)}
        </button>
      )}
    </div>
  ) : (
    <div className="cart-actions">
      <button className="btn" onClick={() => setCart([])} disabled={!cart.length}>Clear</button>
      <button className="btn btn-primary" onClick={handleSendToKitchen} disabled={!cart.length}>
        Send to Kitchen
      </button>
    </div>
  );

  return (
    <div className="till">
      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}

      <div className="till-layout">
        <OrderPane
          cartItems={cart}
          sentItems={sentItems}
          onAdd={addToCart}
          onAddLine={addLine}
          onQtyChange={setQty}
          onRemove={removeLine}
          onModifySent={modifySentItem}
          onRemoveSent={removeSentItem}
          header={headerContent}
          footer={footerContent}
        />

        <OpenTabsPane
          tabs={openTabs}
          tables={tables}
          activeId={activeOrderId}
          alertMins={alertMins}
          onSelect={(o) => { setActiveOrderId(o.id); setCart([]); }}
          onPay={(o) => handleTakePayment(o)}
        />
      </div>

      {showPay && activeOrder && (
        <PayScreen
          order={activeOrder}
          onCancel={() => setShowPay(false)}
          onComplete={handlePaid}
        />
      )}
    </div>
  );
}

// ── Open tabs sidebar ────────────────────────────────────────────────────
function OpenTabsPane({ tabs, tables, activeId, alertMins = 20, onSelect, onPay }) {
  if (tabs.length === 0) {
    return (
      <aside className="tabs-pane tabs-pane--empty">
        <div className="panel-head"><span className="panel-title">Open Tabs</span></div>
        <div className="tabs-empty-msg">No open tabs yet</div>
      </aside>
    );
  }

  return (
    <aside className="tabs-pane">
      <div className="panel-head">
        <span className="panel-title">Open Tabs · {tabs.length}</span>
      </div>
      <div className="tabs-list">
        {tabs.map(o => {
          const tbl = tables.find(t => t.id === o.tableId);
          const billing = tbl?.status === 'billing';
          const ready = o.status === 'ready';
          const waitMins = o.sentAt ? Math.floor((Date.now() - o.sentAt.toMillis()) / 60000) : null;
          const isOverdue = waitMins !== null && waitMins >= alertMins;
          const isWarn    = waitMins !== null && waitMins >= alertMins * 0.6 && !isOverdue;
          return (
            <div
              key={o.id}
              className={`tab-item ${activeId === o.id ? 'active' : ''} ${billing ? 'billing' : ''} ${ready ? 'ready' : ''} ${isOverdue ? 'tab-overdue' : isWarn ? 'tab-warn' : ''}`}
            >
              <button className="tab-main" onClick={() => onSelect(o)}>
                <div className="tab-head">
                  <span className="tab-label">
                    {o.tableId ? `T${o.tableNumber || o.tableId.replace('t','')}` : `#${o.id.slice(-4).toUpperCase()}`}
                  </span>
                  <span className="tab-status">{statusLabel(o)}</span>
                </div>
                <div className="tab-meta">
                  <span>{(o.items || []).length} items</span>
                  <span className="tab-total">${(o.total || 0).toFixed(2)}</span>
                </div>
                {/* Wait time */}
                {waitMins !== null && (
                  <div className={`tab-wait ${isOverdue ? 'overdue' : isWarn ? 'warn' : ''}`}>
                    ⏱ {waitMins}m waiting
                  </div>
                )}
              </button>
              <button className="tab-pay" onClick={() => onPay(o)} title="Take payment">
                💳
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function statusLabel(o) {
  if (o.status === 'sent') return 'sent';
  if (o.status === 'preparing') return 'cooking';
  if (o.status === 'ready') return 'ready';
  if (o.status === 'served') return 'served';
  return o.status;
}

// ── Payment screen ───────────────────────────────────────────────────────
function PayScreen({ order, onCancel, onComplete }) {
  const total = order.total || 0;
  const [payments, setPayments] = useState(order.payments || []);
  const [amount, setAmount] = useState('');
  const [stage, setStage] = useState('payment'); // 'payment' | 'customer'
  const [customer, setCustomer] = useState({
    name: order.customer?.name || '',
    email: order.customer?.email || '',
    phone: order.customer?.phone || ''
  });

  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const balance = +(total - paid).toFixed(2);
  const change = paid > total ? +(paid - total).toFixed(2) : 0;

  const [showVoucher, setShowVoucher] = useState(false);

  const pressKey = (k) => {
    if (k === 'C') return setAmount('');
    if (k === '.') return setAmount(a => a.includes('.') ? a : (a || '0') + '.');
    if (k === '⌫') return setAmount(a => a.slice(0, -1));
    setAmount(a => a + k);
  };
  const setQuick = (v) => setAmount(String(v));
  const numeric = parseFloat(amount) || balance;

  const handleMethod = (method) => {
    if (method === 'voucher') {
      setShowVoucher(true);
      return;
    }
    const amt = method === 'cash' ? (parseFloat(amount) || balance) : balance;
    if (amt <= 0) return;
    const next = [...payments, { method, amount: +Math.min(amt, balance + 1000).toFixed(2), ts: Date.now() }];
    setPayments(next);
    setAmount('');
  };

  const handleVoucherApplied = ({ code, applied }) => {
    setPayments([...payments, { method: 'voucher', amount: applied, code, ts: Date.now() }]);
    setShowVoucher(false);
  };

  const handleComplete = () => {
    if (balance > 0.005) return;
    // Move to receipt-delivery stage
    setStage('customer');
  };

  const handleFinalise = () => {
    onComplete(payments, customer);
  };

  const handleSkip = () => {
    onComplete(payments, null);
  };

  if (stage === 'customer') {
    return <CustomerCaptureScreen
      total={total}
      change={change}
      payments={payments}
      customer={customer}
      onChange={setCustomer}
      onBack={() => setStage('payment')}
      onSend={handleFinalise}
      onSkip={handleSkip}
    />;
  }

  return (
    <div className="pay-screen">
      <div className="pay-card">
        <div className="pay-head">
          <h2>Payment</h2>
          <div className="total">${total.toFixed(2)}</div>
        </div>
        <div className="pay-body">
          <div>
            <div className="pay-amount" style={{ marginBottom: 12 }}>
              <div className="label">Amount</div>
              <div className="val">${(numeric || 0).toFixed(2)}</div>
            </div>
            <div className="pay-keypad">
              {['1','2','3','4','5','6','7','8','9','.','0','⌫'].map(k => (
                <button key={k} onClick={() => pressKey(k)}>{k}</button>
              ))}
            </div>
            <button className="btn btn-block" style={{ marginTop: 8 }} onClick={() => pressKey('C')}>Clear</button>
          </div>
          <div className="pay-right">
            <div className="pay-amount">
              <div className="label">Balance due</div>
              <div className="val" style={{ color: balance <= 0.005 ? 'var(--green)' : 'var(--brand)' }}>
                ${balance.toFixed(2)}
              </div>
            </div>
            <div className="pay-quick">
              {[5, 10, 20, 50, 100, 200].map(q => (
                <button key={q} onClick={() => setQuick(q)}>${q}</button>
              ))}
              <button onClick={() => setQuick(balance.toFixed(2))}>Exact</button>
              <button onClick={() => setQuick((Math.ceil(balance / 10) * 10).toFixed(2))}>Round ↑</button>
            </div>
            <div className="pay-methods">
              <button className="pay-method" onClick={() => handleMethod('cash')}>
                <span className="icon">💵</span>
                <span className="label">Cash</span>
                <span className="hint">Enter tendered amount</span>
              </button>
              <button className="pay-method" onClick={() => handleMethod('card')}>
                <span className="icon">💳</span>
                <span className="label">Card</span>
                <span className="hint">Tap, insert or swipe</span>
              </button>
              <button className="pay-method" onClick={() => handleMethod('eftpos')}>
                <span className="icon">🏦</span>
                <span className="label">EFTPOS</span>
                <span className="hint">Bank transfer terminal</span>
              </button>
              <button className="pay-method" onClick={() => handleMethod('voucher')}>
                <span className="icon">🎟</span>
                <span className="label">Voucher</span>
                <span className="hint">Apply gift / promo</span>
              </button>
            </div>
          </div>
        </div>
        <div className="pay-foot">
          <div className="payments-list">
            {payments.length === 0 && <span style={{ color: 'var(--text-3)', fontSize: 12 }}>No payments yet</span>}
            {payments.map((p, i) => (
              <span key={i} className="payment-chip">
                {p.method === 'voucher' && p.code ? `🎟 ${p.code}` : p.method} ${p.amount.toFixed(2)}
              </span>
            ))}
            {change > 0 && (
              <span className="payment-chip" style={{ background: 'var(--amber-deep)', color: 'var(--amber)', borderColor: 'rgba(251,191,36,0.3)' }}>
                Change ${change.toFixed(2)}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn-ghost" onClick={onCancel}>Cancel</button>
            <button
              className="btn btn-success"
              disabled={balance > 0.005}
              style={{ opacity: balance > 0.005 ? 0.4 : 1 }}
              onClick={handleComplete}
            >Next: Customer →</button>
          </div>
        </div>
      </div>

      {showVoucher && (
        <VoucherRedeemDialog
          balance={balance}
          orderTotal={total}
          onCancel={() => setShowVoucher(false)}
          onApplied={handleVoucherApplied}
        />
      )}
    </div>
  );
}

// ── Voucher redeem dialog ────────────────────────────────────────────────
function VoucherRedeemDialog({ balance, orderTotal, onCancel, onApplied }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState(null);

  const apply = async () => {
    setErr('');
    setBusy(true);
    try {
      const result = await previewVoucherRedemption(code, balance, orderTotal);
      onApplied({ code: result.code, applied: result.applied });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 440 }}>
        <div className="modal-head">
          <h3>Redeem voucher</h3>
          <button className="icon-btn" onClick={onCancel}>×</button>
        </div>
        <div className="modal-body">
          <div style={{
            background: 'var(--bg-2)', padding: 14, borderRadius: 8,
            marginBottom: 14, display: 'flex', justifyContent: 'space-between',
            fontFamily: 'var(--font-mono)', fontSize: 13
          }}>
            <span style={{ color: 'var(--text-3)' }}>Balance owing</span>
            <span style={{ color: 'var(--brand)', fontWeight: 600 }}>${balance.toFixed(2)}</span>
          </div>

          <div className="field">
            <label>Voucher code</label>
            <input
              autoFocus
              value={code}
              onChange={e => { setCode(e.target.value.toUpperCase()); setErr(''); setPreview(null); }}
              placeholder="e.g. SAMBAR50"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 18,
                letterSpacing: '0.08em',
                textAlign: 'center',
                padding: '14px 16px'
              }}
              onKeyDown={e => e.key === 'Enter' && apply()}
            />
          </div>

          {err && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{err}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={busy || !code.trim()}
            onClick={apply}
            style={{ opacity: !code.trim() ? 0.4 : 1 }}
          >
            {busy ? 'Checking…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Customer capture screen ──────────────────────────────────────────────
function CustomerCaptureScreen({ total, change, customer, onChange, onBack, onSend, onSkip }) {
  const hasContact = customer.email.trim() || customer.phone.trim();

  return (
    <div className="pay-screen">
      <div className="pay-card">
        <div className="pay-head">
          <h2>Customer details</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {change > 0 && (
              <span style={{ background: 'var(--amber-deep)', color: 'var(--amber)', padding: '6px 14px', borderRadius: 999, fontFamily: 'var(--font-mono)', fontSize: 13 }}>
                Change ${change.toFixed(2)}
              </span>
            )}
            <div className="total" style={{ color: 'var(--green)' }}>✓ Paid</div>
          </div>
        </div>

        <div className="pay-body" style={{ gridTemplateColumns: '1fr', padding: '28px 32px' }}>
          <div style={{ textAlign: 'center', color: 'var(--text-2)', fontSize: 14, marginBottom: 22 }}>
            Capture the customer's details for marketing and future receipts.<br />
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
              Saved to the customer database with marketing opt-in by default.
            </span>
          </div>

          <div className="field">
            <label>Name (optional)</label>
            <input
              autoFocus
              value={customer.name}
              onChange={e => onChange({ ...customer, name: e.target.value })}
              placeholder="e.g. Priya Sharma"
            />
          </div>

          <div className="field-row">
            <div className="field">
              <label>Email</label>
              <input
                type="email"
                value={customer.email}
                onChange={e => onChange({ ...customer, email: e.target.value })}
                placeholder="name@example.com"
              />
            </div>
            <div className="field">
              <label>Mobile</label>
              <input
                type="tel"
                value={customer.phone}
                onChange={e => onChange({ ...customer, phone: e.target.value })}
                placeholder="04xx xxx xxx"
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            </div>
          </div>

          <div style={{
            background: 'var(--bg-2)', borderRadius: 8, padding: 12,
            fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6,
            marginTop: 4
          }}>
            Provide email <em>or</em> mobile, or both. Total: <b style={{ color: 'var(--brand)' }}>${total.toFixed(2)}</b>.
            <br />
            <span style={{ color: 'var(--amber)' }}>Note:</span> Email / SMS receipt delivery requires a Cloud Function (not deployed yet).
            Customer details are still saved either way.
          </div>
        </div>

        <div className="pay-foot" style={{ justifyContent: 'space-between' }}>
          <button className="btn-ghost" onClick={onBack}>← Payment</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={onSkip}>Skip</button>
            <button
              className="btn btn-primary"
              disabled={!hasContact}
              style={{ opacity: hasContact ? 1 : 0.4 }}
              onClick={onSend}
            >
              Save customer & finish
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function calcTotals(items) {
  const subtotal = items.reduce((s, l) => s + l.price * l.qty, 0);
  const total = +subtotal.toFixed(2);
  const gst = +(subtotal * (10 / 110)).toFixed(2);
  return { subtotal: +subtotal.toFixed(2), gst, total };
}
