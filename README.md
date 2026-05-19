# HospoStack POS

A multi-mode hospitality POS for restaurants. One Firestore backend, three tailored device interfaces:

- **Kitchen Display (KDS)** — live ticket board for kitchen and bar
- **Floor / Table** — handheld order-taking, no payment
- **Till POS** — counter-side ordering plus cash / card / split / voucher payments

Built with React + Vite + Firebase (Firestore + Auth-ready).

> **Dev mode**: the app is configured with permissive Firestore rules and no Cloud Functions. Email/SMS receipt delivery and auth hardening are designed to be added later — see [Future hardening](#future-hardening). Everything else is live.

---

## Local setup

You need a Firebase project with Firestore enabled, and Node 18+.

### 1. Clone & install

```bash
git clone https://github.com/annamalai82/HospoStack.git
cd HospoStack
npm install
```

### 2. Firestore: create the database + open rules

In the [Firebase Console](https://console.firebase.google.com/) for project `snspos-661a4` (or your own):

1. **Firestore Database** → **Create database** → start in **test mode** → pick region `australia-southeast1`.
2. Go to the **Rules** tab. Replace everything with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

Click **Publish**.

> These rules are wide open — anyone with the Firebase config can read/write anything. Fine for local development; **don't ship like this**.

### 3. Run

```bash
npm run dev
```

Open the URL it prints. First load seeds the venue, sample menu, 12 tables and demo users.

### Demo PINs

| Role     | PIN  | Can sign into       |
|----------|------|---------------------|
| Manager  | 1234 | Any mode            |
| Manager  | 4321 | Any mode            |
| Waiter   | 1111 | Floor               |
| Kitchen  | 2222 | Kitchen Display     |
| Cashier  | 3333 | Till                |

---

## Full end-to-end walkthrough

Open the app in three browser windows (Chrome and Firefox both work — `npm run dev` listens on `host: true` so you can also test from your phone on the same wifi). In each window, pick a different mode:

### Window 1 — Floor / Table (PIN 1111)
1. Tap a free table → enter **Manage** view.
2. Tap a few menu items. Items with the **OPTIONS** badge open a modifier picker — try the demo by setting one up first via Manager Hub → Modifiers (see below).
3. Tap **Send to Kitchen**. Toast confirms. Table card flips to amber.

### Window 2 — Kitchen Display (PIN 2222)
The ticket appears within a second. Items show their selections and notes. Tap circles to bump individual items, or **All Ready** for the whole ticket.

### Window 3 — Till POS (PIN 3333)
The **Open Tabs** sidebar on the right shows every unsettled order. Tap the 💳 button on a tab to take payment:
- Tap **Cash** with an amount entered, or
- Tap **Card** / **EFTPOS** for the balance, or
- Tap **Voucher** and enter a code (issue some in Manager Hub → Vouchers first).

After balance hits zero, tap **Next: Customer →**, enter name + email + phone, hit **Save customer & finish**. The customer appears in the Customers panel for future marketing.

### Manager Hub (PIN 1234 on any device → ⚙ Manage)

The drawer has nine panels:

| Panel | What it does |
|-------|-------------|
| **Reports** | Live sales, GST, hourly chart, top items, settled-order detail |
| **Bookings** | Reservations: list + grid view, auto-fill from customer DB |
| **Customers** | Auto-built from settled orders, CSV export, opt-in toggle |
| **Vouchers** | Issue gift cards + promo codes, track balance + redemptions |
| **Menu** | CRUD items and categories, attach modifier groups |
| **Modifiers** | Shared option sets (Protein, Spice level, Extras…) |
| **Tables** | Add/edit/delete tables, zones, seats |
| **Users & PINs** | Add staff, set roles, change PINs, disable accounts |
| **Venue** | Name, ABN, GST rate |

### Multi-venue
The brand area in the top bar shows the current venue. Once a second venue exists, this becomes a dropdown. Click **+ Add venue** to create one — it starts with a default manager (PIN 1234) so you can immediately sign in to set up tables, menu, and the rest.

### Offline mode
Open DevTools → Network → throttle to **Offline**. The top bar shows a red "Offline mode" pill. Orders still go through (queued in IndexedDB) and the KDS / Floor / Till keep displaying cached data. Switch back to **Online** and queued writes flush within a second.

---

## What works without Cloud Functions

Everything except actual email/SMS *delivery*. Specifically:

- ✅ All three device modes, real-time sync
- ✅ Orders, payments (cash/card/EFTPOS/voucher), split tendering, change calculation
- ✅ Kitchen display with station filters, item-level bump, aging alerts
- ✅ Table grid with zone filtering, status colours
- ✅ Bookings: take, edit, status track, link to customers, Floor strip with arrival button
- ✅ Customer database with auto-lookup on phone/email
- ✅ Vouchers: issue, redeem with rollback-safe preview, balance tracking
- ✅ Modifiers: shared groups, single/multi select, price deltas, kitchen visibility
- ✅ Reports: live sales, hourly chart, top items, settled-order drilldown
- ✅ Multi-venue: switch + create
- ✅ Offline mode: IndexedDB cache, queued writes, status indicator
- ✅ Customer details captured at payment (stored, available for export)

The customer-capture step *queues* a receipt delivery in `venues/{id}/receipt_deliveries/{id}` but nothing processes that queue without the Cloud Function. The UI is honest about this and doesn't promise a receipt was sent.

---

## Future hardening

When you're ready to take this to production:

1. **Cloud Function for email/SMS receipts** — `functions/index.js` is written and ready to deploy. Setup guide in `functions/README.md`. Needs SendGrid + Twilio accounts, ~30 mins.
2. **Firebase Auth + custom claims** — replace the wide-open rules with role-based ones. Move PIN verification into a Cloud Function that returns a custom token. PIN lookup currently happens client-side which means PINs are readable; this is the main security gap.
3. **Booking reminders** — scheduled Cloud Function (`onSchedule`) every 15 min, fires SMS/email to customers an hour before their reservation.

---

## Project layout

```
src/
├── lib/
│   ├── firebase.js     — SDK init + persistent cache config
│   └── data.js         — All Firestore read/write helpers + seed
├── context/
│   └── DeviceContext   — device mode, user, session (localStorage)
├── pages/
│   ├── ConfigScreen    — pick mode (one-time per device)
│   └── PinScreen       — 4-digit touch-friendly PIN
├── components/
│   ├── TopBar          — brand, venue switcher, mode pill, connection, user
│   ├── VenueSwitcher   — multi-venue picker + new-venue modal
│   ├── ConnectionIndicator — offline/syncing pill
│   ├── ManagerHub      — slide-in drawer hosting all manager panels
│   ├── OrderPane       — menu + cart, shared by Floor + Till
│   ├── ModifierPicker  — bottom-sheet for items with options
│   ├── BookingModal    — new/edit booking form
│   └── *Panel.jsx      — Reports, Bookings, Customers, Vouchers, Menu, Modifiers, Tables, Users, Venue
└── modes/
    ├── KitchenMode     — KDS tickets + bump + aging
    ├── FloorMode       — table grid + order pane + booking strip
    └── TillMode        — order pane + open tabs + payment + customer capture
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| "Firestore unavailable: client is offline" | Database not created yet | Console → Firestore → Create database |
| "Missing or insufficient permissions" | Old test-mode rules expired | Publish the open rules above |
| App stuck on PIN screen even with right PIN | Stale `localStorage` from a previous schema | `localStorage.clear()` in DevTools, refresh |
| Empty floor / menu after switching venue | Brand-new venue, default data not seeded | Manager Hub → Tables / Menu → add what you need |
