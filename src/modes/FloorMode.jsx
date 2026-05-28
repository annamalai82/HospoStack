import { useEffect, useMemo, useState } from 'react';
import {
  watchTables, watchOpenOrders, updateTableStatus,
  createOrder, sendOrderToKitchen, watchBookingsForDate, updateBooking,
  watchVenue, updateOrder
} from '../lib/data';
import { useDevice } from '../context/DeviceContext';
import OrderPane from '../components/OrderPane';
import StockAlertBanner from '../components/StockAlertBanner';
import { VoidConfirmModal, AllergyNoteModal } from './TillMode';

export default function FloorMode() {
  const { device } = useDevice();
  const [tables, setTables] = useState([]);
  const [orders, setOrders] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [zone, setZone] = useState('All');
  const [openTable, setOpenTable] = useState(null);
  const [cart, setCart] = useState([]);
  const [toast, setToast] = useState(null);
  const [showBookings, setShowBookings] = useState(false);
  const [venue, setVenue] = useState(null);
  const [tick, setTick] = useState(0);
  const [showVoidConfirm, setShowVoidConfirm] = useState(false);
  const [showAllergy, setShowAllergy] = useState(false);
  const [allergyNote, setAllergyNote] = useState('');

  const venueId = device?.venueId;
  useEffect(() => { if (!venueId) return; return watchTables(setTables); }, [venueId]);
  useEffect(() => { if (!venueId) return; return watchOpenOrders(setOrders); }, [venueId]);
  useEffect(() => { if (!venueId) return; return watchVenue(setVenue); }, [venueId]);
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    return watchBookingsForDate(today, setBookings);
  }, []);
  // Re-render every 30s for live timers
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const alertMins = venue?.kdsAlertMins ?? 20;

  const upcomingBookings = useMemo(() => {
    const now = new Date();
    const cutoff = new Date(now.getTime() + 3 * 60 * 60 * 1000); // next 3 hours
    return bookings.filter(b => {
      if (b.status === 'arrived' || b.status === 'cancelled' || b.status === 'no-show') return false;
      const [h, m] = (b.time || '00:00').split(':').map(Number);
      const bookingTime = new Date();
      bookingTime.setHours(h, m, 0, 0);
      // Show if booking is in the next 3 hours, or up to 30 mins past (late arrivals)
      return bookingTime >= new Date(now.getTime() - 30 * 60 * 1000) && bookingTime <= cutoff;
    });
  }, [bookings]);

  const zones = useMemo(() => ['All', ...new Set(tables.map(t => t.zone))], [tables]);
  const visibleTables = zone === 'All' ? tables : tables.filter(t => t.zone === zone);

  const orderForTable = (tid) => orders.find(o => o.tableId === tid && o.status !== 'paid');

  const showToast = (msg, kind = 'success') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2200);
  };

  // ── Open table flow ───────────────────────────────────────────────────
  const handleOpenTable = async (table) => {
    setOpenTable(table);
    setCart([]);
    // Load any existing allergy note for this table's order
    setAllergyNote(orderForTable(table.id)?.allergyNote || '');
    if (!orderForTable(table.id)) {
      await updateTableStatus(table.id, 'seated');
    }
  };

  const handleCloseEditor = () => { setOpenTable(null); setCart([]); setAllergyNote(''); };

  // ── Cart manipulation ────────────────────────────────────────────────
  const addToCart = (item) => {
    setCart(c => {
      const found = c.findIndex(l => l.itemId === item.id && !l.notes);
      if (found >= 0) {
        const next = [...c];
        next[found] = { ...next[found], qty: next[found].qty + 1 };
        return next;
      }
      return [...c, {
        itemId: item.id, name: item.name, qty: 1,
        price: item.price, station: item.station, course: item.course,
        allergens: item.allergens ?? [],
        notes: '', status: 'pending'
      }];
    });
  };
  const setQty = (i, q) => setCart(c => c.map((l, j) => j === i ? { ...l, qty: q } : l));
  const removeLine = (i) => setCart(c => c.filter((_, j) => j !== i));

  // Add a pre-configured line (from modifier picker) — always a new line so
  // identical items with different selections stay separate
  const addLine = (line) => setCart(c => [...c, line]);

  // ── Modify already-sent items (edit order in Firestore directly) ─────
  const modifySentItem = async (sentIndex, newQty) => {
    const existing = orderForTable(openTable?.id);
    if (!existing) return;
    const items = [...(existing.items || [])];
    if (sentIndex < 0 || sentIndex >= items.length) return;
    items[sentIndex] = { ...items[sentIndex], qty: newQty };
    const totals = calcTotals(items);
    await updateOrder(existing.id, { items, ...totals });
    showToast('Order updated');
  };

  const removeSentItem = async (sentIndex) => {
    const existing = orderForTable(openTable?.id);
    if (!existing) return;
    const items = (existing.items || []).filter((_, i) => i !== sentIndex);
    if (items.length === 0) {
      // Remove the whole order if nothing left
      await updateOrder(existing.id, { status: 'voided', items: [] });
      await updateTableStatus(openTable.id, 'free');
      handleCloseEditor();
      showToast('Order removed');
      return;
    }
    const totals = calcTotals(items);
    await updateOrder(existing.id, { items, ...totals });
    showToast('Item removed');
  };

  // ── Send to kitchen ──────────────────────────────────────────────────
  const handleSend = async () => {
    if (!openTable || cart.length === 0) return;

    const existing = orderForTable(openTable.id);
    const sentCart = cart.map(l => ({ ...l, status: 'sent' }));

    if (existing) {
      const items = [...(existing.items || []), ...sentCart];
      const totals = calcTotals(items);
      await sendOrderToKitchen(existing.id, items, totals);
      if (allergyNote.trim() && allergyNote.trim() !== (existing.allergyNote || '')) {
        await updateOrder(existing.id, { allergyNote: allergyNote.trim() });
      }
    } else {
      const orderId = await createOrder({
        tableId: openTable.id,
        tableNumber: openTable.number,
        orderType: 'dine-in',
        openedBy: device.user.id,
        items: [],
        ...(allergyNote.trim() ? { allergyNote: allergyNote.trim() } : {})
      });
      const totals = calcTotals(sentCart);
      await sendOrderToKitchen(orderId, sentCart, totals);
    }
    await updateTableStatus(openTable.id, 'ordering');
    setCart([]);
    showToast(`Sent ${cart.length} item${cart.length === 1 ? '' : 's'} to kitchen`);
  };

  // ── Mark served (after ready in KDS) ─────────────────────────────────
  const handleMarkServed = async () => {
    if (!openTable) return;
    await updateTableStatus(openTable.id, 'served');
    showToast('Table marked served');
  };

  // ── Flag for billing → till sees it ──────────────────────────────────
  const handleSendToBilling = async () => {
    if (!openTable) return;
    await updateTableStatus(openTable.id, 'billing');
    showToast('Sent to Till for payment');
    handleCloseEditor();
  };

  // ── Void order ────────────────────────────────────────────────────────
  const handleVoid = async () => {
    const existing = orderForTable(openTable?.id);
    if (!existing) return;
    await updateOrder(existing.id, {
      status: 'voided',
      voidedAt: new Date(),
      clearedFromKitchen: true
    });
    await updateTableStatus(openTable.id, 'free');
    setCart([]);
    setShowVoidConfirm(false);
    handleCloseEditor();
    showToast('Order voided', 'error');
  };

  // ── Render: editor or grid ───────────────────────────────────────────
  if (openTable) {
    const existing = orderForTable(openTable.id);
    return (
      <>
        {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
        <OrderPane
          cartItems={cart}
          sentItems={existing?.items || []}
          onAdd={addToCart}
          onAddLine={addLine}
          onQtyChange={setQty}
          onRemove={removeLine}
          onModifySent={modifySentItem}
          onRemoveSent={removeSentItem}
          header={
            <div className="cart-head">
              <div className="tbl">Table <b>{openTable.number}</b></div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  className={`btn-sm ${allergyNote.trim() ? 'btn btn-danger' : 'btn'}`}
                  onClick={() => setShowAllergy(true)}
                  title="Flag a customer allergy for the kitchen"
                  style={{ fontSize: 11 }}
                >⚠ {allergyNote.trim() ? 'Allergy ✓' : 'Allergy'}</button>
                {existing && (
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => setShowVoidConfirm(true)}
                  >🚫 Void</button>
                )}
                <button className="btn-ghost" onClick={handleCloseEditor}>← Back</button>
              </div>
            </div>
          }
          footer={
            <div className="cart-actions">
              <button
                className="btn"
                disabled={!existing || existing.status !== 'ready'}
                onClick={handleMarkServed}
              >Mark Served</button>
              {cart.length > 0 ? (
                <button className="btn btn-primary" onClick={handleSend}>Send to Kitchen</button>
              ) : (
                <button
                  className="btn btn-primary"
                  disabled={!existing}
                  onClick={handleSendToBilling}
                >Bill at Till →</button>
              )}
            </div>
          }
        />
        {showVoidConfirm && existing && (
          <VoidConfirmModal
            order={existing}
            onCancel={() => setShowVoidConfirm(false)}
            onConfirm={handleVoid}
          />
        )}
        {showAllergy && (
          <AllergyNoteModal
            note={allergyNote}
            activeOrder={existing}
            onSave={async (note) => {
              setAllergyNote(note);
              if (existing) {
                await updateOrder(existing.id, { allergyNote: note.trim() || null });
                showToast(note.trim() ? '⚠ Allergy sent to kitchen' : 'Allergy note cleared');
              }
              setShowAllergy(false);
            }}
            onClose={() => setShowAllergy(false)}
          />
        )}
      </>
    );
  }

  return (
    <div className="floor">
      <StockAlertBanner />
      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
      <div className="floor-toolbar">
        <div className="zone-tabs">
          {zones.map(z => (
            <button key={z} className={zone === z ? 'active' : ''} onClick={() => setZone(z)}>{z}</button>
          ))}
        </div>
        <div className="floor-stats">
          <span>Free: <b>{tables.filter(t => t.status === 'free').length}</b></span>
          <span>Occupied: <b>{tables.filter(t => t.status !== 'free').length}</b></span>
          {upcomingBookings.length > 0 && (
            <button
              onClick={() => setShowBookings(!showBookings)}
              style={{
                padding: '6px 12px',
                background: showBookings ? 'var(--surface-3)' : 'var(--blue-deep)',
                color: 'var(--blue)',
                border: '1px solid rgba(96,165,250,0.3)',
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: '0.02em'
              }}
            >
              📅 {upcomingBookings.length} booking{upcomingBookings.length === 1 ? '' : 's'} upcoming
            </button>
          )}
        </div>
      </div>

      {showBookings && upcomingBookings.length > 0 && (
        <div className="booking-strip">
          {upcomingBookings.map(b => {
            const tbl = tables.find(t => t.id === b.tableId);
            const late = isLate(b);
            return (
              <div key={b.id} className={`booking-card ${late ? 'late' : ''}`}>
                <div className="time">{b.time}</div>
                <div className="who">
                  <div className="name">{b.name}</div>
                  <div className="meta">
                    ×{b.party}
                    {tbl && ` · T${tbl.number}`}
                    {b.occasion && <span style={{ color: 'var(--violet)', marginLeft: 6 }}>🎉 {b.occasion}</span>}
                  </div>
                  {b.notes && <div className="notes">↳ {b.notes}</div>}
                </div>
                <button
                  className="btn btn-success"
                  style={{ padding: '8px 14px', fontSize: 12 }}
                  onClick={async () => {
                    await updateBooking(b.id, { status: 'arrived' });
                    if (b.tableId) await updateTableStatus(b.tableId, 'seated');
                    showToast(`${b.name} marked arrived`);
                  }}
                >Arrived →</button>
              </div>
            );
          })}
        </div>
      )}

      <div className="table-grid">
        {visibleTables.map(t => {
          const o = orderForTable(t.id);
          const total = o?.total || (o?.items || []).reduce((s, l) => s + l.price * l.qty, 0);
          const waitMins = o?.sentAt ? Math.floor((Date.now() - o.sentAt.toMillis()) / 60000) : null;
          const isOverdue = waitMins !== null && waitMins >= alertMins;
          const isWarning = waitMins !== null && waitMins >= alertMins * 0.6 && !isOverdue;
          return (
            <button
              key={t.id}
              className={`table-card ${t.status}${isOverdue ? ' table-overdue' : isWarning ? ' table-warning' : ''}`}
              onClick={() => handleOpenTable(t)}
            >
              <div className="head">
                <span className="num">{t.number}</span>
                <span className="status-dot" />
              </div>
              <div className="body">
                <div className="row"><span>{t.zone}</span><span className="seats">{t.seats} seats</span></div>
                {o && (
                  <div className="row"><span>{(o.items || []).length} items</span><span className="total">${total.toFixed(2)}</span></div>
                )}
                {/* Wait time */}
                {waitMins !== null && (
                  <div className={`table-wait${isOverdue ? ' overdue' : isWarning ? ' warning' : ''}`}>
                    ⏱ {waitMins}m waiting
                  </div>
                )}
                <div className="status-label">{statusLabel(t.status, o)}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function statusLabel(s, o) {
  if (o?.status === 'ready') return 'Food ready';
  if (o?.status === 'preparing') return 'Cooking';
  if (o?.status === 'sent') return 'Order sent';
  return s.toUpperCase();
}

function calcTotals(items) {
  const subtotal = items.reduce((s, l) => s + l.price * l.qty, 0);
  const total = +subtotal.toFixed(2);
  const gst = +(subtotal * (10 / 110)).toFixed(2);
  return { subtotal: +subtotal.toFixed(2), gst, total };
}

function isLate(booking) {
  const [h, m] = (booking.time || '00:00').split(':').map(Number);
  const bookingTime = new Date();
  bookingTime.setHours(h, m, 0, 0);
  return Date.now() > bookingTime.getTime();
}
