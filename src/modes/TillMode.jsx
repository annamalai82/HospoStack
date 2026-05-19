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
  const [pausedPayments, setPausedPayments] = useState([]); // payments preserved while editing
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
  // Clear paused payments when order changes
  useEffect(() => { if (!activeOrderId) setPausedPayments([]); }, [activeOrderId]);

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

  const [showVoidConfirm, setShowVoidConfirm] = useState(false);

  // ── Void order ────────────────────────────────────────────────────────
  const handleVoid = async () => {
    if (!activeOrder) return;
    await updateOrder(activeOrder.id, {
      status: 'voided',
      voidedAt: new Date(),
      voidedBy: device.user.id,
      clearedFromKitchen: true
    });
    if (activeOrder.tableId) {
      await updateTableStatus(activeOrder.tableId, 'free');
    }
    setCart([]);
    setActiveOrderId(null);
    setShowPay(false);
    setShowVoidConfirm(false);
    showToast('Order voided', 'error');
  };
  // ── Render ────────────────────────────────────────────────────────────
  const sentItems = activeOrder?.items || [];
  const headerContent = (
    <div className="cart-head">
      <div className="tbl">
        {activeOrder
          ? <>
              {activeOrder.tableId
                ? <>Table <b>{activeOrder.tableNumber || activeOrder.tableId?.replace('t','')}</b></>
                : <>Tab <b style={{ fontSize: 14, fontFamily: 'var(--font-mono)' }}>#{activeOrder.id.slice(-4).toUpperCase()}</b></>
              }
              {activeMins !== null && (
                <span style={{
                  marginLeft: 10, fontSize: 11, fontFamily: 'var(--font-mono)',
                  color: activeMins >= alertMins ? 'var(--red)'
                       : activeMins >= alertMins * 0.6 ? 'var(--amber)'
                       : 'var(--text-3)',
                  fontWeight: activeMins >= alertMins ? 700 : 400
                }}>
                  ⏱ {activeMins}m
                </span>
              )}
            </>
          : <>{orderType === 'takeaway' ? 'New Takeaway' : 'Counter / Dine-in'}</>
        }
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {activeOrder && (
          <button
            className="btn btn-danger btn-sm"
            onClick={() => setShowVoidConfirm(true)}
            title="Void this order"
          >🚫 Void</button>
        )}
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

  // Active time display
  const openedMs = activeOrder?.openedAt?.toMillis?.() || activeOrder?.sentAt?.toMillis?.();
  const activeMins = openedMs ? Math.floor((Date.now() - openedMs) / 60000) : null;

  const footerContent = activeOrder ? (
    <div className="cart-actions" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}>
      {pausedPayments.length > 0 && (
        <button
          className="btn btn-primary btn-block"
          onClick={() => setShowPay(true)}
          style={{
            background: 'var(--green-deep)', color: 'var(--green)',
            border: '1px solid rgba(74,222,128,0.3)', fontWeight: 700
          }}
        >
          ▶ Resume Payment · ${(activeOrder.total || 0).toFixed(2)}
          <span style={{ fontSize: 11, opacity: 0.8, marginLeft: 6 }}>
            ({pausedPayments.reduce((s,p)=>s+p.amount,0).toFixed(2)} applied)
          </span>
        </button>
      )}
      {cart.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button className="btn" onClick={() => setCart([])}>Clear new</button>
          <button className="btn btn-primary" onClick={handleSendToKitchen}>
            Send +{cart.length} to Kitchen
          </button>
        </div>
      ) : pausedPayments.length === 0 && (
        <button className="btn btn-success btn-lg btn-block" onClick={() => setShowPay(true)}>
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
          onVoidTab={async (o) => {
            await updateOrder(o.id, {
              status: 'voided',
              voidedAt: new Date(),
              clearedFromKitchen: true
            });
            if (o.tableId) await updateTableStatus(o.tableId, 'free');
            if (activeOrderId === o.id) { setActiveOrderId(null); setCart([]); }
            showToast('Order voided', 'error');
          }}
        />
      </div>

      {showPay && activeOrder && (
        <PayScreen
          order={activeOrder}
          initialPayments={pausedPayments}
          onCancel={() => setShowPay(false)}
          onVoid={() => { setShowPay(false); setShowVoidConfirm(true); }}
          onEditOrder={(currentPayments) => {
            setPausedPayments(currentPayments);
            setShowPay(false);
          }}
          onComplete={handlePaid}
        />
      )}

      {showVoidConfirm && activeOrder && (
        <VoidConfirmModal
          order={activeOrder}
          onCancel={() => setShowVoidConfirm(false)}
          onConfirm={handleVoid}
        />
      )}
    </div>
  );
}

