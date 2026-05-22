// Firebase initialization for HospoStack
//
// Uses the modern offline cache configuration (persistentLocalCache with
// tab-manager) so the app keeps working through wifi dropouts. Writes made
// offline are queued in IndexedDB and replayed when the connection returns.
import { initializeApp } from 'firebase/app';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getFunctions } from 'firebase/functions';

const firebaseConfig = {
  apiKey: 'AIzaSyCQXuw3OoUw-EdZk9SdXadVNdGUfzfgxjM',
  authDomain: 'snspos-661a4.firebaseapp.com',
  projectId: 'snspos-661a4',
  storageBucket: 'snspos-661a4.firebasestorage.app',
  messagingSenderId: '368303696853',
  appId: '1:368303696853:web:ee30b4f5e908d6ae86ab5c'
};

export const app = initializeApp(firebaseConfig);

// Try to initialize with persistent cache; fall back to memory cache if the
// browser blocks IndexedDB (private mode, Safari quirks, multi-tab edge cases).
let _db;
try {
  _db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  });
} catch (e) {
  console.warn('Persistent cache unavailable, using memory cache:', e?.message);
  _db = initializeFirestore(app, {});
}

export const db = _db;
export const auth = getAuth(app);
// Cloud Functions client — region matches setGlobalOptions in functions/index.js
export const functions = getFunctions(app, 'australia-southeast1');

// ─── Firestore schema (reference) ───────────────────────────────────────────
// venues/{venueId}
//   name, abn, gstPct, timezone, currency, booking{...}
//
// venues/{venueId}/users/{userId}
//   name, role: 'manager'|'waiter'|'kitchen'|'cashier', pin, active
//
// venues/{venueId}/menu_categories/{catId}
//   name, order, color, active
//
// venues/{venueId}/menu_items/{itemId}
//   name, categoryId, price, course, station, taxPct, active, modifierGroupIds[]
//
// venues/{venueId}/modifier_groups/{groupId}
//   name, type: 'single'|'multi', required, minSelect, maxSelect,
//   options: [{ id, label, priceDelta }]
//
// venues/{venueId}/tables/{tableId}
//   number, seats, zone, status: 'free'|'seated'|'ordering'|'served'|'billing'
//
// venues/{venueId}/orders/{orderId}
//   tableId | null, orderType, status, items[], subtotal, gst, total,
//   payments[], customer{}, openedAt, sentAt, paidAt
//
// venues/{venueId}/customers/{customerKey}
//   name, email, phone, orderCount, firstSeenAt, lastSeenAt, marketingOptIn
//
// venues/{venueId}/bookings/{bookingId}
//   name, phone, email, date, time, party, durationMins, tableId, status,
//   occasion, notes, source, customerKey
//
// venues/{venueId}/vouchers/{code}
//   code, kind: 'giftcard'|'promo', value, balance, percentOff, amountOff,
//   active, expiresAt, maxUses, usedCount
//
// venues/{venueId}/receipt_deliveries/{deliveryId}
//   orderId, customer{}, status, result, createdAt, completedAt
//
// venues/{venueId}/sessions/{sessionId}
//   deviceMode, deviceName, openedBy, openedAt, closedAt
// ────────────────────────────────────────────────────────────────────────────
