import { useEffect, useMemo, useState } from 'react';
import {
  watchTables, watchOpenOrders, updateTableStatus,
  createOrder, createAndSendOrder, sendOrderToKitchen, settleOrder,
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
  const [pendingTableId, setPendingTableId] = useState(''); // chosen for new dine-in
  const [pendingCustomerName, setPendingCustomerName] = useState(''); // chosen for new takeaway
  const [tables, setTables] = useState([]);
  const [orders, setOrders] = useState([]);
  const [activeOrderId, setActiveOrderId] = useState(null);
  const [cart, setCart] = useState([]);
  const [showPay, setShowPay] = useState(false);
  const [pausedPayments, setPausedPayments] = useState([]); // payments preserved while editing
  const [toast, setToast] = useState(null);
  const [venue, setVenue] = useState(null);
  const [tick, setTick] = useState(0);

  const venueId = device?.venueId;
  useEffect(() => { if (!venueId) return; return watchTables(setTables); }, [venueId]);
  useEffect(() => { if (!venueId) return; return watchOpenOrders(setOrders); }, [venueId]);
  useEffect(() => { if (!venueId) return; return watchVenue(setVenue); }, [venueId]);
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

  const activeOrderFromList = activeOrderId ? orders.find(o => o.id === activeOrderId) : null;
  const [optimisticOrder, setOptimisticOrder] = useState(null);
  // Once Firestore catches up and the order is in the list, drop the optimistic copy
  useEffect(() => {
    if (optimisticOrder && orders.find(o => o.id === optimisticOrder.id)) {
      setOptimisticOrder(null);
    }
  }, [orders, optimisticOrder]);
  const activeOrder = activeOrderFromList || (optimisticOrder?.id === activeOrderId ? optimisticOrder : null);

  // ── Cart ops ─────────────────────────────────────────────────────────
  const addToCart = (item) => {
    setCart(c => {
      const found = c.findIndex(l => l.itemId === item.id);
      if (found >= 0) {
        const next = [...c]; next[found] = { ...next[found], qty: next[found].qty + 1 }; return next;
      }
      // Coerce any undefined fields to safe defaults — Firestore rejects
      // undefined values and silently fails the send-to-kitchen write,
      // which leaves an orphan empty order in Open Tabs.
      return [...c, {
        itemId: item.id,
        name: item.name,
        qty: 1,
        price: item.price ?? 0,
        station: item.station ?? 'kitchen',
        course: item.course ?? 'main',
        selections: [],
        notes: '',
        status: 'pending'
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

    // Validate dine-in needs a table; takeaway should have a name
    if (!activeOrder && orderType === 'dine-in-pickup' && !pendingTableId) {
      return showToast('Pick a table first', 'error');
    }

    const sentCart = cart.map(l => ({ ...l, status: 'sent' }));

    try {
      if (activeOrder) {
        // Appending to existing order — preserve table/customer info
        const items = [...(activeOrder.items || []), ...sentCart];
        const totals = calcTotals(items);
        await sendOrderToKitchen(activeOrder.id, items, totals);
        showToast(`+${cart.length} item${cart.length === 1 ? '' : 's'} sent to kitchen`);
      } else {
        // New order — atomic create+send so we never leave an orphan empty order
        const totals = calcTotals(sentCart);
        const isDineIn = orderType === 'dine-in-pickup';
        const tbl = isDineIn ? tables.find(t => t.id === pendingTableId) : null;
        const newOrderMeta = {
          tableId: tbl?.id || null,
          tableNumber: tbl?.number || null,
          customerName: !isDineIn && pendingCustomerName.trim() ? pendingCustomerName.trim() : null,
          orderType,
          openedBy: device.user.id
        };
        const orderId = await createAndSendOrder(newOrderMeta, sentCart, totals);
        // Mark table as ordering
        if (tbl) await updateTableStatus(tbl.id, 'ordering');
        // Optimistic local copy so the UI doesn't blank while Firestore catches up
        setOptimisticOrder({
          id: orderId,
          ...newOrderMeta,
          items: sentCart,
          ...totals,
          status: 'sent',
          openedAt: { toMillis: () => Date.now() },
          sentAt: { toMillis: () => Date.now() }
        });
        setActiveOrderId(orderId);
        setPendingTableId('');
        setPendingCustomerName('');
        const label = tbl ? `Table ${tbl.number}` : (pendingCustomerName.trim() || 'Takeaway');
        showToast(`${label} sent to kitchen`);
      }
      setCart([]);
    } catch (err) {
      console.error('Send to kitchen failed:', err);
      showToast(`Couldn't send to kitchen — ${err?.message || 'try again'}`, 'error');
    }
  };

  // ── Send + immediately go to payment (counter / quick service flow) ──
  const handleSendAndPay = async () => {
    if (cart.length === 0) return;
    if (!activeOrder && orderType === 'dine-in-pickup' && !pendingTableId) {
      return showToast('Pick a table first', 'error');
    }
    const sentCart = cart.map(l => ({ ...l, status: 'sent' }));
    const totals = calcTotals(sentCart);

    try {
      if (activeOrder) {
        const items = [...(activeOrder.items || []), ...sentCart];
        const newTotals = calcTotals(items);
        await sendOrderToKitchen(activeOrder.id, items, newTotals);
        setCart([]);
        setShowPay(true);
      } else {
        const isDineIn = orderType === 'dine-in-pickup';
        const tbl = isDineIn ? tables.find(t => t.id === pendingTableId) : null;
        const newOrderMeta = {
          tableId: tbl?.id || null,
          tableNumber: tbl?.number || null,
          customerName: !isDineIn && pendingCustomerName.trim() ? pendingCustomerName.trim() : null,
          orderType,
          openedBy: device.user.id
        };
        const orderId = await createAndSendOrder(newOrderMeta, sentCart, totals);
        if (tbl) await updateTableStatus(tbl.id, 'ordering');
        setOptimisticOrder({
          id: orderId,
          ...newOrderMeta,
          items: sentCart,
          ...totals,
          status: 'sent',
          openedAt: { toMillis: () => Date.now() },
          sentAt: { toMillis: () => Date.now() }
        });
        setActiveOrderId(orderId);
        setCart([]);
        setPendingTableId('');
        setPendingCustomerName('');
        setShowPay(true);
      }
    } catch (err) {
      console.error('Send + pay failed:', err);
      showToast(`Couldn't send to kitchen — ${err?.message || 'try again'}`, 'error');
    }
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

  // Active time display (must be defined BEFORE headerContent uses it)
  const openedMs = activeOrder?.openedAt?.toMillis?.() || activeOrder?.sentAt?.toMillis?.();
  const activeMins = openedMs ? Math.floor((Date.now() - openedMs) / 60000) : null;

  // Tables available for a new dine-in
  const freeTables = tables.filter(t => t.status === 'free' || t.id === pendingTableId);

  const headerContent = (
    <div className="cart-head" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div className="tbl" style={{ fontSize: 18 }}>
          {activeOrder
            ? activeOrder.tableId
              ? <>Table <b>{activeOrder.tableNumber || activeOrder.tableId?.replace('t','')}</b></>
              : activeOrder.customerName
                ? <>🥡 <b style={{ color: 'var(--brand)', fontStyle: 'normal', fontFamily: 'var(--font-display)' }}>{activeOrder.customerName}</b></>
                : <>Takeaway <b style={{ fontSize: 13, fontFamily: 'var(--font-mono)' }}>#{activeOrder.id.slice(-4).toUpperCase()}</b></>
            : <>{orderType === 'takeaway' ? 'New Takeaway' : 'New Dine-in'}</>
          }
          {activeOrder && activeMins !== null && (
            <span style={{
              marginLeft: 10, fontSize: 11, fontFamily: 'var(--font-mono)',
              color: activeMins >= alertMins ? 'var(--red)'
                   : activeMins >= alertMins * 0.6 ? 'var(--amber)'
                   : 'var(--text-3)'
            }}>⏱ {activeMins}m</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {activeOrder && (
            <button className="btn btn-danger btn-sm" onClick={() => setShowVoidConfirm(true)}>🚫 Void</button>
          )}
          {activeOrder && (
            <button className="btn-ghost" onClick={cancelActive}>← Back</button>
          )}
        </div>
      </div>

      {/* When starting a NEW order: pick type, then table or customer name */}
      {!activeOrder && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <button
              className={orderType === 'takeaway' ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
              onClick={() => { setOrderType('takeaway'); setPendingTableId(''); }}
            >🥡 Takeaway</button>
            <button
              className={orderType === 'dine-in-pickup' ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
              onClick={() => { setOrderType('dine-in-pickup'); setPendingCustomerName(''); }}
            >🍽 Dine-in</button>
          </div>

          {orderType === 'dine-in-pickup' && (
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4, display: 'block' }}>
                Pick a table <span style={{ color: 'var(--red)' }}>*</span>
              </label>
              {freeTables.length === 0 ? (
                <div style={{
                  background: 'var(--amber-deep)', border: '1px solid rgba(251,191,36,0.3)',
                  borderRadius: 6, padding: 8, fontSize: 12, color: 'var(--amber)'
                }}>
                  All tables occupied — pick from Open Tabs or use Takeaway.
                </div>
              ) : (
                <div className="table-quick-pick">
                  {freeTables.map(t => (
                    <button
                      key={t.id}
                      className={`table-quick-btn ${pendingTableId === t.id ? 'picked' : ''}`}
                      onClick={() => setPendingTableId(t.id)}
                    >
                      <span className="num">{t.number}</span>
                      <span className="zone">{t.zone}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {orderType === 'takeaway' && (
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4, display: 'block' }}>
                Customer name <span style={{ color: 'var(--text-3)' }}>(recommended)</span>
              </label>
              <input
                value={pendingCustomerName}
                onChange={e => setPendingCustomerName(e.target.value)}
                placeholder="e.g. Priya, John"
                style={{ fontSize: 15, padding: '10px 12px' }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );

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
    // New order (no active tab yet) — actions vary by order type
    <div className="cart-actions" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <button className="btn" onClick={() => setCart([])} disabled={!cart.length}>Clear</button>
        <button
          className="btn btn-primary"
          onClick={handleSendToKitchen}
          disabled={!cart.length}
          style={{ opacity: cart.length ? 1 : 0.4 }}
        >
          Send to Kitchen
        </button>
      </div>
      {cart.length > 0 && (
        <button
          className="btn btn-success btn-lg btn-block"
          onClick={handleSendAndPay}
        >
          💳 Send + Pay Now · ${calcTotals(cart).total.toFixed(2)}
        </button>
      )}
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
  const [eftposPending, setEftposPending] = useState(null); // { amount, seat? } when EFTPOS tapped, waiting for terminal confirm

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

    // EFTPOS goes through a confirmation step — manual Tyro terminal flow
    if (method === 'eftpos') {
      setEftposPending({
        amount: +Math.min(amt, balance + 1000).toFixed(2),
        seat: null
      });
      return;
    }

    const next = [...payments, { method, amount: +Math.min(amt, balance + 1000).toFixed(2), ts: Date.now() }];
    setPayments(next);
    setAmount('');
  };

  // ── EFTPOS confirm — records once cashier confirms terminal approved ──
  const confirmEftpos = (authCode, last4) => {
    if (!eftposPending) return;
    const entry = {
      method: 'eftpos',
      amount: eftposPending.amount,
      ts: Date.now(),
      ...(eftposPending.seat !== null ? { seat: eftposPending.seat } : {}),
      ...(authCode ? { authCode } : {}),
      ...(last4 ? { last4 } : {})
    };
    setPayments([...payments, entry]);
    setEftposPending(null);
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
                                    if (m === 'eftpos') {
                                      setEftposPending({ amount: perPersonAmount, seat: s });
                                    } else {
                                      setPayments([...payments, { method: m, amount: perPersonAmount, seat: s, ts: Date.now() }]);
                                    }
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
                                  onClick={() => {
                                    const amt = +seatTotal.toFixed(2);
                                    if (m === 'eftpos') {
                                      setEftposPending({ amount: amt, seat: s });
                                    } else {
                                      setPayments([...payments, { method: m, amount: amt, seat: s, ts: Date.now() }]);
                                    }
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
            <div style={{ display: 'flex', gap: 8 }}>
              {onVoid && (
                <button
                  className="btn btn-danger btn-sm"
                  onClick={onVoid}
                  style={{ fontSize: 13, padding: '7px 12px' }}
                >🚫 Void</button>
              )}
              <button className="btn-split" onClick={() => { setSplitMode('persons'); setStage('split'); }}>
                ⇌ Split
              </button>
            </div>
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
                {p.method === 'eftpos' && p.authCode && (
                  <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.7 }}>·{p.authCode}</span>
                )}
                {p.method === 'eftpos' && p.last4 && (
                  <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.7 }}>···{p.last4}</span>
                )}
              </span>
            ))}
            {change > 0 && (
              <span className="payment-chip" style={{ background: 'var(--amber-deep)', color: 'var(--amber)', borderColor: 'rgba(251,191,36,0.3)' }}>
                Change ${change.toFixed(2)}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn-ghost" onClick={onCancel}>← Back</button>
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

      {eftposPending && (
        <EftposConfirmModal
          amount={eftposPending.amount}
          seat={eftposPending.seat}
          onCancel={() => setEftposPending(null)}
          onConfirm={confirmEftpos}
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

// ── EFTPOS confirm modal — manual Tyro terminal flow ───────────────────
function EftposConfirmModal({ amount, seat, onCancel, onConfirm }) {
  const [authCode, setAuthCode] = useState('');
  const [last4, setLast4] = useState('');

  return (
    <div className="void-modal-overlay" onClick={onCancel}>
      <div className="void-modal" onClick={e => e.stopPropagation()}>
        <div className="void-modal-head" style={{ background: 'var(--blue-deep)', color: 'var(--blue)', borderColor: 'rgba(96,165,250,0.3)' }}>
          <span>💳 Run on Tyro terminal</span>
          <button className="icon-btn" onClick={onCancel}>×</button>
        </div>
        <div className="void-modal-body">
          <div style={{
            background: 'var(--surface-2)', borderRadius: 10,
            padding: '16px 18px', marginBottom: 14,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
          }}>
            <span style={{ fontSize: 14, color: 'var(--text-2)' }}>
              Run on terminal{seat !== null && seat !== undefined ? ` for Person ${seat + 1}` : ''}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 26, fontWeight: 700, color: 'var(--brand)' }}>
              ${amount.toFixed(2)}
            </span>
          </div>

          <div style={{
            background: 'var(--blue-deep)', border: '1px solid rgba(96,165,250,0.25)',
            borderRadius: 8, padding: 12, fontSize: 13,
            color: 'var(--blue)', lineHeight: 1.6, marginBottom: 16
          }}>
            <b>1.</b> Punch <b>${amount.toFixed(2)}</b> into the Tyro terminal<br/>
            <b>2.</b> Customer taps / inserts card<br/>
            <b>3.</b> Wait for the <b>APPROVED</b> beep<br/>
            <b>4.</b> Tap "Approved" below to record this payment
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: 11 }}>Auth code <span style={{ color: 'var(--text-3)' }}>(optional)</span></label>
              <input
                value={authCode}
                onChange={e => setAuthCode(e.target.value.replace(/[^A-Z0-9]/gi, '').slice(0, 8))}
                placeholder="from receipt"
                inputMode="numeric"
                style={{ fontFamily: 'var(--font-mono)', fontSize: 15, textAlign: 'center' }}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: 11 }}>Last 4 digits <span style={{ color: 'var(--text-3)' }}>(optional)</span></label>
              <input
                value={last4}
                onChange={e => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="••••"
                inputMode="numeric"
                style={{ fontFamily: 'var(--font-mono)', fontSize: 15, textAlign: 'center', letterSpacing: '0.2em' }}
              />
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.5 }}>
            Auth code helps with refund tracking. Last 4 digits help match the card if the customer queries the charge later.
          </div>
        </div>
        <div className="void-modal-foot">
          <button className="btn-ghost" onClick={onCancel}>
            ✗ Declined / Cancel
          </button>
          <button
            className="btn btn-lg"
            onClick={() => onConfirm(authCode || null, last4 || null)}
            style={{ background: 'var(--green)', color: '#0a1f12', fontWeight: 700, flex: 2 }}
          >
            ✓ Approved · ${amount.toFixed(2)}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Void confirm modal ───────────────────────────────────────────────────
export function VoidConfirmModal({ order, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const label = order?.tableId
    ? `Table ${order.tableNumber || order.tableId.replace('t','')}`
    : order?.customerName
      ? order.customerName
      : order?.id ? `#${order.id.slice(-4).toUpperCase()}` : 'this order';
  const total = order?.total || 0;

  const confirm = async () => {
    setBusy(true);
    try { await onConfirm(); }
    finally { setBusy(false); }
  };

  return (
    <div className="void-modal-overlay" onClick={!busy ? onCancel : undefined}>
      <div className="void-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="void-modal-head">
          <span>🚫 Void Order</span>
          <button className="icon-btn" onClick={onCancel} disabled={busy}>×</button>
        </div>
        {/* Body */}
        <div className="void-modal-body">
          <div className="void-label">Void <b>{label}</b>?</div>
          {total > 0 && (
            <div className="void-total-row">
              <span>Order total</span>
              <span className="void-total-amount">${total.toFixed(2)}</span>
            </div>
          )}
          <div className="void-info">
            Cancels the order and removes it from the Kitchen Display.
            {order?.tableId && ' Table will be freed.'}
            {' '}Cannot be undone.
          </div>
        </div>
        {/* Sticky footer — always visible */}
        <div className="void-modal-foot">
          <button className="btn-ghost" onClick={onCancel} disabled={busy}>
            Keep Order
          </button>
          <button className="btn btn-danger btn-lg" onClick={confirm} disabled={busy}>
            {busy ? 'Voiding…' : '🚫 Void Order'}
          </button>
        </div>
      </div>
    </div>
  );
}