// ── Open tabs sidebar ────────────────────────────────────────────────────
function OpenTabsPane({ tabs, tables, activeId, alertMins = 20, onSelect, onPay, onVoidTab }) {
  const [voidTarget, setVoidTarget] = useState(null);

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
                {/* Active time */}
                {(() => {
                  const openMs = o.openedAt?.toMillis?.() || o.sentAt?.toMillis?.();
                  if (!openMs) return null;
                  const mins = Math.floor((Date.now() - openMs) / 60000);
                  const isLong = mins >= alertMins;
                  const isMid  = mins >= alertMins * 0.6 && !isLong;
                  return (
                    <div className={`tab-active-time ${isLong ? 'overdue' : isMid ? 'warn' : ''}`}>
                      🕐 {mins}m
                    </div>
                  );
                })()}
                {waitMins !== null && (
                  <div className={`tab-wait ${isOverdue ? 'overdue' : isWarn ? 'warn' : ''}`}>
                    ⏱ {waitMins}m waiting
                  </div>
                )}
              </button>
              <div className="tab-actions">
                <button className="tab-pay" onClick={() => onPay(o)} title="Take payment">💳</button>
                <button className="tab-void" onClick={() => setVoidTarget(o)} title="Void order">🚫</button>
              </div>
            </div>
          );
        })}
      </div>

      {voidTarget && (
        <VoidConfirmModal
          order={voidTarget}
          onCancel={() => setVoidTarget(null)}
          onConfirm={async () => { await onVoidTab(voidTarget); setVoidTarget(null); }}
        />
      )}
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
function PayScreen({ order, initialPayments = [], onCancel, onVoid, onEditOrder, onComplete }) {
  const total = order.total || 0;
  const [payments, setPayments] = useState(initialPayments.length ? initialPayments : (order.payments || []));
  const [amount, setAmount] = useState('');
  const [stage, setStage] = useState('payment'); // 'payment' | 'split' | 'customer'
  const [splitMode, setSplitMode] = useState(null); // 'persons' | 'items'
  const [splitPersons, setSplitPersons] = useState(2);
  const [splitSeat, setSplitSeat] = useState(0); // which seat is paying now (items split)
  const [seatAssignments, setSeatAssignments] = useState({}); // itemIdx -> seatNum
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
    if (method === 'voucher') { setShowVoucher(true); return; }
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
    setStage('customer');
  };

  const handleFinalise = () => onComplete(payments, customer);
  const handleSkip = () => onComplete(payments, null);

  // ── Split by persons ─────────────────────────────────────────────────
  const perPersonAmount = +(total / splitPersons).toFixed(2);

  // ── Split by items — compute seat totals ─────────────────────────────
  const items = order.items || [];
  const seatCount = splitPersons;
  const seatTotals = Array.from({ length: seatCount }, (_, s) => {
    return items
      .filter((_, i) => (seatAssignments[i] ?? 0) === s)
      .reduce((sum, it) => sum + it.price * it.qty, 0);
  });
  const assignItem = (itemIdx, seat) => setSeatAssignments(a => ({ ...a, [itemIdx]: seat }));

  // ── Customer stage ───────────────────────────────────────────────────
  if (stage === 'customer') {
    return <CustomerCaptureScreen
      total={total} change={change} payments={payments}
      customer={customer} onChange={setCustomer}
      onBack={() => setStage('payment')}
      onSend={handleFinalise} onSkip={handleSkip}
    />;
  }

  // ── Split mode ───────────────────────────────────────────────────────
  if (stage === 'split') {
    return (
      <div className="pay-screen">
        <div className="pay-card">
          <div className="pay-head">
            <h2>Split payment</h2>
            <div className="total">${total.toFixed(2)}</div>
          </div>
          <div className="pay-body" style={{ gridTemplateColumns: '1fr', gap: 0 }}>
            {/* Split mode picker */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button
                className={`btn ${splitMode === 'persons' ? 'btn-primary' : ''}`}
                style={{ flex: 1 }}
                onClick={() => setSplitMode('persons')}
              >👥 By persons</button>
              <button
                className={`btn ${splitMode === 'items' ? 'btn-primary' : ''}`}
                style={{ flex: 1 }}
                onClick={() => setSplitMode('items')}
              >🍽 By items</button>
            </div>

            {/* Person count stepper */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <span style={{ color: 'var(--text-2)', fontSize: 14 }}>Splitting between</span>
              <div className="cart-edit-stepper" style={{ flex: 1, maxWidth: 140 }}>
                <button className="cart-edit-step dec" onClick={() => setSplitPersons(p => Math.max(2, p - 1))}>−</button>
                <span className="cart-edit-qty">{splitPersons}</span>
                <button className="cart-edit-step inc" onClick={() => setSplitPersons(p => Math.min(12, p + 1))}>+</button>
              </div>
              <span style={{ color: 'var(--text-2)', fontSize: 14 }}>people</span>
            </div>

            {splitMode === 'persons' && (
              <div>
                <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 12 }}>
                  Each person pays <b style={{ fontFamily: 'var(--font-mono)', color: 'var(--brand)', fontSize: 16 }}>${perPersonAmount.toFixed(2)}</b>
                  {total % splitPersons !== 0 && <span style={{ color: 'var(--text-3)', marginLeft: 6 }}>(rounded)</span>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {Array.from({ length: splitPersons }, (_, s) => {
                    const alreadyPaid = payments
                      .filter(p => p.seat === s)
                      .reduce((sum, p) => sum + p.amount, 0);
                    const isPaid = alreadyPaid >= perPersonAmount - 0.01;
                    return (
                      <div key={s} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 14px',
                        background: isPaid ? 'var(--green-deep)' : 'var(--surface-2)',
                        border: `1px solid ${isPaid ? 'rgba(74,222,128,0.3)' : 'var(--border)'}`,
                        borderRadius: 'var(--radius)'
                      }}>
                        <span style={{ fontFamily: 'var(--font-mono)', color: isPaid ? 'var(--green)' : 'var(--text)', fontWeight: 600, fontSize: 15 }}>
                          Person {s + 1}
                        </span>
                        <span style={{ flex: 1, fontFamily: 'var(--font-mono)', color: 'var(--brand)' }}>
                          ${perPersonAmount.toFixed(2)}
                        </span>
                        {isPaid
                          ? <span style={{ color: 'var(--green)', fontWeight: 600 }}>✓ Paid</span>
                          : (
                            <div style={{ display: 'flex', gap: 6 }}>
                              {['cash','card','eftpos'].map(m => (
                                <button key={m} className="btn btn-sm" style={{ padding: '8px 10px', fontSize: 12 }}
                                  onClick={() => {
                                    setPayments([...payments, { method: m, amount: perPersonAmount, seat: s, ts: Date.now() }]);
                                  }}
                                >{m}</button>
                              ))}
                            </div>
                          )
                        }
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {splitMode === 'items' && (
              <div>
                <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 10 }}>
                  Assign each item to a person, then collect payment per person.
                </div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                  {Array.from({ length: seatCount }, (_, s) => (
                    <button key={s}
                      className={`cat-chip ${splitSeat === s ? 'active' : ''}`}
                      onClick={() => setSplitSeat(s)}
                    >
                      Person {s + 1} · ${seatTotals[s].toFixed(2)}
                    </button>
                  ))}
                </div>
                <div className="data-table">
                  {items.map((it, i) => {
                    const seat = seatAssignments[i] ?? 0;
                    return (
                      <div key={i} className="row" style={{ gridTemplateColumns: '1fr auto auto', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: 14 }}>{it.name}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                            ×{it.qty} · ${(it.price * it.qty).toFixed(2)}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {Array.from({ length: seatCount }, (_, s) => (
                            <button key={s}
                              onClick={() => assignItem(i, s)}
                              style={{
                                width: 28, height: 28, borderRadius: '50%',
                                border: `2px solid ${seat === s ? 'var(--brand)' : 'var(--border)'}`,
                                background: seat === s ? 'var(--brand)' : 'var(--surface-2)',
                                color: seat === s ? '#18120e' : 'var(--text-3)',
                                fontSize: 11, fontWeight: 700
                              }}
                            >{s + 1}</button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* Collect per seat */}
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {Array.from({ length: seatCount }, (_, s) => {
                    const seatTotal = seatTotals[s];
                    const paidForSeat = payments.filter(p => p.seat === s).reduce((sum, p) => sum + p.amount, 0);
                    const isPaid = paidForSeat >= seatTotal - 0.01;
                    return (
                      <div key={s} style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                        background: isPaid ? 'var(--green-deep)' : 'var(--surface-2)',
                        border: `1px solid ${isPaid ? 'rgba(74,222,128,0.3)' : 'var(--border)'}`,
                        borderRadius: 'var(--radius)'
                      }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, flex: 1 }}>
                          Person {s + 1} · ${seatTotal.toFixed(2)}
                        </span>
                        {isPaid
                          ? <span style={{ color: 'var(--green)', fontWeight: 600 }}>✓ Paid</span>
                          : (
                            <div style={{ display: 'flex', gap: 6 }}>
                              {['cash','card','eftpos'].map(m => (
                                <button key={m} className="btn btn-sm" style={{ padding: '8px 10px', fontSize: 12 }}
                                  onClick={() => setPayments([...payments, { method: m, amount: +seatTotal.toFixed(2), seat: s, ts: Date.now() }])}
                                >{m}</button>
                              ))}
                            </div>
                          )
                        }
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {!splitMode && (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>
                Choose a split method above.
              </div>
            )}
          </div>

          <div className="pay-foot">
            <div className="payments-list">
              {payments.length === 0 && <span style={{ color: 'var(--text-3)', fontSize: 12 }}>No payments yet</span>}
              {payments.map((p, i) => (
                <span key={i} className="payment-chip">
                  {p.seat !== undefined ? `P${p.seat+1} ` : ''}{p.method === 'voucher' && p.code ? `🎟 ${p.code}` : p.method} ${p.amount.toFixed(2)}
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-ghost" onClick={() => setStage('payment')}>← Back</button>
              <button
                className="btn btn-success"
                disabled={balance > 0.005}
                style={{ opacity: balance > 0.005 ? 0.4 : 1 }}
                onClick={handleComplete}
              >Finalise</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Standard payment screen ──────────────────────────────────────────
  const openedMs = order.openedAt?.toMillis?.() || order.sentAt?.toMillis?.();
  const activeMins = openedMs ? Math.floor((Date.now() - openedMs) / 60000) : null;

  return (
    <div className="pay-screen">
      <div className="pay-card">
        <div className="pay-head">
          <div>
            <h2>Payment</h2>
            {activeMins !== null && (
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3, fontFamily: 'var(--font-mono)' }}>
                🕐 Table open {activeMins}m
              </div>
            )}
            {onEditOrder && (
              <button className="btn-edit-order" onClick={() => onEditOrder(payments)}>
                ✎ Edit order items
              </button>
            )}
          </div>
          <div className="pay-head-right">
            <div className="total">${total.toFixed(2)}</div>
            <button className="btn-split" onClick={() => { setSplitMode('persons'); setStage('split'); }}>
              ⇌ Split payment
            </button>
          </div>
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
            {onVoid && (
              <button className="btn btn-danger btn-sm" onClick={onVoid} title="Void this order">
                🚫 Void Order
              </button>
            )}
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

// ── Void confirm modal ───────────────────────────────────────────────────
export function VoidConfirmModal({ order, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const label = order?.tableId
    ? `Table ${order.tableNumber || order.tableId.replace('t','')}`
    : order?.id ? `#${order.id.slice(-4).toUpperCase()}` : 'this order';
  const total = order?.total || 0;

  const confirm = async () => {
    setBusy(true);
    try { await onConfirm(); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 80 }} onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head" style={{ background: 'var(--red-deep)', borderColor: 'rgba(248,113,113,0.3)' }}>
          <h3 style={{ color: 'var(--red)' }}>🚫 Void Order</h3>
          <button className="icon-btn" onClick={onCancel}>×</button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 16, fontWeight: 500, marginBottom: 16, lineHeight: 1.5 }}>
            Are you sure you want to void <b>{label}</b>?
          </p>
          {total > 0 && (
            <div style={{
              background: 'var(--red-deep)', border: '1px solid rgba(248,113,113,0.25)',
              borderRadius: 10, padding: '14px 18px', marginBottom: 16,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center'
            }}>
              <span style={{ color: 'var(--text-2)', fontSize: 14 }}>Order total</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700, color: 'var(--red)' }}>
                ${total.toFixed(2)}
              </span>
            </div>
          )}
          <div style={{
            background: 'var(--surface-2)', borderRadius: 8, padding: 12,
            fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6
          }}>
            This will cancel the order and remove it from the Kitchen Display.
            {order?.tableId && ' The table will be freed.'} This cannot be undone.
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onCancel} disabled={busy}>Keep Order</button>
          <button className="btn btn-danger btn-lg" onClick={confirm} disabled={busy}>
            {busy ? 'Voiding…' : '🚫 Yes, Void Order'}
          </button>
        </div>
      </div>
    </div>
  );
}
