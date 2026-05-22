# Cloud Functions — Receipt Delivery

Two functions power digital receipts:

| Function | Trigger | Purpose |
|---|---|---|
| `deliverReceipt` | Firestore `onCreate` on `receipt_deliveries/{id}` | Sends email + SMS, updates delivery status |
| `resendReceipt`  | HTTPS callable from the app | Lets a manager re-send a receipt for a past order |

The Till already captures `customer.email` / `customer.phone` at payment and writes a `receipt_deliveries` doc — `deliverReceipt` fires automatically. `resendReceipt` is wired into the Manager Hub Reports tab.

## What you need

| Service | What it does | Account |
|---|---|---|
| **SendGrid** | HTML email receipts | [signup.sendgrid.com](https://signup.sendgrid.com) — free tier 100/day |
| **Twilio**   | SMS receipts | [twilio.com/try-twilio](https://www.twilio.com/try-twilio) — free trial ~$15 |

Either one is optional. The other still attempts to send.

## One-time setup

### 1. Upgrade Firebase to Blaze (pay-as-you-go)

Cloud Functions need Blaze. Free tier covers ~2M invocations/month.

Firebase Console → ⚙ Project Settings → Usage and Billing → modify plan → Blaze.

### 2. Install function deps

```bash
cd functions
npm install
```

### 3. Set secrets (one-time)

```bash
firebase functions:secrets:set SENDGRID_API_KEY
firebase functions:secrets:set SENDGRID_FROM_EMAIL    # e.g. receipts@sizzlensambar.com.au
firebase functions:secrets:set SENDGRID_FROM_NAME     # e.g. Sizzle N Sambar

firebase functions:secrets:set TWILIO_ACCOUNT_SID
firebase functions:secrets:set TWILIO_AUTH_TOKEN
firebase functions:secrets:set TWILIO_FROM_NUMBER     # e.g. +61400000000
```

You can skip Twilio for now and just set the SendGrid ones — SMS will be skipped, email still works.

### 4. Verify your SendGrid sender

SendGrid won't deliver from an unverified address. In their dashboard:

**Sender Authentication** → verify a single sender (quick) or full domain auth (better for deliverability long-term).

### 5. Deploy

```bash
firebase deploy --only functions
```

Or commit & push — the GitHub Actions workflow at `.github/workflows/deploy-functions.yml` auto-deploys when `functions/**` changes (requires GitHub secrets `FIREBASE_SERVICE_ACCOUNT_JSON` and `FIREBASE_PROJECT_ID`).

## Testing locally with the emulator

```bash
cd functions
npm run serve
```

This boots the Firebase Emulator Suite. The function fires on Firestore writes in the emulator but won't actually call SendGrid/Twilio unless secrets are set in the env.

## How a paid order flows through

```
Till mode → customer enters email/phone, ticks receipt opt-in
         → settleOrder() writes orders/{id} status='paid' + customer{}
         → queueReceiptDelivery() writes receipt_deliveries/{id}
                                       │
                                       ▼  (Firestore trigger)
                              deliverReceipt(event)
                                       │
              ┌────────────────────────┼────────────────────────┐
              ▼                                                  ▼
       SendGrid: HTML email                              Twilio: SMS text
              │                                                  │
              └────────────────────────┬────────────────────────┘
                                       ▼
                receipt_deliveries/{id} update: status, result
                orders/{id}.receiptDelivery = { status, email, sms, ... }
```

## Resending from the Manager Hub

```
Reports tab → ⟳ Resend → calls resendReceipt(orderId, optional customer)
                            │
                            ▼ (writes new receipt_deliveries doc)
                   deliverReceipt fires again
```

The customer's email/phone can be edited at resend time — useful when a typo on the original was the reason for failure.

## Delivery status values

| status | Meaning |
|---|---|
| `queued` | doc just created, function hasn't picked it up yet |
| `sending` | function claimed the doc — prevents double-send on retry |
| `delivered` | all channels sent successfully |
| `partial` | one channel sent, the other failed |
| `failed` | every channel attempted failed (see `result.errors`) |
| `no_channels_configured` | neither SendGrid nor Twilio secrets are set |
| `error` | unexpected error — see `error` field on the doc |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Delivery stuck at `queued` | Function not deployed or Blaze not enabled | Deploy + upgrade billing |
| `no_channels_configured` | None of the secrets are set | Set at least one channel |
| Email lands in spam | Unverified sender / no domain auth | SendGrid → Sender Authentication → Domain |
| SMS bounces in trial | Twilio trial only sends to verified numbers | Verify the recipient in Twilio console, or upgrade |
| `failed` with error | See `result.errors[]` on the delivery doc | Usually API-key or recipient-format issue |

## Customer data for marketing

Every settle pushes the customer into `venues/{vid}/customers` keyed by email (or phone). Repeat customers accumulate `orderCount` and `lastSeenAt`. Export this list later for a SendGrid Marketing Campaign. `marketingOptIn` defaults to `true` — add an unsubscribe link to your email footer to honour CAN-SPAM / Spam Act 2003.
