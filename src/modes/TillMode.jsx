import { useEffect, useMemo, useState } from 'react';
import {
  watchTables, watchOpenOrders, updateTableStatus,
  createOrder, createAndSendOrder, sendOrderToKitchen, settleOrder,
  upsertCustomer, queueReceiptDelivery, watchReceiptDelivery,
  previewVoucherRedemption,
  watchVenue, updateOrder
} from '../lib/data';
import { useDevice } from '../context/DeviceContext';
import OrderPane from '../components/OrderPane';
import DiscountModal from '../components/DiscountModal';

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

  // ── Discount & surcharge state (per-order, not persisted across orders) ──
  const [discount, setDiscount] = useState(null);      // { type:'pct'|'amount', value, reason }
  const [showDiscount, setShowDiscount] = useState(false);
  const [phSurchargeOn, setPhSurchargeOn] = useState(false); // public holiday toggle
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

  // ── Computed surcharge ─────────────────────────────────────────────────
  // Auto-add Sunday surcharge if enabled + today is Sunday.
  // Public holiday surcharge is opt-in via the PH toggle in the topbar.
  // Card surcharge handled separately at payment time (added per payment).
  const { effectiveSurchargePct, surchargeLabel } = useMemo(() => {
    const parts = [];
    let pct = 0;
    if (venue?.sundaySurchargeEnabled && new Date().getDay() === 0) {
      pct += venue.sundaySurchargePct || 10;
      parts.push(`Sunday ${venue.sundaySurchargePct || 10}%`);
    }
    if (venue?.publicHolidaySurchargeEnabled && phSurchargeOn) {
      pct += venue.publicHolidaySurchargePct || 15;
      parts.push(`PH ${venue.publicHolidaySurchargePct || 15}%`);
    }
    return {
      effectiveSurchargePct: pct,
      surchargeLabel: parts.join(' + '),
    };
  }, [venue, phSurchargeOn]);

  // When the active order changes, sync the discount state from Firestore
  // (so editing an order with an existing discount preserves it).
  useEffect(() => {
    if (activeOrder?.discount) {
      setDiscount(activeOrder.discount);
    } else {
      setDiscount(null);
    }
  }, [activeOrderId, activeOrder?.discount]);

  // Helper: compute totals for any item list using the CURRENT discount + surcharge.
  // Use this everywhere instead of calcTotals(items) directly.
  const totals = (items) => calcTotals(items, {
    discount,
    surchargePct: effectiveSurchargePct,
    gstPct: venue?.gstPct ?? 10,
  });

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

  // ── Note changes ─────────────────────────────────────────────────────
  const updateCartNote = (cartIndex, note) => {
    setCart(c => c.map((l, i) => i === cartIndex ? { ...l, notes: note } : l));
  };

  const updateSentNote = async (sentIndex, note) => {
    if (!activeOrder) return;
    const items = [...(activeOrder.items || [])];
    if (sentIndex < 0 || sentIndex >= items.length) return;
    items[sentIndex] = { ...items[sentIndex], notes: note };
    await updateOrder(activeOrder.id, { items });
  };

  // ── Modify already-sent items directly on the active order ───────────
  const modifySentItem = async (sentIndex, newQty) => {
    if (!activeOrder) return;
    const items = [...(activeOrder.items || [])];
    if (sentIndex < 0 || sentIndex >= items.length) return;
    items[sentIndex] = { ...items[sentIndex], qty: newQty };
    const t = totals(items);
    await updateOrder(activeOrder.id, { items, ...t });
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
    const t = totals(items);
    await updateOrder(activeOrder.id, { items, ...t });
  };

  // ── Send to Kitchen (step 1) ────────────────────────────────────────
  const handleSendToKitchen = async () => {
    if (cart.length === 0) return;

    // Validate dine-in needs a table; takeaway must have a customer name
    if (!activeOrder && orderType === 'dine-in-pickup' && !pendingTableId) {
      return showToast('Pick a table first', 'error');
    }
    if (!activeOrder && orderType === 'takeaway' && !pendingCustomerName.trim()) {
      return showToast('Enter a customer name for takeaway', 'error');
    }

    const sentCart = cart.map(l => ({ ...l, status: 'sent' }));

    try {
      if (activeOrder) {
        // Appending to existing order — preserve table/customer info
        const items = [...(activeOrder.items || []), ...sentCart];
        const t = totals(items);
        await sendOrderToKitchen(activeOrder.id, items, t);
        showToast(`+${cart.length} item${cart.length === 1 ? '' : 's'} sent to kitchen`);
      } else {
        // New order — atomic create+send so we never leave an orphan empty order
        const t = totals(sentCart);
        const isDineIn = orderType === 'dine-in-pickup';
        const tbl = isDineIn ? tables.find(t => t.id === pendingTableId) : null;
        const newOrderMeta = {
          tableId: tbl?.id || null,
          tableNumber: tbl?.number || null,
          customerName: !isDineIn && pendingCustomerName.trim() ? pendingCustomerName.trim() : null,
          orderType,
          openedBy: device.user.id
        };
        const orderId = await createAndSendOrder(newOrderMeta, sentCart, t);
        // Mark table as ordering
        if (tbl) await updateTableStatus(tbl.id, 'ordering');
        // Optimistic local copy so the UI doesn't blank while Firestore catches up
        setOptimisticOrder({
          id: orderId,
          ...newOrderMeta,
          items: sentCart,
          ...t,
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
    if (!activeOrder && orderType === 'takeaway' && !pendingCustomerName.trim()) {
      return showToast('Enter a customer name for takeaway', 'error');
    }
    const sentCart = cart.map(l => ({ ...l, status: 'sent' }));
    const t = totals(sentCart);

    try {
      if (activeOrder) {
        const items = [...(activeOrder.items || []), ...sentCart];
        const newTotals = totals(items);
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
        const orderId = await createAndSendOrder(newOrderMeta, sentCart, t);
        if (tbl) await updateTableStatus(tbl.id, 'ordering');
        setOptimisticOrder({
          id: orderId,
          ...newOrderMeta,
          items: sentCart,
          ...t,
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
    const orderId = activeOrder.id;

    // 1. Persist customer
    if (customer?.email || customer?.phone) {
      try { await upsertCustomer(customer); } catch (e) { console.warn('Customer upsert:', e); }
    }

    // 2. Settle order
    await settleOrder(orderId, payments, total, customer || null);

    // 3. Free table
    if (activeOrder.tableId) await updateTableStatus(activeOrder.tableId, 'free');

    // 4. Clear UI immediately so the cashier can move on
    setCart([]);
    setActiveOrderId(null);
    setShowPay(false);

    // 5. Queue receipt delivery + show live status toast
    if (customer && (customer.email || customer.phone) && customer.receiptOptIn !== false) {
      const channels = [
        customer.email ? '📧 email' : null,
        customer.phone ? '💬 SMS' : null
      ].filter(Boolean).join(' + ');

      showToast(`💰 Paid $${total.toFixed(2)} — queuing receipt via ${channels}…`, 'info');

      try {
        const deliveryId = await queueReceiptDelivery(orderId, customer);

        // Watch the delivery doc for status — update toast when done
        if (deliveryId) {
          const unsub = watchReceiptDelivery(deliveryId, (delivery) => {
            if (delivery.status === 'delivered') {
              showToast(`✅ Receipt delivered via ${channels}`, 'success');
              unsub();
            } else if (delivery.status === 'partial') {
              showToast(`⚠️ Receipt partially sent — check Reports for details`, 'warning');
              unsub();
            } else if (delivery.status === 'failed' || delivery.status === 'error') {
              showToast(`❌ Receipt failed to send — resend from Reports`, 'error');
              unsub();
            } else if (delivery.status === 'no_channels_configured') {
              showToast(`⚙️ Receipt queued — deploy Cloud Function to send`, 'warning');
              unsub();
            }
          });
          // Safety: unsub after 60s regardless
          setTimeout(unsub, 60_000);
        }
      } catch (e) {
        console.warn('Receipt queue failed:', e);
        showToast(`💰 Paid $${total.toFixed(2)} — could not queue receipt`, 'error');
      }
    } else {
      showToast(`💰 Paid $${total.toFixed(2)}`);
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
          {venue?.publicHolidaySurchargeEnabled && (
            <button
              className={`btn-sm ${phSurchargeOn ? 'btn btn-primary' : 'btn'}`}
              onClick={() => setPhSurchargeOn(v => !v)}
              title={phSurchargeOn ? 'Public holiday surcharge ON' : 'Click to add public holiday surcharge'}
              style={{ fontSize: 11 }}
            >
              🎉 PH {venue.publicHolidaySurchargePct}% {phSurchargeOn ? '✓' : ''}
            </button>
          )}
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
          <div className="btn-toggle-group btn-toggle-group--2">
            <button
              className={`btn-toggle ${orderType === 'takeaway' ? 'btn-toggle--active' : ''}`}
              onClick={() => { setOrderType('takeaway'); setPendingTableId(''); }}
            >🥡 Takeaway</button>
            <button
              className={`btn-toggle ${orderType === 'dine-in-pickup' ? 'btn-toggle--active' : ''}`}
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
              <label style={{
                fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.08em',
                textTransform: 'uppercase', marginBottom: 6, display: 'flex',
                alignItems: 'center', gap: 6, fontWeight: 700
              }}>
                Customer name
                <span style={{
                  fontSize: 10, padding: '2px 6px', borderRadius: 999,
                  background: 'color-mix(in srgb, var(--brand) 18%, transparent)',
                  color: 'var(--brand)', letterSpacing: '0.06em',
                  fontWeight: 700
                }}>REQUIRED</span>
              </label>
              <input
                value={pendingCustomerName}
                onChange={e => setPendingCustomerName(e.target.value)}
                placeholder="e.g. Priya, John"
                style={{
                  fontSize: 15, padding: '11px 14px',
                  fontWeight: 500,
                }}
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
        >
          Send to Kitchen
        </button>
      </div>
      {cart.length > 0 && (
        <button
          className="btn btn-success btn-lg btn-block"
          onClick={handleSendAndPay}
        >
          💳 Send + Pay Now · ${totals(cart).total.toFixed(2)}
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
          onNoteChange={updateCartNote}
          onSentNoteChange={updateSentNote}
          header={headerContent}
          footer={footerContent}
          gstPct={venue?.gstPct ?? 10}
          discount={discount}
          surchargePct={effectiveSurchargePct}
          surchargeLabel={surchargeLabel}
          onApplyDiscount={() => setShowDiscount(true)}
          onClearDiscount={() => setDiscount(null)}
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

      {showDiscount && (
        <DiscountModal
          subtotal={[...sentItems, ...cart].reduce((s, l) => s + l.price * l.qty, 0)}
          currentDiscount={discount}
          onApply={(d) => { setDiscount(d); setShowDiscount(false); }}
          onClose={() => setShowDiscount(false)}
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
                    {o.tableId
                      ? `T${o.tableNumber || o.tableId.replace('t','')}`
                      : (o.customerName || `#${o.id.slice(-4).toUpperCase()}`)}
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
    phone: order.customer?.phone || '',
    receiptOptIn: true
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
function CustomerCaptureScreen({ total, change, payments, customer, onChange, onBack, onSend, onSkip }) {
  const hasEmail   = customer.email.trim().length > 0;
  const hasPhone   = customer.phone.trim().length > 0;
  const hasContact = hasEmail || hasPhone;
  const receiptOptIn = customer.receiptOptIn !== false;

  const emailValid = !hasEmail || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email.trim());
  const phoneValid = !hasPhone || customer.phone.replace(/\D/g,'').length >= 8;
  const canSend    = hasContact && receiptOptIn && emailValid && phoneValid;

  return (
    <div className="pay-screen">
      <div className="pay-card" style={{ maxWidth: 520 }}>

        {/* ── Header ── */}
        <div className="pay-head" style={{ background: 'var(--green-deep)', borderBottom: '1px solid rgba(74,222,128,0.25)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 22 }}>✅</span>
              <h2 style={{ color: 'var(--green)', margin: 0 }}>Payment complete</h2>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-2)', marginLeft: 32 }}>
              Send a digital receipt to the customer
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <div className="total" style={{ color: 'var(--green)' }}>${total.toFixed(2)}</div>
            {change > 0 && (
              <span style={{ background: 'var(--amber-deep)', color: 'var(--amber)', padding: '3px 10px', borderRadius: 999, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                Change ${change.toFixed(2)}
              </span>
            )}
          </div>
        </div>

        <div className="pay-body" style={{ gridTemplateColumns: '1fr', padding: '24px 28px', gap: 16 }}>

          {/* ── Channel selector — tap to enable ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {/* Email channel */}
            <div style={{
              border: `2px solid ${hasEmail && receiptOptIn ? 'var(--brand)' : 'var(--border)'}`,
              borderRadius: 'var(--radius-lg)', overflow: 'hidden',
              background: hasEmail && receiptOptIn
                ? 'color-mix(in srgb, var(--brand) 10%, var(--surface))'
                : 'var(--surface-2)',
              transition: 'all 150ms'
            }}>
              <div style={{ padding: '10px 14px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>📧</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: hasEmail ? 'var(--brand)' : 'var(--text-2)' }}>
                  Email receipt
                </span>
                {hasEmail && emailValid && receiptOptIn && (
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--green)', fontWeight: 700 }}>✓</span>
                )}
              </div>
              <div style={{ padding: '0 10px 12px' }}>
                <input
                  type="email"
                  value={customer.email}
                  onChange={e => onChange({ ...customer, email: e.target.value })}
                  placeholder="customer@email.com"
                  style={{
                    fontSize: 13, padding: '8px 10px',
                    borderColor: hasEmail && !emailValid ? 'var(--red)' : undefined
                  }}
                />
                {hasEmail && !emailValid && (
                  <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 3, paddingLeft: 2 }}>
                    Please enter a valid email
                  </div>
                )}
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 5, paddingLeft: 2 }}>
                  Full HTML tax invoice PDF
                </div>
              </div>
            </div>

            {/* SMS channel */}
            <div style={{
              border: `2px solid ${hasPhone && receiptOptIn ? 'var(--blue)' : 'var(--border)'}`,
              borderRadius: 'var(--radius-lg)', overflow: 'hidden',
              background: hasPhone && receiptOptIn
                ? 'color-mix(in srgb, var(--blue) 10%, var(--surface))'
                : 'var(--surface-2)',
              transition: 'all 150ms'
            }}>
              <div style={{ padding: '10px 14px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>💬</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: hasPhone ? 'var(--blue)' : 'var(--text-2)' }}>
                  SMS receipt
                </span>
                {hasPhone && phoneValid && receiptOptIn && (
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--green)', fontWeight: 700 }}>✓</span>
                )}
              </div>
              <div style={{ padding: '0 10px 12px' }}>
                <input
                  type="tel"
                  value={customer.phone}
                  onChange={e => onChange({ ...customer, phone: e.target.value })}
                  placeholder="04xx xxx xxx"
                  style={{
                    fontSize: 13, padding: '8px 10px',
                    fontFamily: 'var(--font-mono)',
                    borderColor: hasPhone && !phoneValid ? 'var(--red)' : undefined
                  }}
                />
                {hasPhone && !phoneValid && (
                  <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 3, paddingLeft: 2 }}>
                    Enter a valid mobile number
                  </div>
                )}
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 5, paddingLeft: 2 }}>
                  Text confirmation + total
                </div>
              </div>
            </div>
          </div>

          {/* ── Customer name ── */}
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Customer name <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>(optional — shown on receipt)</span></label>
            <input
              value={customer.name}
              onChange={e => onChange({ ...customer, name: e.target.value })}
              placeholder="e.g. Priya Sharma"
            />
          </div>

          {/* ── Opt-out toggle — only show if contact entered ── */}
          {hasContact && (
            <div
              onClick={() => onChange({ ...customer, receiptOptIn: !receiptOptIn })}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
                background: receiptOptIn ? 'var(--green-deep)' : 'var(--surface-3)',
                border: `1.5px solid ${receiptOptIn ? 'rgba(74,222,128,0.3)' : 'var(--border)'}`,
                borderRadius: 'var(--radius)', padding: '12px 16px',
                transition: 'all 120ms', userSelect: 'none'
              }}
            >
              <div style={{
                width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                border: `2px solid ${receiptOptIn ? 'var(--green)' : 'var(--border-strong)'}`,
                background: receiptOptIn ? 'var(--green)' : 'transparent',
                display: 'grid', placeItems: 'center', fontSize: 14,
                color: '#0a1f12', fontWeight: 800, transition: 'all 120ms'
              }}>
                {receiptOptIn ? '✓' : ''}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: receiptOptIn ? 'var(--green)' : 'var(--text-2)' }}>
                  {receiptOptIn
                    ? `Send receipt via ${[hasEmail && '📧 email', hasPhone && '💬 SMS'].filter(Boolean).join(' + ')}`
                    : 'Do not send receipt'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                  {receiptOptIn
                    ? 'Customer details saved to marketing database'
                    : 'Customer details will still be saved'}
                </div>
              </div>
            </div>
          )}

          {/* ── Order summary strip ── */}
          <div style={{
            background: 'var(--bg-2)', borderRadius: 8, padding: '10px 14px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            fontSize: 13
          }}>
            <div style={{ color: 'var(--text-3)' }}>
              {(payments || []).map(p => (
                <span key={p.ts} style={{ marginRight: 10 }}>
                  <span style={{ textTransform: 'capitalize' }}>{p.method}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', marginLeft: 4 }}>${p.amount.toFixed(2)}</span>
                </span>
              ))}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--brand)', fontSize: 15 }}>
              ${total.toFixed(2)}
            </div>
          </div>
        </div>

        {/* ── Footer actions ── */}
        <div className="pay-foot" style={{ justifyContent: 'space-between', gap: 10 }}>
          <button className="btn-ghost" onClick={onBack} style={{ flexShrink: 0 }}>← Back</button>
          <div style={{ display: 'flex', gap: 8, flex: 1, justifyContent: 'flex-end' }}>
            <button className="btn btn-sm" onClick={onSkip} style={{ flexShrink: 0 }}>
              Skip
            </button>
            <button
              className="btn btn-primary"
              onClick={onSend}
              disabled={hasContact && receiptOptIn && !canSend}
              style={{ flex: 1, maxWidth: 240, opacity: (hasContact && receiptOptIn && !canSend) ? 0.4 : 1 }}
            >
              {!hasContact
                ? 'Finish without receipt'
                : !receiptOptIn
                ? 'Save & finish'
                : canSend
                ? `📨 Send receipt & finish`
                : 'Fix errors above'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function calcTotals(items, opts = {}) {
  const { discount = null, surchargePct = 0, gstPct = 10 } = opts;

  const subtotalGross = items.reduce((s, l) => s + l.price * l.qty, 0);

  let discountAmount = 0;
  if (discount?.type === 'pct')    discountAmount = subtotalGross * (discount.value / 100);
  if (discount?.type === 'amount') discountAmount = Math.min(discount.value, subtotalGross);

  const afterDiscount = subtotalGross - discountAmount;
  const surchargeAmount = surchargePct > 0 ? afterDiscount * (surchargePct / 100) : 0;
  const total = +(afterDiscount + surchargeAmount).toFixed(2);
  const gst = +(total * (gstPct / (100 + gstPct))).toFixed(2);
  const subtotal = +(total - gst).toFixed(2);

  return {
    subtotal, gst, total,
    subtotalGross: +subtotalGross.toFixed(2),
    discountAmount: +discountAmount.toFixed(2),
    surchargeAmount: +surchargeAmount.toFixed(2),
    discount: discount || null,
    surchargePct,
  };
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
