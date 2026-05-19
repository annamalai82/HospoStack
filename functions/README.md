# Receipt Delivery — Setup Guide

The Till mode captures the customer's name, email, and phone after payment. When the order settles, a Cloud Function picks it up and emails / SMSs the receipt — no printing, no paper. As a bonus, every customer becomes a row in `venues/{id}/customers` for future marketing.

## What you need

| Service | What it does | Account |
|---------|--------------|---------|
| **SendGrid** | Sends the HTML email receipt | [signup.sendgrid.com](https://signup.sendgrid.com) — free tier is 100 emails/day |
| **Twilio** | Sends the SMS receipt | [twilio.com/try-twilio](https://www.twilio.com/try-twilio) — free trial credit ~ $15 |

Either one is optional. If you only configure SendGrid, customers who provide just a phone won't get an SMS (and vice versa). The Till UI will still capture both, the function just skips the channel it can't reach.

## One-time setup

### 1. Upgrade the Firebase project to Blaze (pay-as-you-go)

Cloud Functions require the Blaze plan. You'll still pay nothing on light usage — there's a generous free tier (2M invocations/month).

👉 Firebase Console → ⚙ Project Settings → Usage and Billing → modify plan → Blaze.

### 2. Install function dependencies

```bash
cd functions
npm install
```

### 3. Set secrets

```bash
# Email
firebase functions:secrets:set SENDGRID_API_KEY
firebase functions:secrets:set SENDGRID_FROM_EMAIL    # e.g. receipts@sizzlensambar.com.au
firebase functions:secrets:set SENDGRID_FROM_NAME     # e.g. Sizzle N Sambar

# SMS
firebase functions:secrets:set TWILIO_ACCOUNT_SID
firebase functions:secrets:set TWILIO_AUTH_TOKEN
firebase functions:secrets:set TWILIO_FROM_NUMBER     # e.g. +61400000000
```

The CLI will prompt you for each value. You can set only the email ones for now and skip Twilio.

### 4. Verify the SendGrid sender

SendGrid won't deliver from an unverified email address. In the SendGrid dashboard:

- **Sender Authentication** → either verify a single sender (faster) or set up domain authentication (better for deliverability)

### 5. Deploy

```bash
firebase deploy --only functions
```

This pushes the `deliverReceipt` function. From then on, every paid order with customer contact details triggers a delivery automatically.

## Trying it locally with the emulator (no real send)

```bash
cd functions
npm run serve
```

This starts the Firebase Emulator Suite. You'll see the function fire in the logs, but it won't actually call SendGrid/Twilio unless you provide the secrets. Useful for testing the Firestore flow without spending credits.

## How a paid order flows through

```
Till mode → customer enters email/phone
         → settleOrder() writes orders/{id} with status='paid' + customer{}
         → queueReceiptDelivery() writes receipt_deliveries/{id}
                                       │
                                       ▼  (Cloud Function trigger)
                              deliverReceipt(event)
                                       │
              ┌────────────────────────┼────────────────────────┐
              ▼                                                  ▼
       SendGrid: HTML email                              Twilio: SMS text
              │                                                  │
              └────────────────────────┬────────────────────────┘
                                       ▼
                receipt_deliveries/{id} update: status, result
```

The Manager Hub's Reports tab shows delivery status alongside each settled order (coming up — for now, look in `receipt_deliveries` in Firestore).

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Delivery doc stuck at `queued` | Function not deployed or Blaze not enabled | Deploy + upgrade billing |
| `status: 'no_channels_configured'` | None of the secrets set | Set at least one channel |
| Email lands in spam | Unverified sender or domain | Set up SendGrid domain authentication |
| SMS bounces | Twilio trial sandbox only sends to verified numbers | Verify the recipient in Twilio console, or upgrade |
| `status: 'failed'` with error | Look at `result.errors` in the delivery doc | Usually an API-key or recipient-format issue |

## Customer data for future promotions

Each settle pushes the customer into `venues/{id}/customers`, keyed by email (or phone) — repeat customers automatically accumulate `orderCount` and `lastSeenAt`. You can later export this list and run a SendGrid Marketing Campaign against it. The `marketingOptIn` flag defaults to `true`; add an unsubscribe link to your email footer to honour CAN-SPAM / Spam Act 2003.
