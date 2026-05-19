// Data access layer for HospoStack
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
  query, where, orderBy, onSnapshot, serverTimestamp, writeBatch,
  deleteDoc, increment
} from 'firebase/firestore';
import { db } from './firebase';

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

export async function createOrder(payload) {
  const ref = await addDoc(col('orders'), {
    ...payload,
    status: 'open',
    items: payload.items || [],
    subtotal: 0, gst: 0, total: 0, paid: 0,
    payments: [],
    openedAt: serverTimestamp()
  });
  return ref.id;
}

export async function updateOrder(orderId, patch) {
  await updateDoc(doc(db, 'venues', _venueId, 'orders', orderId), patch);
}

export async function sendOrderToKitchen(orderId, items, totals) {
  await updateDoc(doc(db, 'venues', _venueId, 'orders', orderId), {
    items,
    ...totals,
    status: 'sent',
    sentAt: serverTimestamp()
  });
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
  await addDoc(col('receipt_deliveries'), {
    orderId,
    customer,
    status: 'queued',
    createdAt: serverTimestamp()
  });
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

export async function updateMenuItem(itemId, patch) {
  await updateDoc(doc(db, 'venues', _venueId, 'menu_items', itemId), patch);
}

export async function deleteMenuItem(itemId) {
  await deleteDoc(doc(db, 'venues', _venueId, 'menu_items', itemId));
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
export async function updateVenue(patch) {
  await updateDoc(venueRef(), patch);
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

  // Users with PINs (4-digit). Default Manager = 1234.
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

  // Menu categories
  const cats = [
    { id: 'starters', name: 'Starters', order: 1, color: '#f59e0b' },
    { id: 'mains', name: 'Mains', order: 2, color: '#ef4444' },
    { id: 'biryani', name: 'Biryani', order: 3, color: '#8b5cf6' },
    { id: 'breads', name: 'Breads', order: 4, color: '#10b981' },
    { id: 'desserts', name: 'Desserts', order: 5, color: '#ec4899' },
    { id: 'drinks', name: 'Drinks', order: 6, color: '#3b82f6' }
  ];
  cats.forEach(c => {
    const { id, ...rest } = c;
    batch.set(doc(db, 'venues', _venueId, 'menu_categories', id), { ...rest, active: true });
  });

  // Menu items (sampled from the Sizzle N Sambar reference)
  const items = [
    // Starters → kitchen
    { name: 'Gobi 65', categoryId: 'starters', price: 14.90, course: 'starter', station: 'kitchen' },
    { name: 'Chicken 65', categoryId: 'starters', price: 16.90, course: 'starter', station: 'kitchen' },
    { name: 'Paneer Tikka', categoryId: 'starters', price: 17.90, course: 'starter', station: 'kitchen' },
    { name: 'Tandoori Chicken (Half)', categoryId: 'starters', price: 18.90, course: 'starter', station: 'kitchen' },
    // Mains
    { name: 'Butter Chicken', categoryId: 'mains', price: 22.90, course: 'main', station: 'kitchen' },
    { name: 'Goat Curry', categoryId: 'mains', price: 24.90, course: 'main', station: 'kitchen' },
    { name: 'Palak Paneer', categoryId: 'mains', price: 19.90, course: 'main', station: 'kitchen' },
    { name: 'Dal Makhani', categoryId: 'mains', price: 17.90, course: 'main', station: 'kitchen' },
    // Biryani
    { name: 'Chicken Dum Biryani', categoryId: 'biryani', price: 23.90, course: 'main', station: 'kitchen' },
    { name: 'Goat Dum Biryani', categoryId: 'biryani', price: 25.90, course: 'main', station: 'kitchen' },
    { name: 'Veg Biryani', categoryId: 'biryani', price: 19.90, course: 'main', station: 'kitchen' },
    // Breads
    { name: 'Butter Naan', categoryId: 'breads', price: 4.50, course: 'main', station: 'kitchen' },
    { name: 'Garlic Naan', categoryId: 'breads', price: 5.00, course: 'main', station: 'kitchen' },
    { name: 'Roti', categoryId: 'breads', price: 4.00, course: 'main', station: 'kitchen' },
    // Desserts
    { name: 'Gulab Jamun', categoryId: 'desserts', price: 7.50, course: 'dessert', station: 'kitchen' },
    { name: 'Kulfi', categoryId: 'desserts', price: 7.00, course: 'dessert', station: 'kitchen' },
    // Drinks → bar
    { name: 'Mango Lassi', categoryId: 'drinks', price: 6.50, course: 'drink', station: 'bar' },
    { name: 'Masala Chai', categoryId: 'drinks', price: 4.50, course: 'drink', station: 'bar' },
    { name: 'Soft Drink', categoryId: 'drinks', price: 4.00, course: 'drink', station: 'bar' },
    { name: 'Sparkling Water', categoryId: 'drinks', price: 5.00, course: 'drink', station: 'bar' }
  ];
  items.forEach(it => {
    const ref = doc(col('menu_items'));
    batch.set(ref, { ...it, taxPct: 10, active: true });
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
