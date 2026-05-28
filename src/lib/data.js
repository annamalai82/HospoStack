// Data access layer for HospoStack
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
  query, where, orderBy, onSnapshot, serverTimestamp, writeBatch,
  deleteDoc, increment
} from 'firebase/firestore';
import { db, functions } from './firebase';
import { httpsCallable } from 'firebase/functions';

// Active venue ID — runtime-mutable to support multi-venue.
// Lives in localStorage under 'hospostack.venueId'.
const VENUE_KEY = 'hospostack.venueId';
const DEFAULT_VENUE = 'sizzle-n-sambar';

let _venueId = (typeof localStorage !== 'undefined' && localStorage.getItem(VENUE_KEY)) || DEFAULT_VENUE;

export function getVenueId() { return _venueId; }
export function setVenueId(id) {
  _venueId = id;
  try { localStorage.setItem(VENUE_KEY, id); } catch {}
}

// Backwards-compat for any code still importing VENUE_ID as a constant.
// New code should call getVenueId().
export { _venueId as VENUE_ID };

const venueRef = () => doc(db, 'venues', _venueId);
const col = (name) => collection(db, 'venues', _venueId, name);

// List all venues (top-level collection) — for the picker.
export async function listVenues() {
  const snap = await getDocs(collection(db, 'venues'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function watchVenues(cb) {
  return onSnapshot(collection(db, 'venues'), s => {
    cb(s.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

export async function createVenueDoc(id, data) {
  const batch = writeBatch(db);

  // Venue doc
  batch.set(doc(db, 'venues', id), {
    ...data,
    createdAt: serverTimestamp()
  });

  // A default manager so someone can actually sign in to set things up
  batch.set(doc(db, 'venues', id, 'users', 'manager'), {
    name: 'Default Manager',
    role: 'manager',
    pin: '1234',
    active: true
  });

  await batch.commit();
}

// ── Venue ──────────────────────────────────────────────────────────────────
export async function getVenue() {
  const snap = await getDoc(venueRef());
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ── Users / PIN auth ───────────────────────────────────────────────────────
export async function listUsers() {
  const snap = await getDocs(col('users'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function findUserByPin(pin) {
  const snap = await getDocs(query(col('users'), where('pin', '==', pin), where('active', '==', true)));
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

/** Get all active users who have a face descriptor enrolled.
 *  Used by face-first login to match a captured face against any enrolled staff. */
export async function getUsersWithFaceEnrolled() {
  const snap = await getDocs(query(col('users'), where('active', '==', true)));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(u => Array.isArray(u.faceDescriptor) && u.faceDescriptor.length === 128);
}

// ── Geofence override (manager-authorized temporary bypass) ────────────────
// 
// Overrides are stored in sessionStorage (per-tab, clears on browser close)
// AND logged to Firestore for audit. The Firestore log is append-only.
//
// Override doc shape:
//   {
//     id, userId, userName, userRole,
//     reason, duration (ms), expiresAt (ms timestamp),
//     deviceName, mode,
//     grantedAt (server timestamp),
//     // optional geolocation snapshot at the time of grant
//     locationAtGrant: { lat, lng, accuracy } | null,
//     distanceMeters: number | null,  // distance from venue at grant
//   }

const OVERRIDE_KEY = 'hospostack.geofenceOverride';

/** Read the current active override from sessionStorage (returns null if none / expired) */
export function readGeofenceOverride() {
  try {
    const raw = sessionStorage.getItem(OVERRIDE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o?.expiresAt || Date.now() > o.expiresAt) {
      sessionStorage.removeItem(OVERRIDE_KEY);
      return null;
    }
    return o;
  } catch { return null; }
}

/** Clear the active override (used by manager Cancel Override button) */
export function clearGeofenceOverride() {
  try { sessionStorage.removeItem(OVERRIDE_KEY); } catch {}
}

/** Grant an override — stores locally + writes audit log to Firestore.
 *  Returns the override object.
 */
export async function grantGeofenceOverride({
  user, durationMs, reason, deviceName, mode,
  locationAtGrant = null, distanceMeters = null,
}) {
  if (!user || user.role !== 'manager') {
    throw new Error('Only managers can override the geofence');
  }
  const now = Date.now();
  const override = {
    userId:        user.id,
    userName:      user.name,
    userRole:      user.role,
    reason:        (reason || '').trim() || '(no reason given)',
    durationMs,
    grantedAtMs:   now,
    expiresAt:     now + durationMs,
    deviceName:    deviceName || '',
    mode:          mode || '',
    locationAtGrant,
    distanceMeters,
  };

  // Write audit log (append-only — never updated or deleted)
  try {
    await addDoc(col('geofence_audit'), {
      ...override,
      grantedAt: serverTimestamp(),
      action: 'grant',
    });
  } catch (e) {
    // If audit fails, still allow the override but warn
    console.warn('Audit log write failed (override still active):', e);
  }

  // Save locally so other components can see it
  sessionStorage.setItem(OVERRIDE_KEY, JSON.stringify(override));
  return override;
}

/** Subscribe to the geofence audit log — for the audit panel in Config Mode. */
export function watchGeofenceAudit(cb, limitDays = 30) {
  const since = Date.now() - (limitDays * 24 * 60 * 60 * 1000);
  return onSnapshot(
    query(col('geofence_audit'), orderBy('grantedAtMs', 'desc')),
    s => cb(s.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(o => (o.grantedAtMs || 0) >= since)
    )
  );
}

// ── Menu ───────────────────────────────────────────────────────────────────
export function watchCategories(cb) {
  return onSnapshot(query(col('menu_categories'), orderBy('order')), s => {
    cb(s.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

export function watchMenuItems(cb) {
  return onSnapshot(query(col('menu_items'), where('active', '==', true)), s => {
    cb(s.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

// ── 86 / Out-of-stock alerts ────────────────────────────────────────────────
//
// The kitchen can "86" an item (restaurant slang for out-of-stock). This:
//   1. Sets outOfStock=true on the menu item → it shows as unavailable in
//      Till/Floor and can't be added to new orders
//   2. Writes an entry to the '86_alerts' collection → an instant banner +
//      beep fires on every Floor and Till device
//
// Re-stocking ("un-86") flips outOfStock back to false and logs a restock
// alert so staff know it's available again.

/** Mark an item out of stock (86) or back in stock. Writes an alert either way. */
export async function set86Status(item, outOfStock, byName = 'Kitchen') {
  // Update the item flag
  await updateDoc(doc(db, 'venues', _venueId, 'menu_items', item.id), {
    outOfStock,
    outOfStockAt: outOfStock ? serverTimestamp() : null,
  });
  // Write an alert for floor/till devices to pick up
  await addDoc(col('stock_alerts'), {
    itemId:   item.id,
    itemName: item.name,
    action:   outOfStock ? '86' : 'restock',
    byName,
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
  });
}

/** Watch recent 86/restock alerts (last 15 min) for the floor/till banner. */
export function watchStockAlerts(cb, windowMins = 15) {
  return onSnapshot(
    query(col('stock_alerts'), orderBy('createdAtMs', 'desc')),
    s => {
      const since = Date.now() - windowMins * 60_000;
      cb(s.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(a => (a.createdAtMs || 0) >= since)
      );
    }
  );
}

// ── Tables ─────────────────────────────────────────────────────────────────
export function watchTables(cb) {
  return onSnapshot(query(col('tables'), orderBy('number')), s => {
    cb(s.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

export async function updateTableStatus(tableId, status) {
  await updateDoc(doc(db, 'venues', _venueId, 'tables', tableId), { status });
}

// ── Orders ─────────────────────────────────────────────────────────────────
export function watchOpenOrders(cb) {
  return onSnapshot(
    query(col('orders'), where('status', 'in', ['open', 'sent', 'preparing', 'ready', 'served'])),
    s => cb(s.docs.map(d => ({ id: d.id, ...d.data() })))
  );
}

export function watchKitchenOrders(cb) {
  return onSnapshot(
    query(col('orders'), where('status', 'in', ['sent', 'preparing', 'ready'])),
    s => cb(s.docs.map(d => ({ id: d.id, ...d.data() })))
  );
}

export function watchOrderById(orderId, cb) {
  return onSnapshot(doc(db, 'venues', _venueId, 'orders', orderId), s => {
    if (s.exists()) cb({ id: s.id, ...s.data() });
  });
}

// Firestore rejects writes containing `undefined`. Cart lines built from menu
// items that are missing `station` / `course` / `selections` / etc. carry those
// `undefined` values straight into Firestore and the whole updateDoc throws —
// which (when uncaught) leaves an orphan order doc with no items attached. This
// helper deep-strips undefined fields from a value before it goes to Firestore.
export function stripUndefined(value) {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === 'object' && !value.toMillis) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out;
  }
  return value;
}

export async function createOrder(payload) {
  const clean = stripUndefined(payload);
  const ref = await addDoc(col('orders'), {
    ...clean,
    status: 'open',
    items: clean.items || [],
    subtotal: 0, gst: 0, total: 0, paid: 0,
    payments: [],
    openedAt: serverTimestamp()
  });
  return ref.id;
}

export async function updateOrder(orderId, patch) {
  await updateDoc(doc(db, 'venues', _venueId, 'orders', orderId), stripUndefined(patch));
}

export async function sendOrderToKitchen(orderId, items, totals) {
  // Stamp any item that hasn't been sent yet with the current batch timestamp.
  // The KDS uses sentBatch to highlight items added in a LATER batch than the
  // ticket's original send (i.e. additions to an existing table order).
  const batchTs = Date.now();
  const stamped = (items || []).map(it =>
    it.sentBatch ? it : { ...it, sentBatch: batchTs }
  );
  await updateDoc(doc(db, 'venues', _venueId, 'orders', orderId), {
    items: stripUndefined(stamped),
    ...stripUndefined(totals),
    status: 'sent',
    sentAt: serverTimestamp(),
    lastBatchAt: batchTs,
  });
}

/**
 * Create a new order AND mark it as sent-to-kitchen in a single atomic batch.
 * Use this for the "new order → send to kitchen" flow so we never get an
 * orphan order doc when the items-write fails midway. Returns the new orderId.
 */
export async function createAndSendOrder(payload, items, totals) {
  const orderRef = doc(col('orders'));
  const batch = writeBatch(db);
  const clean = stripUndefined(payload);
  const batchTs = Date.now();
  const stamped = (items || []).map(it => it.sentBatch ? it : { ...it, sentBatch: batchTs });
  batch.set(orderRef, {
    ...clean,
    items: stripUndefined(stamped) || [],
    ...stripUndefined(totals),
    paid: 0,
    payments: [],
    status: 'sent',
    openedAt: serverTimestamp(),
    sentAt: serverTimestamp(),
    lastBatchAt: batchTs,
  });
  await batch.commit();
  return orderRef.id;
}

/**
 * Clean up orphan orders — those still status='open' with zero items and
 * older than `olderThanMins`. Marks them as voided so they disappear from
 * the Open Tabs sidebar without affecting reporting.
 */
export async function cleanupOrphanOrders(olderThanMins = 30) {
  const snap = await getDocs(query(col('orders'), where('status', '==', 'open')));
  const cutoff = Date.now() - olderThanMins * 60000;
  const batch = writeBatch(db);
  let count = 0;
  snap.docs.forEach(d => {
    const o = d.data();
    const items = o.items || [];
    const openedMs = o.openedAt?.toMillis?.() || 0;
    if (items.length === 0 && openedMs < cutoff) {
      batch.update(d.ref, { status: 'voided', voidedAt: serverTimestamp(), voidReason: 'orphan-empty' });
      count++;
    }
  });
  if (count > 0) await batch.commit();
  return count;
}

export async function bumpOrderItem(orderId, itemIndex, newStatus, items) {
  const updated = [...items];
  updated[itemIndex] = { ...updated[itemIndex], status: newStatus };
  const allReady = updated.every(i => i.status === 'ready' || i.status === 'served');
  await updateDoc(doc(db, 'venues', _venueId, 'orders', orderId), {
    items: updated,
    ...(allReady ? { status: 'ready' } : { status: 'preparing' })
  });
}

export async function settleOrder(orderId, payments, total, customer = null) {
  const patch = {
    payments,
    paid: total,
    status: 'paid',
    paidAt: serverTimestamp(),
    // Defensive: also stamp a flag so any stale subscriber filters on it
    clearedFromKitchen: true
  };
  if (customer) patch.customer = customer;
  await updateDoc(doc(db, 'venues', _venueId, 'orders', orderId), patch);

  // Now that the order is locked in as paid, commit any voucher redemptions
  // (decrement balances, increment usedCount). If this fails it's not fatal —
  // the order is paid, just a follow-up reconciliation may be needed.
  const voucherPayments = payments.filter(p => p.method === 'voucher' && p.code);
  if (voucherPayments.length > 0) {
    try {
      await commitVoucherRedemptions(voucherPayments);
    } catch (e) {
      console.warn('Voucher commit failed (order still settled):', e);
    }
  }
}

// ── Customer DB (built up from order receipts) ─────────────────────────────
// Each customer is keyed by their email or phone (whichever is present),
// so subsequent orders for the same person accumulate.
export async function upsertCustomer({ name, email, phone }) {
  // Prefer email as key, else phone — slugified.
  const key = (email || phone || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
  if (!key) return null;

  const ref = doc(db, 'venues', _venueId, 'customers', key);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    await updateDoc(ref, {
      name: name || snap.data().name,
      email: email || snap.data().email,
      phone: phone || snap.data().phone,
      lastSeenAt: serverTimestamp(),
      orderCount: increment(1),
      marketingOptIn: snap.data().marketingOptIn ?? true
    });
  } else {
    await setDoc(ref, {
      name: name || '', email: email || '', phone: phone || '',
      firstSeenAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
      orderCount: 1,
      marketingOptIn: true
    });
  }
  return key;
}

export function watchCustomers(cb) {
  return onSnapshot(collection(db, 'venues', _venueId, 'customers'), s => {
    cb(s.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

// ── Receipt delivery records (Cloud Function logs delivery here) ────────────
export async function queueReceiptDelivery(orderId, customer) {
  // Cloud Function listens on this collection and sends email/SMS.
  // Returns the new delivery doc ID so the UI can watch for status updates.
  const ref = await addDoc(col('receipt_deliveries'), {
    orderId,
    customer,
    status: 'queued',
    createdAt: serverTimestamp()
  });
  return ref.id;
}

// Watch a single receipt_delivery doc for status changes
export function watchReceiptDelivery(deliveryId, cb) {
  return onSnapshot(
    doc(db, 'venues', _venueId, 'receipt_deliveries', deliveryId),
    snap => { if (snap.exists()) cb({ id: snap.id, ...snap.data() }); }
  );
}

// Fetch all receipt deliveries for a given orderId (for Reports)
export async function getReceiptDeliveriesForOrder(orderId) {
  const snap = await getDocs(
    query(col('receipt_deliveries'), where('orderId', '==', orderId))
  );
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Manually resend a receipt — calls the resendReceipt Cloud Function which
// queues a fresh receipt_deliveries doc that re-triggers deliverReceipt.
// Pass customer to override the contact details (e.g. corrected email).
export async function resendReceipt(orderId, customer = null) {
  const callable = httpsCallable(functions, 'resendReceipt');
  const res = await callable({ venueId: _venueId, orderId, customer });
  return res.data; // { ok: true, deliveryId }
}

// Check whether the Cloud Function is deployed and secrets are configured.
// Returns { deployed: bool, email: {configured, from}, sms: {configured, from} }
export async function checkReceiptSetup() {
  try {
    const callable = httpsCallable(functions, 'checkReceiptSetup');
    const res = await callable();
    return { deployed: true, ...res.data };
  } catch (e) {
    // FUNCTIONS_NOT_FOUND means not deployed; other errors = auth/network
    const notDeployed = e.code === 'functions/not-found' ||
      e.message?.includes('NOT_FOUND') || e.message?.includes('not found');
    return { deployed: false, notDeployed, error: e.message };
  }
}

// ── Bookings ───────────────────────────────────────────────────────────────
// Shape:
//   { id, customerKey?, name, phone, email,
//     date: 'YYYY-MM-DD', time: 'HH:MM', durationMins, party,
//     tableId?, status: 'pending'|'confirmed'|'arrived'|'no-show'|'cancelled',
//     notes, occasion, source: 'phone'|'walk-up'|'online',
//     createdBy, createdAt, updatedAt }
export function watchBookingsForDate(date, cb) {
  return onSnapshot(
    query(col('bookings'), where('date', '==', date)),
    s => {
      const rows = s.docs.map(d => ({ id: d.id, ...d.data() }));
      rows.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
      cb(rows);
    }
  );
}

export function watchUpcomingBookings(cb) {
  const today = new Date().toISOString().slice(0, 10);
  return onSnapshot(
    query(col('bookings'), where('date', '>=', today)),
    s => {
      const rows = s.docs.map(d => ({ id: d.id, ...d.data() }));
      rows.sort((a, b) => {
        const d = (a.date || '').localeCompare(b.date || '');
        return d !== 0 ? d : (a.time || '').localeCompare(b.time || '');
      });
      cb(rows);
    }
  );
}

export async function createBooking(payload) {
  const ref = await addDoc(col('bookings'), {
    status: 'confirmed',
    source: 'phone',
    ...payload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return ref.id;
}

export async function updateBooking(bookingId, patch) {
  await updateDoc(doc(db, 'venues', _venueId, 'bookings', bookingId), {
    ...patch,
    updatedAt: serverTimestamp()
  });
}

export async function deleteBooking(bookingId) {
  await deleteDoc(doc(db, 'venues', _venueId, 'bookings', bookingId));
}

// Settings stored under venue doc
export async function updateBookingSettings(patch) {
  await updateDoc(venueRef(), { booking: patch });
}

// Lookup existing customer by phone/email for booking pre-fill
export async function findCustomerByContact({ email, phone }) {
  const key = (email || phone || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
  if (!key) return null;
  const snap = await getDoc(doc(db, 'venues', _venueId, 'customers', key));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ── Vouchers ───────────────────────────────────────────────────────────────
// Two kinds:
//   - 'giftcard': starts with `value`, decrements `balance` as redeemed (partial OK)
//   - 'promo':    fixed-percentage OR fixed-amount discount, single or multi-use
//
// Shape:
//   { code, kind, value, balance, percentOff?, amountOff?,
//     active, expiresAt?, maxUses?, usedCount,
//     issuedTo?, issuedToContact?, createdAt, lastUsedAt? }
export function watchVouchers(cb) {
  return onSnapshot(col('vouchers'), s => {
    const rows = s.docs.map(d => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    cb(rows);
  });
}

export async function createVoucher(payload) {
  // Code stored uppercase + trimmed; also used as doc ID for fast lookup
  const code = (payload.code || '').toUpperCase().trim();
  if (!code) throw new Error('Code is required');

  const existing = await getDoc(doc(db, 'venues', _venueId, 'vouchers', code));
  if (existing.exists()) throw new Error('That code already exists');

  await setDoc(doc(db, 'venues', _venueId, 'vouchers', code), {
    code,
    kind: payload.kind || 'giftcard',
    value: payload.value || 0,
    balance: payload.kind === 'giftcard' ? (payload.value || 0) : null,
    percentOff: payload.percentOff || null,
    amountOff: payload.amountOff || null,
    active: payload.active !== false,
    expiresAt: payload.expiresAt || null,
    maxUses: payload.maxUses || null,
    usedCount: 0,
    issuedTo: payload.issuedTo || null,
    issuedToContact: payload.issuedToContact || null,
    createdAt: serverTimestamp()
  });
  return code;
}

export async function updateVoucher(code, patch) {
  await updateDoc(doc(db, 'venues', _venueId, 'vouchers', code), patch);
}

export async function deleteVoucher(code) {
  await deleteDoc(doc(db, 'venues', _venueId, 'vouchers', code));
}

export async function lookupVoucher(code) {
  const normalized = (code || '').toUpperCase().trim();
  if (!normalized) return null;
  const snap = await getDoc(doc(db, 'venues', _venueId, 'vouchers', normalized));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Calculate what a voucher would apply to an order, WITHOUT mutating it.
// Used at apply-time in the pay screen so the customer can cancel without
// burning the voucher. The actual decrement happens in commitVoucherRedemptions
// when the order settles.
export async function previewVoucherRedemption(code, requestedAmount, orderTotal) {
  const voucher = await lookupVoucher(code);
  if (!voucher) throw new Error('Voucher not found');
  if (!voucher.active) throw new Error('This voucher is inactive');
  if (voucher.expiresAt && new Date(voucher.expiresAt) < new Date()) {
    throw new Error('This voucher has expired');
  }
  if (voucher.maxUses && voucher.usedCount >= voucher.maxUses) {
    throw new Error('This voucher has been fully used');
  }

  let applied = 0;
  if (voucher.kind === 'giftcard') {
    const available = voucher.balance ?? 0;
    if (available <= 0) throw new Error('Gift card has no balance');
    applied = Math.min(available, requestedAmount, orderTotal);
  } else if (voucher.kind === 'promo') {
    if (voucher.percentOff) {
      applied = +(orderTotal * (voucher.percentOff / 100)).toFixed(2);
    } else if (voucher.amountOff) {
      applied = Math.min(voucher.amountOff, orderTotal);
    }
  }

  applied = +applied.toFixed(2);
  if (applied <= 0) throw new Error('Voucher applies no discount to this order');

  return { applied, code: voucher.code, kind: voucher.kind };
}

// Commit a batch of voucher redemptions (decrements balance, increments usedCount).
// Called from settleOrder when payment completes.
export async function commitVoucherRedemptions(voucherPayments) {
  for (const p of voucherPayments) {
    if (!p.code || p.method !== 'voucher') continue;
    const voucher = await lookupVoucher(p.code);
    if (!voucher) continue; // already gone, skip silently
    const patch = {
      usedCount: (voucher.usedCount || 0) + 1,
      lastUsedAt: serverTimestamp()
    };
    if (voucher.kind === 'giftcard') {
      patch.balance = +((voucher.balance ?? 0) - p.amount).toFixed(2);
    }
    await updateDoc(doc(db, 'venues', _venueId, 'vouchers', voucher.code), patch);
  }
}

// Legacy alias — kept for any code still referencing it. Same behaviour as preview.
export const redeemVoucher = previewVoucherRedemption;

// ── User CRUD (manager-only) ───────────────────────────────────────────────
export function watchUsers(cb) {
  return onSnapshot(col('users'), s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))));
}

export async function createUser(payload) {
  const ref = await addDoc(col('users'), { ...payload, active: true });
  return ref.id;
}

export async function updateUser(userId, patch) {
  await updateDoc(doc(db, 'venues', _venueId, 'users', userId), patch);
}

export async function deleteUser(userId) {
  await deleteDoc(doc(db, 'venues', _venueId, 'users', userId));
}

export async function pinIsUnique(pin, excludeUserId = null) {
  const snap = await getDocs(query(col('users'), where('pin', '==', pin)));
  return snap.docs.every(d => d.id === excludeUserId);
}

// ── Menu category CRUD ─────────────────────────────────────────────────────
export async function createCategory(payload) {
  const ref = await addDoc(col('menu_categories'), { active: true, ...payload });
  return ref.id;
}

export async function updateCategory(catId, patch) {
  await updateDoc(doc(db, 'venues', _venueId, 'menu_categories', catId), patch);
}

export async function deleteCategory(catId) {
  await deleteDoc(doc(db, 'venues', _venueId, 'menu_categories', catId));
}

// ── Modifier group CRUD ────────────────────────────────────────────────────
// Shape: { id, name, type: 'single'|'multi', required, minSelect, maxSelect,
//          options: [{ id, label, priceDelta }] }
export function watchModifierGroups(cb) {
  return onSnapshot(col('modifier_groups'), s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))));
}

export async function createModifierGroup(payload) {
  const ref = await addDoc(col('modifier_groups'), payload);
  return ref.id;
}

export async function updateModifierGroup(groupId, patch) {
  await updateDoc(doc(db, 'venues', _venueId, 'modifier_groups', groupId), patch);
}

export async function deleteModifierGroup(groupId) {
  await deleteDoc(doc(db, 'venues', _venueId, 'modifier_groups', groupId));
}

// ── Menu item CRUD (incl. inactive) ────────────────────────────────────────
export function watchAllMenuItems(cb) {
  return onSnapshot(col('menu_items'), s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))));
}

export async function createMenuItem(payload) {
  const ref = await addDoc(col('menu_items'), { taxPct: 10, active: true, ...payload });
  return ref.id;
}

export async function createMenuCategory(payload) {
  const ref = await addDoc(col('menu_categories'), { active: true, ...payload });
  return ref.id;
}

export async function updateMenuCategory(catId, patch) {
  await updateDoc(doc(db, 'venues', _venueId, 'menu_categories', catId), patch);
}

export async function deleteMenuCategory(catId) {
  await deleteDoc(doc(db, 'venues', _venueId, 'menu_categories', catId));
}

export async function updateMenuItem(itemId, patch) {
  await updateDoc(doc(db, 'venues', _venueId, 'menu_items', itemId), patch);
}

export async function deleteMenuItem(itemId) {
  await deleteDoc(doc(db, 'venues', _venueId, 'menu_items', itemId));
}

// Delete all menu items + all menu categories for this venue in batches
export async function deleteEntireMenu(onProgress) {
  const [itemsSnap, catsSnap] = await Promise.all([
    getDocs(col('menu_items')),
    getDocs(col('menu_categories'))
  ]);
  const allDocs = [...itemsSnap.docs, ...catsSnap.docs];
  if (allDocs.length === 0) return 0;

  // Firestore batch limit is 500 writes
  const CHUNK = 499;
  let deleted = 0;
  for (let i = 0; i < allDocs.length; i += CHUNK) {
    const batch = (await import('firebase/firestore')).writeBatch(db);
    allDocs.slice(i, i + CHUNK).forEach(d => batch.delete(d.ref));
    await batch.commit();
    deleted += Math.min(CHUNK, allDocs.length - i);
    onProgress?.(deleted, allDocs.length);
  }
  return allDocs.length;
}

// ── Table CRUD ─────────────────────────────────────────────────────────────
export async function createTable(payload) {
  const id = `t${payload.number}`;
  await setDoc(doc(db, 'venues', _venueId, 'tables', id), { status: 'free', ...payload });
  return id;
}

export async function updateTable(tableId, patch) {
  await updateDoc(doc(db, 'venues', _venueId, 'tables', tableId), patch);
}

export async function deleteTable(tableId) {
  await deleteDoc(doc(db, 'venues', _venueId, 'tables', tableId));
}

// ── Reports / settled orders ───────────────────────────────────────────────
export async function getSettledOrders({ from, to } = {}) {
  // We sort client-side to avoid composite-index requirements.
  const snap = await getDocs(query(col('orders'), where('status', '==', 'paid')));
  let rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (from) rows = rows.filter(r => (r.paidAt?.toMillis?.() || 0) >= from.getTime());
  if (to) rows = rows.filter(r => (r.paidAt?.toMillis?.() || 0) <= to.getTime());
  rows.sort((a, b) => (b.paidAt?.toMillis?.() || 0) - (a.paidAt?.toMillis?.() || 0));
  return rows;
}

export function watchSettledOrders(cb) {
  return onSnapshot(query(col('orders'), where('status', '==', 'paid')), s => {
    const rows = s.docs.map(d => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => (b.paidAt?.toMillis?.() || 0) - (a.paidAt?.toMillis?.() || 0));
    cb(rows);
  });
}

// ── Venue settings update ──────────────────────────────────────────────────
export async function extendOrderWait(orderId, extraMins) {
  // Push sentAt back by extraMins so the aging timer restarts
  const snap = await getDoc(doc(db, 'venues', _venueId, 'orders', orderId));
  if (!snap.exists()) return;
  const order = snap.data();
  const currentSentMs = order.sentAt?.toMillis?.() || Date.now();
  const newSentMs = currentSentMs + extraMins * 60 * 1000;
  const extensions = (order.waitExtensions || 0) + 1;
  await updateDoc(doc(db, 'venues', _venueId, 'orders', orderId), {
    sentAt: new Date(newSentMs),
    waitExtensions: extensions
  });
}

export async function updateVenue(patch) {
  await updateDoc(venueRef(), patch);
}

// Update full venue details (name, abn, gstPct, timezone, phone, address)
export async function updateVenueDetails(venueId, patch) {
  await updateDoc(doc(db, 'venues', venueId), patch);
}

// Delete a venue and ALL its sub-collections (menu, orders, tables, users…)
// WARNING: irreversible. Sub-collections must be deleted manually in batches
// since Firestore doesn't cascade-delete sub-collections.
export async function deleteVenue(venueId) {
  const SUB = [
    'menu_items', 'menu_categories', 'modifier_groups',
    'tables', 'users', 'orders', 'customers',
    'bookings', 'vouchers', 'sessions',
    'receipt_deliveries'
  ];

  const CHUNK = 400;
  for (const sub of SUB) {
    let hasMore = true;
    while (hasMore) {
      const snap = await getDocs(collection(db, 'venues', venueId, sub));
      if (snap.empty) { hasMore = false; break; }
      for (let i = 0; i < snap.docs.length; i += CHUNK) {
        const b = writeBatch(db);
        snap.docs.slice(i, i + CHUNK).forEach(d => b.delete(d.ref));
        await b.commit();
      }
      if (snap.docs.length < CHUNK) hasMore = false;
    }
  }

  // Finally delete the venue doc itself
  await deleteDoc(doc(db, 'venues', venueId));
}

// Watch venue for real-time settings (used by KDS, Floor, Till for threshold)
export function watchVenue(cb) {
  return onSnapshot(venueRef(), s => {
    if (s.exists()) cb({ id: s.id, ...s.data() });
  });
}

// ── Sessions ───────────────────────────────────────────────────────────────
export async function openSession(deviceMode, deviceName, userId) {
  const ref = await addDoc(col('sessions'), {
    deviceMode, deviceName, openedBy: userId,
    openedAt: serverTimestamp(), closedAt: null
  });
  return ref.id;
}

export async function closeSession(sessionId) {
  await updateDoc(doc(db, 'venues', _venueId, 'sessions', sessionId), {
    closedAt: serverTimestamp()
  });
}

// ── Seeding ────────────────────────────────────────────────────────────────
export async function seedIfEmpty() {
  const venue = await getVenue();
  if (venue) return false; // already seeded

  const batch = writeBatch(db);

  batch.set(venueRef(), {
    name: 'Sizzle N Sambar',
    abn: '97668265683',
    gstPct: 10,
    timezone: 'Australia/Perth',
    currency: 'AUD',
    createdAt: serverTimestamp()
  });

  // Users
  const users = [
    { id: 'manager', name: 'Default Manager', role: 'manager', pin: '1234', active: true },
    { id: 'gowri', name: 'Gowri Narayanaswamy', role: 'manager', pin: '4321', active: true },
    { id: 'clerk001', name: 'Clerk 001', role: 'waiter', pin: '1111', active: true },
    { id: 'kds01', name: 'Kitchen', role: 'kitchen', pin: '2222', active: true },
    { id: 'till01', name: 'Till', role: 'cashier', pin: '3333', active: true }
  ];
  users.forEach(u => {
    const { id, ...rest } = u;
    batch.set(doc(db, 'venues', _venueId, 'users', id), rest);
  });

  // ── Menu categories ────────────────────────────────────────────────────────
  const cats = [
    { id: 'veg-starters',   name: 'Veg Starters',              order: 1,  color: '#10b981' },
    { id: 'nonveg-starters',name: 'Non-Veg Starters',          order: 2,  color: '#ef4444' },
    { id: 'rice-noodles',   name: 'Rice & Noodles',            order: 3,  color: '#f59e0b' },
    { id: 'idiappam',       name: 'Idiappam (String Hoppers)',  order: 4,  color: '#8b5cf6' },
    { id: 'rice',           name: 'Rice',                       order: 5,  color: '#f59e0b' },
    { id: 'veg-mains',      name: 'Veg Mains',                 order: 6,  color: '#10b981' },
    { id: 'nonveg-mains',   name: 'Non-Veg Mains',             order: 7,  color: '#ef4444' },
    { id: 'biryani',        name: 'Biryani',                   order: 8,  color: '#8b5cf6' },
    { id: 'dosai',          name: 'Dosai',                     order: 9,  color: '#ec4899' },
    { id: 'idli',           name: 'Idli',                      order: 10, color: '#3b82f6' },
    { id: 'breads',         name: 'Breads',                    order: 11, color: '#6366f1' },
    { id: 'accompaniments', name: 'Accompaniments',            order: 12, color: '#14b8a6' },
    { id: 'desserts',       name: 'Desserts',                  order: 13, color: '#ec4899' },
    { id: 'drinks',         name: 'Drinks',                    order: 14, color: '#3b82f6' }
  ];
  cats.forEach(c => {
    const { id, ...rest } = c;
    batch.set(doc(db, 'venues', _venueId, 'menu_categories', id), { ...rest, active: true });
  });

  // ── Modifier groups ────────────────────────────────────────────────────────
  // For items where each protein/variant has a DIFFERENT price,
  // base price = cheapest option (Veg), other options show positive delta.
  // type: 'single' + required: true forces staff to choose before adding.

  // Fried Rice proteins: Veg $18.90 | Egg $18.90 | Chicken $21.00 | Prawn $23.90
  const friedRiceProteinId = 'mod-fried-rice-protein';
  batch.set(doc(db, 'venues', _venueId, 'modifier_groups', friedRiceProteinId), {
    name: 'Choose Protein',
    type: 'single',
    required: true,
    options: [
      { id: 'fr-veg',     label: 'Veg',     priceDelta: 0.00 },
      { id: 'fr-egg',     label: 'Egg',     priceDelta: 0.00 },
      { id: 'fr-chicken', label: 'Chicken', priceDelta: 2.10 },
      { id: 'fr-prawn',   label: 'Prawn',   priceDelta: 5.00 }
    ]
  });

  // Hakka / Schezwan Noodles: Veg $18.90 | Egg $18.90 | Mushroom $18.90 | Chicken $21.00 | Prawn $23.90
  const noodleProteinId = 'mod-noodle-protein';
  batch.set(doc(db, 'venues', _venueId, 'modifier_groups', noodleProteinId), {
    name: 'Choose Protein',
    type: 'single',
    required: true,
    options: [
      { id: 'nd-veg',      label: 'Veg',      priceDelta: 0.00 },
      { id: 'nd-egg',      label: 'Egg',       priceDelta: 0.00 },
      { id: 'nd-mushroom', label: 'Mushroom',  priceDelta: 0.00 },
      { id: 'nd-chicken',  label: 'Chicken',   priceDelta: 2.10 },
      { id: 'nd-prawn',    label: 'Prawn',     priceDelta: 5.00 }
    ]
  });

  // Noodle style: Hakka or Schezwan (no price diff)
  const noodleStyleId = 'mod-noodle-style';
  batch.set(doc(db, 'venues', _venueId, 'modifier_groups', noodleStyleId), {
    name: 'Noodle Style',
    type: 'single',
    required: true,
    options: [
      { id: 'ns-hakka',    label: 'Hakka',    priceDelta: 0 },
      { id: 'ns-schezwan', label: 'Schezwan', priceDelta: 0 }
    ]
  });

  // Idiappam curry pairing (no price diff)
  const idiappamCurryId = 'mod-idiappam-curry';
  batch.set(doc(db, 'venues', _venueId, 'modifier_groups', idiappamCurryId), {
    name: 'Served With',
    type: 'single',
    required: true,
    options: [
      { id: 'ic-coconut', label: 'Coconut Milk', priceDelta: 0 },
      { id: 'ic-curry',   label: 'Spicy Curry',  priceDelta: 0 }
    ]
  });

  // Biryani protein: Veg $19.90 | Chicken $23.90 | Goat $25.90 | Prawn $26.90 | Fish $25.90
  const biryaniProteinId = 'mod-biryani-protein';
  batch.set(doc(db, 'venues', _venueId, 'modifier_groups', biryaniProteinId), {
    name: 'Choose Protein',
    type: 'single',
    required: true,
    options: [
      { id: 'br-veg',     label: 'Veg',     priceDelta: 0.00 },
      { id: 'br-chicken', label: 'Chicken', priceDelta: 4.00 },
      { id: 'br-goat',    label: 'Goat',    priceDelta: 6.00 },
      { id: 'br-prawn',   label: 'Prawn',   priceDelta: 7.00 },
      { id: 'br-fish',    label: 'Fish',    priceDelta: 6.00 }
    ]
  });

  // Dosai type (plain/masala/ghee — base Masala Dosai $15.90, Ghee Roast +$1)
  const dosaiTypeId = 'mod-dosai-type';
  batch.set(doc(db, 'venues', _venueId, 'modifier_groups', dosaiTypeId), {
    name: 'Dosai Type',
    type: 'single',
    required: true,
    options: [
      { id: 'dt-plain',  label: 'Plain',      priceDelta: -2.00 },
      { id: 'dt-masala', label: 'Masala',     priceDelta: 0.00  },
      { id: 'dt-ghee',   label: 'Ghee Roast', priceDelta: 1.00  },
      { id: 'dt-onion',  label: 'Onion',      priceDelta: 0.00  },
      { id: 'dt-paper',  label: 'Paper Roast',priceDelta: 1.00  }
    ]
  });

  // Spice level (optional, no price diff)
  const spiceId = 'mod-spice';
  batch.set(doc(db, 'venues', _venueId, 'modifier_groups', spiceId), {
    name: 'Spice Level',
    type: 'single',
    required: false,
    options: [
      { id: 'sp-mild',   label: 'Mild',   priceDelta: 0 },
      { id: 'sp-medium', label: 'Medium', priceDelta: 0 },
      { id: 'sp-hot',    label: 'Hot',    priceDelta: 0 }
    ]
  });

  // Tandoori portion: Half / Full
  const tandooriPortionId = 'mod-tandoori-portion';
  batch.set(doc(db, 'venues', _venueId, 'modifier_groups', tandooriPortionId), {
    name: 'Portion',
    type: 'single',
    required: true,
    options: [
      { id: 'tp-half', label: 'Half', priceDelta: 0.00 },
      { id: 'tp-full', label: 'Full', priceDelta: 9.00 }
    ]
  });

  // ── Menu items — full Sizzle N Sambar menu ─────────────────────────────────
  // Modifier group IDs are stored in modifierGroupIds[]; base price = lowest option.

  const mk = (name, categoryId, price, course, station, modifierGroupIds = []) =>
    ({ name, categoryId, price, course, station, modifierGroupIds, taxPct: 10, active: true });

  const items = [
    // ── Veg Starters ───────────────────────────────────────────────────────
    mk('Gobi 65',                  'veg-starters', 14.90, 'starter', 'kitchen'),
    mk('Paneer Tikka',             'veg-starters', 17.90, 'starter', 'kitchen'),
    mk('Veg Manchurian',           'veg-starters', 15.90, 'starter', 'kitchen'),
    mk('Baby Corn Pepper Fry',     'veg-starters', 14.90, 'starter', 'kitchen'),
    mk('Samosa (2 pcs)',           'veg-starters', 10.90, 'starter', 'kitchen'),
    mk('Vegetable Kofta (3 pcs)',  'veg-starters', 13.90, 'starter', 'kitchen'),

    // ── Non-Veg Starters ───────────────────────────────────────────────────
    mk('Chicken 65',               'nonveg-starters', 16.90, 'starter', 'kitchen', [spiceId]),
    mk('Chicken Lollipop',         'nonveg-starters', 17.90, 'starter', 'kitchen', [spiceId]),
    mk('Chicken Wings',            'nonveg-starters', 16.90, 'starter', 'kitchen', [spiceId]),
    mk('Mutton Boti',              'nonveg-starters', 19.90, 'starter', 'kitchen', [spiceId]),
    mk('Prawn 65',                 'nonveg-starters', 19.90, 'starter', 'kitchen', [spiceId]),
    mk('Fish Fry',                 'nonveg-starters', 18.90, 'starter', 'kitchen', [spiceId]),
    mk('Tandoori Chicken',         'nonveg-starters', 19.90, 'starter', 'kitchen', [tandooriPortionId]),

    // ── Rice & Noodles ─────────────────────────────────────────────────────
    // Base = Veg price. Protein modifier adds the delta.
    mk('Fried Rice',               'rice-noodles', 18.90, 'main', 'kitchen', [friedRiceProteinId]),
    mk('Hakka / Schezwan Noodles', 'rice-noodles', 18.90, 'main', 'kitchen', [noodleStyleId, noodleProteinId]),

    // ── Idiappam (String Hoppers) ───────────────────────────────────────────
    mk('Idiappam (4 pcs)',         'idiappam', 14.90, 'main', 'kitchen', [idiappamCurryId]),
    mk('Idiappam Set (Breakfast)', 'idiappam', 18.90, 'main', 'kitchen'),

    // ── Rice ───────────────────────────────────────────────────────────────
    mk('Plain Basmati Rice',       'rice', 5.00, 'main', 'kitchen'),
    mk('Jeera Rice',               'rice', 6.00, 'main', 'kitchen'),
    mk('Ghee Rice',                'rice', 7.00, 'main', 'kitchen'),

    // ── Veg Mains ──────────────────────────────────────────────────────────
    mk('Dal Makhani',              'veg-mains', 17.90, 'main', 'kitchen'),
    mk('Palak Paneer',             'veg-mains', 19.90, 'main', 'kitchen'),
    mk('Paneer Butter Masala',     'veg-mains', 19.90, 'main', 'kitchen'),
    mk('Veg Korma',                'veg-mains', 18.90, 'main', 'kitchen'),
    mk('Chana Masala',             'veg-mains', 17.90, 'main', 'kitchen'),
    mk('Mushroom Masala',          'veg-mains', 18.90, 'main', 'kitchen'),
    mk('Aloo Gobi',                'veg-mains', 17.90, 'main', 'kitchen'),

    // ── Non-Veg Mains ──────────────────────────────────────────────────────
    mk('Butter Chicken',           'nonveg-mains', 22.90, 'main', 'kitchen'),
    mk('Chicken Korma',            'nonveg-mains', 22.90, 'main', 'kitchen'),
    mk('Chicken Curry',            'nonveg-mains', 22.90, 'main', 'kitchen'),
    mk('Goat Curry',               'nonveg-mains', 24.90, 'main', 'kitchen'),
    mk('Goat Pepper Fry',          'nonveg-mains', 25.90, 'main', 'kitchen'),
    mk('Fish Curry',               'nonveg-mains', 23.90, 'main', 'kitchen'),
    mk('Prawn Masala',             'nonveg-mains', 25.90, 'main', 'kitchen'),
    mk('Mutton Bone Marrow',       'nonveg-mains', 26.90, 'main', 'kitchen'),

    // ── Biryani ────────────────────────────────────────────────────────────
    // Base = Veg $19.90; protein modifier adds delta
    mk('Dum Biryani',              'biryani', 19.90, 'main', 'kitchen', [biryaniProteinId, spiceId]),

    // ── Dosai ──────────────────────────────────────────────────────────────
    // Base = Masala $15.90; type modifier adjusts price
    mk('Dosai',                    'dosai', 15.90, 'main', 'kitchen', [dosaiTypeId]),
    mk('Rava Dosai',               'dosai', 15.90, 'main', 'kitchen'),
    mk('Set Dosai (3 pcs)',        'dosai', 15.90, 'main', 'kitchen'),

    // ── Idli ───────────────────────────────────────────────────────────────
    mk('Idli (2 pcs)',             'idli', 10.90, 'main', 'kitchen'),
    mk('Idli Sambar',              'idli', 13.90, 'main', 'kitchen'),
    mk('Mini Idli (12 pcs)',       'idli', 15.90, 'main', 'kitchen'),
    mk('Mini Idli Sambar',         'idli', 16.90, 'main', 'kitchen'),
    mk('Idli & Vada Set',          'idli', 15.90, 'main', 'kitchen'),

    // ── Breads ─────────────────────────────────────────────────────────────
    mk('Butter Naan',              'breads', 4.50, 'main', 'kitchen'),
    mk('Garlic Naan',              'breads', 5.00, 'main', 'kitchen'),
    mk('Cheese Naan',              'breads', 6.00, 'main', 'kitchen'),
    mk('Roti',                     'breads', 4.00, 'main', 'kitchen'),
    mk('Parotta',                  'breads', 4.50, 'main', 'kitchen'),

    // ── Accompaniments ─────────────────────────────────────────────────────
    mk('Mint Chutney',             'accompaniments', 4.00, 'main', 'kitchen'),
    mk('Mixed Pickle',             'accompaniments', 4.00, 'main', 'kitchen'),
    mk('Raita',                    'accompaniments', 4.50, 'main', 'kitchen'),
    mk('Papadum (3 pcs)',          'accompaniments', 3.50, 'main', 'kitchen'),

    // ── Desserts ───────────────────────────────────────────────────────────
    mk('Gulab Jamun (2 pcs)',      'desserts', 7.50, 'dessert', 'kitchen'),
    mk('Kulfi',                    'desserts', 7.00, 'dessert', 'kitchen'),
    mk('Gajar Halwa',              'desserts', 7.50, 'dessert', 'kitchen'),

    // ── Drinks ─────────────────────────────────────────────────────────────
    mk('Mango Lassi',              'drinks', 6.50, 'drink', 'bar'),
    mk('Sweet Lassi',              'drinks', 6.00, 'drink', 'bar'),
    mk('Masala Chai',              'drinks', 4.50, 'drink', 'bar'),
    mk('Filter Coffee',            'drinks', 4.50, 'drink', 'bar'),
    mk('Soft Drink (Can)',         'drinks', 4.00, 'drink', 'bar'),
    mk('Sparkling Water',          'drinks', 5.00, 'drink', 'bar'),
    mk('Still Water',              'drinks', 3.00, 'drink', 'bar')
  ];

  items.forEach(it => {
    const ref = doc(col('menu_items'));
    batch.set(ref, it);
  });

  // Tables
  for (let i = 1; i <= 12; i++) {
    batch.set(doc(db, 'venues', _venueId, 'tables', `t${i}`), {
      number: i,
      seats: i <= 4 ? 2 : i <= 8 ? 4 : 6,
      zone: i <= 6 ? 'Dining' : 'Patio',
      status: 'free'
    });
  }

  await batch.commit();
  return true;
}

// ── Reset & re-seed (Manager Hub utility — wipes menu + modifiers, re-seeds) ─
export async function resetAndReseedMenu() {
  // Delete existing menu items, categories, modifier groups
  const [itemsSnap, catsSnap, modsSnap] = await Promise.all([
    getDocs(col('menu_items')),
    getDocs(col('menu_categories')),
    getDocs(col('modifier_groups'))
  ]);

  const CHUNK = 400;
  const allDocs = [...itemsSnap.docs, ...catsSnap.docs, ...modsSnap.docs];
  for (let i = 0; i < allDocs.length; i += CHUNK) {
    const b = writeBatch(db);
    allDocs.slice(i, i + CHUNK).forEach(d => b.delete(d.ref));
    await b.commit();
  }

  // Re-run just the menu portion of the seed
  // (venue + users + tables already exist — skip those)
  const batch = writeBatch(db);

  const cats = [
    { id: 'veg-starters',   name: 'Veg Starters',              order: 1,  color: '#10b981' },
    { id: 'nonveg-starters',name: 'Non-Veg Starters',          order: 2,  color: '#ef4444' },
    { id: 'rice-noodles',   name: 'Rice & Noodles',            order: 3,  color: '#f59e0b' },
    { id: 'idiappam',       name: 'Idiappam (String Hoppers)',  order: 4,  color: '#8b5cf6' },
    { id: 'rice',           name: 'Rice',                       order: 5,  color: '#f59e0b' },
    { id: 'veg-mains',      name: 'Veg Mains',                 order: 6,  color: '#10b981' },
    { id: 'nonveg-mains',   name: 'Non-Veg Mains',             order: 7,  color: '#ef4444' },
    { id: 'biryani',        name: 'Biryani',                   order: 8,  color: '#8b5cf6' },
    { id: 'dosai',          name: 'Dosai',                     order: 9,  color: '#ec4899' },
    { id: 'idli',           name: 'Idli',                      order: 10, color: '#3b82f6' },
    { id: 'breads',         name: 'Breads',                    order: 11, color: '#6366f1' },
    { id: 'accompaniments', name: 'Accompaniments',            order: 12, color: '#14b8a6' },
    { id: 'desserts',       name: 'Desserts',                  order: 13, color: '#ec4899' },
    { id: 'drinks',         name: 'Drinks',                    order: 14, color: '#3b82f6' }
  ];
  cats.forEach(c => {
    const { id, ...rest } = c;
    batch.set(doc(db, 'venues', _venueId, 'menu_categories', id), { ...rest, active: true });
  });

  const friedRiceProteinId = 'mod-fried-rice-protein';
  batch.set(doc(db, 'venues', _venueId, 'modifier_groups', friedRiceProteinId), {
    name: 'Choose Protein',
    type: 'single', required: true,
    options: [
      { id: 'fr-veg', label: 'Veg', priceDelta: 0.00 },
      { id: 'fr-egg', label: 'Egg', priceDelta: 0.00 },
      { id: 'fr-chicken', label: 'Chicken', priceDelta: 2.10 },
      { id: 'fr-prawn', label: 'Prawn', priceDelta: 5.00 }
    ]
  });
  const noodleProteinId = 'mod-noodle-protein';
  batch.set(doc(db, 'venues', _venueId, 'modifier_groups', noodleProteinId), {
    name: 'Choose Protein',
    type: 'single', required: true,
    options: [
      { id: 'nd-veg', label: 'Veg', priceDelta: 0.00 },
      { id: 'nd-egg', label: 'Egg', priceDelta: 0.00 },
      { id: 'nd-mushroom', label: 'Mushroom', priceDelta: 0.00 },
      { id: 'nd-chicken', label: 'Chicken', priceDelta: 2.10 },
      { id: 'nd-prawn', label: 'Prawn', priceDelta: 5.00 }
    ]
  });
  const noodleStyleId = 'mod-noodle-style';
  batch.set(doc(db, 'venues', _venueId, 'modifier_groups', noodleStyleId), {
    name: 'Noodle Style', type: 'single', required: true,
    options: [
      { id: 'ns-hakka', label: 'Hakka', priceDelta: 0 },
      { id: 'ns-schezwan', label: 'Schezwan', priceDelta: 0 }
    ]
  });
  const idiappamCurryId = 'mod-idiappam-curry';
  batch.set(doc(db, 'venues', _venueId, 'modifier_groups', idiappamCurryId), {
    name: 'Served With', type: 'single', required: true,
    options: [
      { id: 'ic-coconut', label: 'Coconut Milk', priceDelta: 0 },
      { id: 'ic-curry', label: 'Spicy Curry', priceDelta: 0 }
    ]
  });
  const biryaniProteinId = 'mod-biryani-protein';
  batch.set(doc(db, 'venues', _venueId, 'modifier_groups', biryaniProteinId), {
    name: 'Choose Protein', type: 'single', required: true,
    options: [
      { id: 'br-veg', label: 'Veg', priceDelta: 0.00 },
      { id: 'br-chicken', label: 'Chicken', priceDelta: 4.00 },
      { id: 'br-goat', label: 'Goat', priceDelta: 6.00 },
      { id: 'br-prawn', label: 'Prawn', priceDelta: 7.00 },
      { id: 'br-fish', label: 'Fish', priceDelta: 6.00 }
    ]
  });
  const dosaiTypeId = 'mod-dosai-type';
  batch.set(doc(db, 'venues', _venueId, 'modifier_groups', dosaiTypeId), {
    name: 'Dosai Type', type: 'single', required: true,
    options: [
      { id: 'dt-plain', label: 'Plain', priceDelta: -2.00 },
      { id: 'dt-masala', label: 'Masala', priceDelta: 0.00 },
      { id: 'dt-ghee', label: 'Ghee Roast', priceDelta: 1.00 },
      { id: 'dt-onion', label: 'Onion', priceDelta: 0.00 },
      { id: 'dt-paper', label: 'Paper Roast', priceDelta: 1.00 }
    ]
  });
  const spiceId = 'mod-spice';
  batch.set(doc(db, 'venues', _venueId, 'modifier_groups', spiceId), {
    name: 'Spice Level', type: 'single', required: false,
    options: [
      { id: 'sp-mild', label: 'Mild', priceDelta: 0 },
      { id: 'sp-medium', label: 'Medium', priceDelta: 0 },
      { id: 'sp-hot', label: 'Hot', priceDelta: 0 }
    ]
  });
  const tandooriPortionId = 'mod-tandoori-portion';
  batch.set(doc(db, 'venues', _venueId, 'modifier_groups', tandooriPortionId), {
    name: 'Portion', type: 'single', required: true,
    options: [
      { id: 'tp-half', label: 'Half', priceDelta: 0.00 },
      { id: 'tp-full', label: 'Full', priceDelta: 9.00 }
    ]
  });

  const mk = (name, categoryId, price, course, station, modifierGroupIds = []) =>
    ({ name, categoryId, price, course, station, modifierGroupIds, taxPct: 10, active: true });

  const items = [
    mk('Gobi 65', 'veg-starters', 14.90, 'starter', 'kitchen'),
    mk('Paneer Tikka', 'veg-starters', 17.90, 'starter', 'kitchen'),
    mk('Veg Manchurian', 'veg-starters', 15.90, 'starter', 'kitchen'),
    mk('Baby Corn Pepper Fry', 'veg-starters', 14.90, 'starter', 'kitchen'),
    mk('Samosa (2 pcs)', 'veg-starters', 10.90, 'starter', 'kitchen'),
    mk('Vegetable Kofta (3 pcs)', 'veg-starters', 13.90, 'starter', 'kitchen'),
    mk('Chicken 65', 'nonveg-starters', 16.90, 'starter', 'kitchen', [spiceId]),
    mk('Chicken Lollipop', 'nonveg-starters', 17.90, 'starter', 'kitchen', [spiceId]),
    mk('Chicken Wings', 'nonveg-starters', 16.90, 'starter', 'kitchen', [spiceId]),
    mk('Mutton Boti', 'nonveg-starters', 19.90, 'starter', 'kitchen', [spiceId]),
    mk('Prawn 65', 'nonveg-starters', 19.90, 'starter', 'kitchen', [spiceId]),
    mk('Fish Fry', 'nonveg-starters', 18.90, 'starter', 'kitchen', [spiceId]),
    mk('Tandoori Chicken', 'nonveg-starters', 19.90, 'starter', 'kitchen', [tandooriPortionId]),
    mk('Fried Rice', 'rice-noodles', 18.90, 'main', 'kitchen', [friedRiceProteinId]),
    mk('Hakka / Schezwan Noodles', 'rice-noodles', 18.90, 'main', 'kitchen', [noodleStyleId, noodleProteinId]),
    mk('Idiappam (4 pcs)', 'idiappam', 14.90, 'main', 'kitchen', [idiappamCurryId]),
    mk('Idiappam Set (Breakfast)', 'idiappam', 18.90, 'main', 'kitchen'),
    mk('Plain Basmati Rice', 'rice', 5.00, 'main', 'kitchen'),
    mk('Jeera Rice', 'rice', 6.00, 'main', 'kitchen'),
    mk('Ghee Rice', 'rice', 7.00, 'main', 'kitchen'),
    mk('Dal Makhani', 'veg-mains', 17.90, 'main', 'kitchen'),
    mk('Palak Paneer', 'veg-mains', 19.90, 'main', 'kitchen'),
    mk('Paneer Butter Masala', 'veg-mains', 19.90, 'main', 'kitchen'),
    mk('Veg Korma', 'veg-mains', 18.90, 'main', 'kitchen'),
    mk('Chana Masala', 'veg-mains', 17.90, 'main', 'kitchen'),
    mk('Mushroom Masala', 'veg-mains', 18.90, 'main', 'kitchen'),
    mk('Aloo Gobi', 'veg-mains', 17.90, 'main', 'kitchen'),
    mk('Butter Chicken', 'nonveg-mains', 22.90, 'main', 'kitchen'),
    mk('Chicken Korma', 'nonveg-mains', 22.90, 'main', 'kitchen'),
    mk('Chicken Curry', 'nonveg-mains', 22.90, 'main', 'kitchen'),
    mk('Goat Curry', 'nonveg-mains', 24.90, 'main', 'kitchen'),
    mk('Goat Pepper Fry', 'nonveg-mains', 25.90, 'main', 'kitchen'),
    mk('Fish Curry', 'nonveg-mains', 23.90, 'main', 'kitchen'),
    mk('Prawn Masala', 'nonveg-mains', 25.90, 'main', 'kitchen'),
    mk('Mutton Bone Marrow', 'nonveg-mains', 26.90, 'main', 'kitchen'),
    mk('Dum Biryani', 'biryani', 19.90, 'main', 'kitchen', [biryaniProteinId, spiceId]),
    mk('Dosai', 'dosai', 15.90, 'main', 'kitchen', [dosaiTypeId]),
    mk('Rava Dosai', 'dosai', 15.90, 'main', 'kitchen'),
    mk('Set Dosai (3 pcs)', 'dosai', 15.90, 'main', 'kitchen'),
    mk('Idli (2 pcs)', 'idli', 10.90, 'main', 'kitchen'),
    mk('Idli Sambar', 'idli', 13.90, 'main', 'kitchen'),
    mk('Mini Idli (12 pcs)', 'idli', 15.90, 'main', 'kitchen'),
    mk('Mini Idli Sambar', 'idli', 16.90, 'main', 'kitchen'),
    mk('Idli & Vada Set', 'idli', 15.90, 'main', 'kitchen'),
    mk('Butter Naan', 'breads', 4.50, 'main', 'kitchen'),
    mk('Garlic Naan', 'breads', 5.00, 'main', 'kitchen'),
    mk('Cheese Naan', 'breads', 6.00, 'main', 'kitchen'),
    mk('Roti', 'breads', 4.00, 'main', 'kitchen'),
    mk('Parotta', 'breads', 4.50, 'main', 'kitchen'),
    mk('Mint Chutney', 'accompaniments', 4.00, 'main', 'kitchen'),
    mk('Mixed Pickle', 'accompaniments', 4.00, 'main', 'kitchen'),
    mk('Raita', 'accompaniments', 4.50, 'main', 'kitchen'),
    mk('Papadum (3 pcs)', 'accompaniments', 3.50, 'main', 'kitchen'),
    mk('Gulab Jamun (2 pcs)', 'desserts', 7.50, 'dessert', 'kitchen'),
    mk('Kulfi', 'desserts', 7.00, 'dessert', 'kitchen'),
    mk('Gajar Halwa', 'desserts', 7.50, 'dessert', 'kitchen'),
    mk('Mango Lassi', 'drinks', 6.50, 'drink', 'bar'),
    mk('Sweet Lassi', 'drinks', 6.00, 'drink', 'bar'),
    mk('Masala Chai', 'drinks', 4.50, 'drink', 'bar'),
    mk('Filter Coffee', 'drinks', 4.50, 'drink', 'bar'),
    mk('Soft Drink (Can)', 'drinks', 4.00, 'drink', 'bar'),
    mk('Sparkling Water', 'drinks', 5.00, 'drink', 'bar'),
    mk('Still Water', 'drinks', 3.00, 'drink', 'bar')
  ];

  items.forEach(it => {
    const ref = doc(col('menu_items'));
    batch.set(ref, it);
  });

  await batch.commit();
  return true;
}
