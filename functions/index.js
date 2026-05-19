/**
 * HospoStack — Receipt delivery function.
 *
 * Trigger: a doc is created in venues/{venueId}/receipt_deliveries/{deliveryId}.
 * Action:  read the linked order, render an HTML email + short SMS,
 *          send via SendGrid (email) and/or Twilio (SMS),
 *          mark the delivery doc with the result.
 *
 * Required secret config (set with `firebase functions:secrets:set NAME`):
 *   SENDGRID_API_KEY
 *   SENDGRID_FROM_EMAIL       (verified sender on SendGrid)
 *   SENDGRID_FROM_NAME        (e.g. "Sizzle N Sambar")
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_FROM_NUMBER        (e.g. +61400000000)
 *
 * If a secret is missing, that channel is skipped (email or SMS), but the
 * other still attempts to send. If both are missing, the delivery is marked
 * 'no_channels_configured'.
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
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
const TWILIO_SID        = defineSecret('TWILIO_ACCOUNT_SID');
const TWILIO_TOKEN      = defineSecret('TWILIO_AUTH_TOKEN');
const TWILIO_FROM       = defineSecret('TWILIO_FROM_NUMBER');

export const deliverReceipt = onDocumentCreated(
  {
    document: 'venues/{venueId}/receipt_deliveries/{deliveryId}',
    secrets: [SENDGRID_API_KEY, SENDGRID_FROM, SENDGRID_NAME, TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM]
  },
  async (event) => {
    const { venueId, deliveryId } = event.params;
    const delivery = event.data?.data();
    if (!delivery) return;

    const { orderId, customer } = delivery;
    const deliveryRef = db.doc(`venues/${venueId}/receipt_deliveries/${deliveryId}`);

    try {
      // Load order + venue
      const [orderSnap, venueSnap] = await Promise.all([
        db.doc(`venues/${venueId}/orders/${orderId}`).get(),
        db.doc(`venues/${venueId}`).get()
      ]);

      if (!orderSnap.exists) throw new Error('order_not_found');
      const order = orderSnap.data();
      const venue = venueSnap.data() || { name: 'HospoStack Venue' };

      const result = { email: null, sms: null, errors: [] };

      // ── Email via SendGrid ─────────────────────────────────────────
      const sendgridKey = SENDGRID_API_KEY.value();
      const sendgridFrom = SENDGRID_FROM.value();
      const sendgridName = SENDGRID_NAME.value() || venue.name;

      if (customer?.email && sendgridKey && sendgridFrom) {
        try {
          sgMail.setApiKey(sendgridKey);
          const html = renderReceiptHTML(order, venue, customer);
          const text = renderReceiptText(order, venue, customer);

          await sgMail.send({
            to: customer.email,
            from: { email: sendgridFrom, name: sendgridName },
            subject: `Your receipt from ${venue.name} · $${(order.total || 0).toFixed(2)}`,
            text,
            html
          });
          result.email = 'sent';
        } catch (e) {
          result.email = 'failed';
          result.errors.push(`email: ${e.message}`);
        }
      } else if (customer?.email) {
        result.email = 'skipped_no_config';
      }

      // ── SMS via Twilio ─────────────────────────────────────────────
      const twilioSid = TWILIO_SID.value();
      const twilioToken = TWILIO_TOKEN.value();
      const twilioFrom = TWILIO_FROM.value();

      if (customer?.phone && twilioSid && twilioToken && twilioFrom) {
        try {
          const client = twilio(twilioSid, twilioToken);
          const body = renderReceiptSMS(order, venue);
          await client.messages.create({
            to: normalizePhone(customer.phone),
            from: twilioFrom,
            body
          });
          result.sms = 'sent';
        } catch (e) {
          result.sms = 'failed';
          result.errors.push(`sms: ${e.message}`);
        }
      } else if (customer?.phone) {
        result.sms = 'skipped_no_config';
      }

      // No channels configured at all?
      if (!result.email && !result.sms) {
        await deliveryRef.update({
          status: 'no_channels_configured',
          completedAt: FieldValue.serverTimestamp()
        });
        return;
      }

      const overallStatus = result.errors.length
        ? (result.email === 'sent' || result.sms === 'sent' ? 'partial' : 'failed')
        : 'delivered';

      await deliveryRef.update({
        status: overallStatus,
        result,
        completedAt: FieldValue.serverTimestamp()
      });
    } catch (err) {
      await deliveryRef.update({
        status: 'error',
        error: err.message,
        completedAt: FieldValue.serverTimestamp()
      }).catch(() => {});
      console.error('Receipt delivery failed:', err);
    }
  }
);

// ── Helpers ─────────────────────────────────────────────────────────────

function normalizePhone(p) {
  const digits = (p || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  // Default to AU: 0xxx -> +61xxx
  if (digits.startsWith('0')) return '+61' + digits.slice(1);
  return '+' + digits;
}

function fmtAUD(n) {
  return '$' + (n || 0).toFixed(2);
}

function fmtTime(ts) {
  // Firestore Timestamp from admin SDK
  const d = ts?.toDate?.() || new Date();
  return d.toLocaleString('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Australia/Perth'
  });
}

function renderReceiptText(order, venue, customer) {
  const lines = [];
  lines.push(`Receipt from ${venue.name}`);
  lines.push('');
  lines.push(`Date: ${fmtTime(order.paidAt)}`);
  if (customer?.name) lines.push(`Customer: ${customer.name}`);
  if (order.tableId) lines.push(`Table: ${order.tableNumber || ''}`);
  else lines.push(`Type: ${order.orderType || 'takeaway'}`);
  lines.push('');
  lines.push('Items');
  lines.push('-----');
  (order.items || []).forEach(it => {
    lines.push(`${it.qty}x  ${it.name.padEnd(28)} ${fmtAUD(it.price * it.qty)}`);
  });
  lines.push('-----');
  lines.push(`Subtotal: ${fmtAUD((order.total || 0) - (order.gst || 0))}`);
  lines.push(`GST:      ${fmtAUD(order.gst || 0)}`);
  lines.push(`TOTAL:    ${fmtAUD(order.total || 0)}`);
  lines.push('');
  if (order.payments?.length) {
    lines.push('Payment');
    order.payments.forEach(p => lines.push(`  ${p.method.padEnd(8)} ${fmtAUD(p.amount)}`));
  }
  lines.push('');
  lines.push(`Thanks for dining with us at ${venue.name}!`);
  if (venue.abn) lines.push(`ABN: ${venue.abn}`);
  return lines.join('\n');
}

function renderReceiptSMS(order, venue) {
  return `${venue.name}: Thanks! Receipt ${fmtAUD(order.total || 0)} on ${fmtTime(order.paidAt)}. ` +
         `${(order.items || []).length} items. We'll email a full copy if you provided your address.`;
}

function renderReceiptHTML(order, venue, customer) {
  const items = (order.items || []).map(it => `
    <tr>
      <td style="padding: 10px 0; border-bottom: 1px solid #efeae3; color: #ff7a45; font-family: 'JetBrains Mono', monospace; width: 50px; vertical-align: top;">
        ${it.qty}×
      </td>
      <td style="padding: 10px 0; border-bottom: 1px solid #efeae3; vertical-align: top;">
        <div style="font-size: 15px; color: #1c1916;">${escapeHtml(it.name)}</div>
        ${it.notes ? `<div style="font-size: 12px; color: #a18b6c; margin-top: 4px;">${escapeHtml(it.notes)}</div>` : ''}
      </td>
      <td style="padding: 10px 0; border-bottom: 1px solid #efeae3; font-family: 'JetBrains Mono', monospace; text-align: right; vertical-align: top; color: #1c1916;">
        ${fmtAUD(it.price * it.qty)}
      </td>
    </tr>
  `).join('');

  const payments = (order.payments || []).map(p => `
    <span style="display: inline-block; font-family: 'JetBrains Mono', monospace; font-size: 12px; background: #f0eadf; color: #5c4a31; padding: 4px 10px; border-radius: 999px; margin-right: 6px;">
      ${escapeHtml(p.method)} ${fmtAUD(p.amount)}
    </span>
  `).join('');

  const subtotal = (order.total || 0) - (order.gst || 0);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Receipt from ${escapeHtml(venue.name)}</title>
</head>
<body style="margin: 0; padding: 0; background: #faf6ee; font-family: Georgia, 'Times New Roman', serif; -webkit-font-smoothing: antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #faf6ee; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.04);">

          <!-- Header -->
          <tr>
            <td style="padding: 36px 40px 28px; text-align: center; border-bottom: 1px solid #efeae3;">
              <div style="font-style: italic; font-size: 32px; letter-spacing: -0.02em; color: #1c1916; margin: 0;">
                ${escapeHtml(venue.name)}
              </div>
              <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: #a18b6c; margin-top: 8px;">
                Tax Invoice · Receipt
              </div>
            </td>
          </tr>

          <!-- Meta -->
          <tr>
            <td style="padding: 24px 40px 12px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 13px;">
                ${customer?.name ? `
                <tr>
                  <td style="color: #a18b6c; padding: 4px 0; width: 110px;">Customer</td>
                  <td style="color: #1c1916;">${escapeHtml(customer.name)}</td>
                </tr>` : ''}
                <tr>
                  <td style="color: #a18b6c; padding: 4px 0;">Date</td>
                  <td style="color: #1c1916; font-family: 'JetBrains Mono', monospace; font-size: 12px;">${escapeHtml(fmtTime(order.paidAt))}</td>
                </tr>
                <tr>
                  <td style="color: #a18b6c; padding: 4px 0;">Order</td>
                  <td style="color: #1c1916;">
                    ${order.tableId ? `Table ${order.tableNumber || ''}` : escapeHtml(order.orderType || 'Takeaway')}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Items -->
          <tr>
            <td style="padding: 12px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family: -apple-system, BlinkMacSystemFont, sans-serif;">
                ${items}
              </table>
            </td>
          </tr>

          <!-- Totals -->
          <tr>
            <td style="padding: 12px 40px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family: 'JetBrains Mono', monospace; font-size: 13px;">
                <tr>
                  <td style="color: #a18b6c; padding: 4px 0;">Subtotal (ex GST)</td>
                  <td style="color: #1c1916; text-align: right; padding: 4px 0;">${fmtAUD(subtotal)}</td>
                </tr>
                <tr>
                  <td style="color: #a18b6c; padding: 4px 0;">GST</td>
                  <td style="color: #1c1916; text-align: right; padding: 4px 0;">${fmtAUD(order.gst || 0)}</td>
                </tr>
                <tr>
                  <td style="border-top: 1px dashed #d6cdb8; padding-top: 10px; font-size: 17px; color: #1c1916; font-family: Georgia, serif; font-style: italic;">Total</td>
                  <td style="border-top: 1px dashed #d6cdb8; padding-top: 10px; font-size: 22px; color: #ff7a45; text-align: right; font-weight: 600;">${fmtAUD(order.total || 0)}</td>
                </tr>
              </table>
              ${payments ? `<div style="margin-top: 16px; padding-top: 14px; border-top: 1px solid #efeae3;">${payments}</div>` : ''}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background: #faf6ee; padding: 24px 40px; text-align: center; font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 12px; color: #a18b6c; line-height: 1.6;">
              Thank you for dining with us.
              ${venue.abn ? `<br>ABN ${escapeHtml(venue.abn)}` : ''}
              <br><span style="color: #c0b59a; font-size: 11px;">Receipt sent via HospoStack</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
