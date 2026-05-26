/**
 * HospoStack — Receipt delivery Cloud Functions
 * 
 * DEPLOYMENT (run once from your laptop):
 *   cd functions && npm install
 *   firebase functions:secrets:set SENDGRID_API_KEY
 *   firebase functions:secrets:set SENDGRID_FROM_EMAIL   # receipts@yourvenue.com
 *   firebase functions:secrets:set SENDGRID_FROM_NAME    # Your Venue Name
 *   firebase functions:secrets:set TWILIO_ACCOUNT_SID    # optional - for SMS
 *   firebase functions:secrets:set TWILIO_AUTH_TOKEN     # optional
 *   firebase functions:secrets:set TWILIO_FROM_NUMBER    # optional e.g. +61400000000
 *   firebase deploy --only functions --project snspos-661a4
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { setGlobalOptions } from 'firebase-functions/v2';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import sgMail from '@sendgrid/mail';
import twilio from 'twilio';

initializeApp();
const db = getFirestore();

setGlobalOptions({ region: 'australia-southeast1', maxInstances: 10 });

const SENDGRID_API_KEY  = defineSecret('SENDGRID_API_KEY');
const SENDGRID_FROM     = defineSecret('SENDGRID_FROM_EMAIL');
const SENDGRID_NAME     = defineSecret('SENDGRID_FROM_NAME');
// Twilio secrets — optional. Set them when you have a Twilio account:
//   firebase functions:secrets:set TWILIO_ACCOUNT_SID
//   firebase functions:secrets:set TWILIO_AUTH_TOKEN
//   firebase functions:secrets:set TWILIO_FROM_NUMBER
// Until set, SMS delivery is skipped and email-only mode is used.

// ── deliverReceipt ─────────────────────────────────────────────────────────
export const deliverReceipt = onDocumentCreated(
  {
    document: 'venues/{venueId}/receipt_deliveries/{deliveryId}',
    secrets: [SENDGRID_API_KEY, SENDGRID_FROM, SENDGRID_NAME],
    timeoutSeconds: 60,
  },
  async (event) => {
    const { venueId, deliveryId } = event.params;
    const snap = event.data;
    if (!snap) return;
    const delivery = snap.data();

    // Idempotency guard
    if (delivery.status && delivery.status !== 'queued') {
      console.log(`[${deliveryId}] Skipping — status is already '${delivery.status}'`);
      return;
    }

    const deliveryRef = db.doc(`venues/${venueId}/receipt_deliveries/${deliveryId}`);
    await deliveryRef.update({ status: 'sending', startedAt: FieldValue.serverTimestamp() });

    try {
      const [orderSnap, venueSnap] = await Promise.all([
        db.doc(`venues/${venueId}/orders/${delivery.orderId}`).get(),
        db.doc(`venues/${venueId}`).get(),
      ]);

      // For test receipts the order may not exist in Firestore —
      // use the embedded testOrder payload instead.
      const isTest = !!delivery.isTest;
      let order;
      if (isTest && delivery.testOrder) {
        order = { id: delivery.orderId, ...delivery.testOrder };
      } else {
        if (!orderSnap.exists) throw new Error(`Order ${delivery.orderId} not found`);
        order = { id: orderSnap.id, ...orderSnap.data() };
      }
      const venue    = venueSnap.exists ? venueSnap.data() : {};
      const customer = delivery.customer || {};

      // Use venue display settings saved by ReceiptSetupPanel (or fall back to env secrets)
      const fromEmail = venue.receiptFromEmail || safeSecret(SENDGRID_FROM);
      const fromName  = venue.receiptFromName  || venue.name || safeSecret(SENDGRID_NAME) || 'HospoStack';
      const replyTo   = venue.receiptReplyTo   || fromEmail;

      const result = { email: null, sms: null, errors: [] };

      // ── Email ──────────────────────────────────────────────────────────
      const sgKey = safeSecret(SENDGRID_API_KEY);
      if (customer.email && sgKey && fromEmail) {
        try {
          sgMail.setApiKey(sgKey);
          await sgMail.send({
            to:      customer.email.trim(),
            from:    { email: fromEmail.trim(), name: fromName },
            replyTo: replyTo || undefined,
            subject: `Your receipt from ${venue.name || fromName} — ${fmtAUD(order.total)}`,
            text:    renderText(order, venue, customer),
            html:    renderHTML(order, venue, customer),
            trackingSettings: { clickTracking: { enable: false }, openTracking: { enable: true } },
          });
          result.email = 'sent';
          console.log(`[${deliveryId}] Email sent to ${customer.email}`);
        } catch (e) {
          result.email = 'failed';
          result.errors.push(`email: ${e.message}`);
          console.error(`[${deliveryId}] Email failed:`, e.message);
        }
      } else if (customer.email) {
        result.email = 'skipped_no_config';
        console.warn(`[${deliveryId}] Email skipped — SENDGRID_API_KEY or FROM_EMAIL not set`);
      }

      // ── SMS ────────────────────────────────────────────────────────────
      // Twilio secrets read from environment — optional, won't crash if not set
      const twilioSid   = process.env.TWILIO_ACCOUNT_SID || '';
      const twilioToken = process.env.TWILIO_AUTH_TOKEN  || '';
      const twilioFrom  = process.env.TWILIO_FROM_NUMBER || '';

      if (customer.phone && twilioSid && twilioToken && twilioFrom) {
        try {
          const client = twilio(twilioSid, twilioToken);
          await client.messages.create({
            to:   normalizeAU(customer.phone),
            from: twilioFrom,
            body: renderSMS(order, venue),
          });
          result.sms = 'sent';
          console.log(`[${deliveryId}] SMS sent to ${customer.phone}`);
        } catch (e) {
          result.sms = 'failed';
          result.errors.push(`sms: ${e.message}`);
          console.error(`[${deliveryId}] SMS failed:`, e.message);
        }
      } else if (customer.phone) {
        result.sms = 'skipped_no_config';
        console.warn(`[${deliveryId}] SMS skipped — Twilio secrets not set`);
      }

      // Determine overall status
      const neitherConfigured = !result.email && !result.sms &&
        !customer.email && !customer.phone;
      const allSkipped = (result.email === 'skipped_no_config' || !customer.email) &&
                         (result.sms   === 'skipped_no_config' || !customer.phone);

      let overallStatus;
      if (neitherConfigured)                               overallStatus = 'no_contact';
      else if (allSkipped)                                 overallStatus = 'no_channels_configured';
      else if (!result.errors.length)                      overallStatus = 'delivered';
      else if (result.email === 'sent' || result.sms === 'sent') overallStatus = 'partial';
      else                                                 overallStatus = 'failed';

      // Update delivery doc
      await deliveryRef.update({
        status:      overallStatus,
        result,
        completedAt: FieldValue.serverTimestamp(),
      });

      // Stamp the order for Reports
      await db.doc(`venues/${venueId}/orders/${delivery.orderId}`).update({
        receiptDelivery: {
          status:       overallStatus,
          email:        result.email,
          sms:          result.sms,
          completedAt:  FieldValue.serverTimestamp(),
          deliveryDocId: deliveryId,
        }
      }).catch(() => {});

      console.log(`[${deliveryId}] Done — ${overallStatus}`);

    } catch (err) {
      console.error(`[${deliveryId}] Fatal error:`, err);
      await deliveryRef.update({
        status: 'error',
        error:  err.message,
        completedAt: FieldValue.serverTimestamp(),
      }).catch(() => {});
    }
  }
);

// ── resendReceipt (HTTPS callable) ─────────────────────────────────────────
export const resendReceipt = onCall(
  { secrets: [] },
  async (req) => {
    const { venueId, orderId, customer } = req.data || {};
    if (!venueId || !orderId) throw new HttpsError('invalid-argument', 'venueId and orderId required');

    let recipient = customer;
    if (!recipient?.email && !recipient?.phone) {
      const snap = await db.doc(`venues/${venueId}/orders/${orderId}`).get();
      if (!snap.exists) throw new HttpsError('not-found', 'order not found');
      recipient = snap.data().customer || null;
    }
    if (!recipient || (!recipient.email && !recipient.phone)) {
      throw new HttpsError('failed-precondition', 'No contact details available');
    }

    const ref = await db.collection(`venues/${venueId}/receipt_deliveries`).add({
      orderId,
      customer:    recipient,
      status:      'queued',
      resend:      true,
      createdAt:   FieldValue.serverTimestamp(),
      requestedBy: req.auth?.uid || 'manager',
    });

    return { ok: true, deliveryId: ref.id };
  }
);

// ── checkReceiptSetup (callable — lets the UI verify secrets are configured) ─
export const checkReceiptSetup = onCall(
  { secrets: [SENDGRID_API_KEY, SENDGRID_FROM, SENDGRID_NAME] },
  async () => {
    const sgKey   = safeSecret(SENDGRID_API_KEY);
    const sgFrom  = safeSecret(SENDGRID_FROM);
    const twSid   = process.env.TWILIO_ACCOUNT_SID || '';
    const twToken = process.env.TWILIO_AUTH_TOKEN  || '';
    const twFrom  = process.env.TWILIO_FROM_NUMBER || '';
    return {
      email: { configured: !!(sgKey && sgFrom), from: sgFrom || null },
      sms:   { configured: !!(twSid && twToken && twFrom), from: twFrom || null },
    };
  }
);

// ── Helpers ─────────────────────────────────────────────────────────────────

function safeSecret(s) { try { return s.value() || ''; } catch { return ''; } }

function normalizeAU(p) {
  const d = (p || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+'))  return d;
  if (d.startsWith('0'))  return '+61' + d.slice(1);
  if (d.startsWith('61')) return '+' + d;
  return '+' + d;
}

function fmtAUD(n) { return '$' + (+(n || 0)).toFixed(2); }

function fmtDate(ts) {
  const d = ts?.toDate?.() || new Date();
  return d.toLocaleString('en-AU', {
    timeZone: 'Australia/Perth',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function renderText(order, venue, customer) {
  const vn = venue.name || 'Your venue';
  const lines = [
    `RECEIPT — ${vn}`,
    `Order #${(order.id || '').slice(-6).toUpperCase()}`,
    `Date: ${fmtDate(order.paidAt)}`,
    customer.name ? `Customer: ${customer.name}` : '',
    order.tableId  ? `Table: ${order.tableNumber || order.tableId}` : `Type: ${order.orderType || 'Takeaway'}`,
    '',
    '─── Items ───────────────────────────',
    ...(order.items || []).map(it => {
      const sel = it.selections?.length ? ` (${it.selections.map(s => s.label).join(', ')})` : '';
      const note = it.notes ? `\n     Note: ${it.notes}` : '';
      return `  ${it.qty}×  ${it.name}${sel}  ${fmtAUD(it.price * it.qty)}${note}`;
    }),
    '─────────────────────────────────────',
    `  Subtotal (ex GST)  ${fmtAUD((order.total||0) - (order.gst||0))}`,
    `  GST (10%)          ${fmtAUD(order.gst||0)}`,
    `  TOTAL              ${fmtAUD(order.total)}`,
    '',
    ...(order.payments||[]).map(p => `  Paid by ${p.method.toUpperCase()}: ${fmtAUD(p.amount)}`),
    '',
    `Thank you for dining at ${vn}!`,
    venue.abn ? `ABN: ${venue.abn}` : '',
    `Sent via HospoStack`,
  ].filter(l => l !== undefined);
  return lines.join('\n');
}

function renderSMS(order, venue) {
  const items = (order.items || []);
  const summary = items.length <= 3
    ? items.map(i => `${i.qty}×${i.name}`).join(', ')
    : `${items.length} items`;
  return `${venue.name || 'Your venue'}: Receipt for ${fmtAUD(order.total)} — ${summary}. ` +
    `Order #${(order.id||'').slice(-6).toUpperCase()}. ` +
    (order.tableId ? `Table ${order.tableNumber || ''}` : 'Takeaway') +
    '. Thanks for dining with us!';
}

function esc(s = '') {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderHTML(order, venue, customer) {
  const vn     = esc(venue.name || 'Your venue');
  const ref    = (order.id||'').slice(-6).toUpperCase();
  const abn    = venue.abn ? `<br>ABN ${esc(venue.abn)}` : '';
  const subtot = (order.total||0) - (order.gst||0);

  const itemRows = (order.items||[]).map(it => {
    const sel  = it.selections?.length
      ? `<div style="font-size:11px;color:#8a7055;margin-top:3px;">${esc(it.selections.map(s=>s.label).join(' · '))}</div>` : '';
    const note = it.notes
      ? `<div style="font-size:11px;color:#8a7055;font-style:italic;margin-top:3px;">${esc(it.notes)}</div>` : '';
    return `<tr>
      <td style="padding:10px 0;border-bottom:1px solid #efeae3;font-family:monospace;color:#c97a45;width:36px;vertical-align:top;font-weight:700">${it.qty}×</td>
      <td style="padding:10px 0;border-bottom:1px solid #efeae3;vertical-align:top">
        <div style="font-size:15px;color:#1c1510;font-weight:500">${esc(it.name)}</div>${sel}${note}
      </td>
      <td style="padding:10px 0;border-bottom:1px solid #efeae3;font-family:monospace;text-align:right;vertical-align:top;color:#1c1510;font-weight:600">
        ${fmtAUD(it.price * it.qty)}
      </td>
    </tr>`;
  }).join('');

  const payBadges = (order.payments||[]).map(p =>
    `<span style="display:inline-block;background:#f0e8dc;color:#7a5030;font-family:monospace;font-size:12px;padding:3px 10px;border-radius:999px;margin:3px 4px 3px 0;text-transform:capitalize">${esc(p.method)} ${fmtAUD(p.amount)}</span>`
  ).join('');

  const orderMeta = order.tableId
    ? `Table ${esc(String(order.tableNumber || order.tableId))}`
    : esc(order.orderType || 'Takeaway');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Receipt — ${vn}</title>
</head>
<body style="margin:0;padding:0;background:#faf5ed;font-family:Georgia,'Times New Roman',serif;-webkit-font-smoothing:antialiased">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf5ed;padding:32px 12px">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0"
  style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);max-width:100%">

  <!-- Header -->
  <tr>
    <td style="background:linear-gradient(135deg,#2a1e14 0%,#1a1208 100%);padding:32px 36px;text-align:center">
      <div style="font-size:28px;font-style:italic;letter-spacing:-0.02em;color:#f5e6c8;margin:0">${vn}</div>
      <div style="font-family:-apple-system,sans-serif;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#8a7055;margin-top:8px">Tax Invoice · Digital Receipt</div>
      ${ref ? `<div style="font-family:monospace;font-size:11px;color:#6a5040;margin-top:6px;letter-spacing:0.1em">#${ref}</div>` : ''}
      <div style="margin-top:20px;font-family:monospace;font-size:26px;font-weight:700;color:#ff7a45">${fmtAUD(order.total)}</div>
    </td>
  </tr>

  <!-- Meta -->
  <tr>
    <td style="padding:20px 36px 8px">
      <table role="presentation" width="100%" style="font-family:-apple-system,sans-serif;font-size:13px;border-collapse:collapse">
        ${customer.name ? `<tr><td style="color:#8a7055;padding:4px 0;width:100px">Customer</td><td style="color:#1c1510;font-weight:600">${esc(customer.name)}</td></tr>` : ''}
        <tr><td style="color:#8a7055;padding:4px 0">Date</td><td style="color:#1c1510;font-family:monospace;font-size:12px">${esc(fmtDate(order.paidAt))}</td></tr>
        <tr><td style="color:#8a7055;padding:4px 0">Order</td><td style="color:#1c1510">${orderMeta}</td></tr>
      </table>
    </td>
  </tr>

  <!-- Items -->
  <tr>
    <td style="padding:8px 36px">
      <table role="presentation" width="100%" style="border-collapse:collapse;font-family:-apple-system,sans-serif">
        ${itemRows}
      </table>
    </td>
  </tr>

  <!-- Totals -->
  <tr>
    <td style="padding:12px 36px 20px">
      <table role="presentation" width="100%" style="font-family:monospace;font-size:13px;border-collapse:collapse">
        <tr>
          <td style="color:#8a7055;padding:3px 0">Subtotal (ex GST)</td>
          <td style="text-align:right;color:#1c1510;padding:3px 0">${fmtAUD(subtot)}</td>
        </tr>
        <tr>
          <td style="color:#8a7055;padding:3px 0">GST (10%)</td>
          <td style="text-align:right;color:#1c1510;padding:3px 0">${fmtAUD(order.gst||0)}</td>
        </tr>
        <tr>
          <td colspan="2"><div style="border-top:1px dashed #d4c8b0;margin:10px 0"></div></td>
        </tr>
        <tr>
          <td style="font-size:18px;color:#1c1510;font-family:Georgia,serif;font-style:italic">Total</td>
          <td style="text-align:right;font-size:24px;color:#c97a45;font-weight:700">${fmtAUD(order.total)}</td>
        </tr>
      </table>
      ${payBadges ? `<div style="margin-top:14px;padding-top:12px;border-top:1px solid #efeae3">${payBadges}</div>` : ''}
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background:#faf5ed;padding:20px 36px;text-align:center;font-family:-apple-system,sans-serif;font-size:12px;color:#8a7055;line-height:1.6;border-top:1px solid #efeae3">
      Thank you for dining with us — see you again soon!
      ${abn}
      <br><span style="font-size:10px;color:#b0a090">Sent via HospoStack POS</span>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}
