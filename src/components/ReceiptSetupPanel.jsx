import { useState, useEffect } from 'react';
import { getVenue, updateVenue } from '../lib/data';

/**
 * Receipt Setup panel in Config Mode.
 * Guides managers through deploying the Cloud Function
 * and shows the current delivery status of recent receipts.
 */
export default function ReceiptSetupPanel({ onToast }) {
  const [venue, setVenue]         = useState(null);
  const [saving, setSaving]       = useState(false);
  const [fromName, setFromName]   = useState('');
  const [fromEmail, setFromEmail] = useState('');
  const [replyTo, setReplyTo]     = useState('');
  const [smsFrom, setSmsFrom]     = useState('');
  const [step, setStep]           = useState(null); // which accordion is open

  useEffect(() => {
    getVenue().then(v => {
      if (!v) return;
      setVenue(v);
      setFromName(v.receiptFromName  || v.name || '');
      setFromEmail(v.receiptFromEmail || '');
      setReplyTo(v.receiptReplyTo   || '');
      setSmsFrom(v.receiptSmsFrom   || '');
    });
  }, []);

  const saveConfig = async () => {
    setSaving(true);
    try {
      await updateVenue({
        receiptFromName:  fromName.trim(),
        receiptFromEmail: fromEmail.trim(),
        receiptReplyTo:   replyTo.trim(),
        receiptSmsFrom:   smsFrom.trim()
      });
      onToast?.('✓ Receipt settings saved');
    } catch (e) {
      onToast?.('Save failed: ' + e.message);
    } finally { setSaving(false); }
  };

  const Step = ({ id, num, title, status, children }) => {
    const open = step === id;
    const done = status === 'done';
    return (
      <div style={{
        border: `1.5px solid ${done ? 'rgba(74,222,128,0.3)' : open ? 'var(--brand)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 10
      }}>
        <button
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 14,
            padding: '14px 18px', background: done ? 'var(--green-deep)' : open ? 'var(--surface-2)' : 'var(--surface)',
            cursor: 'pointer', textAlign: 'left'
          }}
          onClick={() => setStep(open ? null : id)}
        >
          <span style={{
            width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
            background: done ? 'var(--green)' : open ? 'var(--brand)' : 'var(--surface-3)',
            color: done ? '#0a1f12' : open ? 'var(--btn-primary-text, #18120e)' : 'var(--text-3)',
            display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 800
          }}>
            {done ? '✓' : num}
          </span>
          <span style={{ fontWeight: 700, fontSize: 14, color: done ? 'var(--green)' : 'var(--text)' }}>
            {title}
          </span>
          <span style={{ marginLeft: 'auto', color: 'var(--text-3)', fontSize: 14 }}>
            {open ? '▲' : '▼'}
          </span>
        </button>
        {open && (
          <div style={{ padding: '16px 20px 20px', borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
            {children}
          </div>
        )}
      </div>
    );
  };

  const CodeBlock = ({ code }) => (
    <pre style={{
      background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
      padding: '12px 16px', fontSize: 12, fontFamily: 'var(--font-mono)',
      color: 'var(--text-2)', overflowX: 'auto', margin: '10px 0',
      lineHeight: 1.7, userSelect: 'all'
    }}>{code}</pre>
  );

  return (
    <>
      <h3>Digital Receipts — Setup</h3>
      <p className="subtitle" style={{ marginBottom: 20 }}>
        Send branded HTML email receipts and SMS confirmations to customers after payment.
        Uses Firebase Cloud Functions + SendGrid (email) + Twilio (SMS).
      </p>

      {/* Status overview */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 10, marginBottom: 24
      }}>
        {[
          { label: 'Email provider', value: 'SendGrid', sub: 'Free 100/day', color: '#4A90E2' },
          { label: 'SMS provider',   value: 'Twilio',   sub: 'Pay-per-message', color: '#F22F46' },
          { label: 'Trigger',        value: 'Firestore', sub: 'Auto on payment', color: 'var(--green)' },
          { label: 'Region',         value: 'au-southeast1', sub: 'Sydney', color: 'var(--amber)' },
        ].map(c => (
          <div key={c.label} style={{
            background: 'var(--surface-2)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: '12px 14px'
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>{c.label}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: c.color }}>{c.value}</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Step-by-step guide */}
      <Step id="billing" num="1" title="Upgrade Firebase to Blaze plan (required for Cloud Functions)">
        <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 12, lineHeight: 1.6 }}>
          Cloud Functions require the Blaze (pay-as-you-go) plan. The free tier covers
          2 million invocations/month — for a restaurant, actual cost is typically $0.
        </p>
        <a
          href="https://console.firebase.google.com/"
          target="_blank"
          rel="noreferrer"
          className="btn btn-primary btn-sm"
          style={{ textDecoration: 'none', display: 'inline-flex', marginBottom: 8 }}
        >
          Open Firebase Console →
        </a>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
          Firebase Console → Project → Spark plan → Upgrade to Blaze
        </div>
      </Step>

      <Step id="sendgrid" num="2" title="Create a free SendGrid account (email)">
        <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 10, lineHeight: 1.6 }}>
          SendGrid sends the HTML tax invoice emails. Free tier: 100 emails/day.
        </p>
        <ol style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 2, paddingLeft: 18, marginBottom: 10 }}>
          <li>Sign up at <a href="https://signup.sendgrid.com" target="_blank" rel="noreferrer" style={{ color: 'var(--brand)' }}>signup.sendgrid.com</a></li>
          <li>Settings → Sender Authentication → verify your sender email address</li>
          <li>Settings → API Keys → Create API Key → Full Access → copy it</li>
        </ol>
        <CodeBlock code={`firebase functions:secrets:set SENDGRID_API_KEY\n# Paste your key when prompted\n\nfirebase functions:secrets:set SENDGRID_FROM_EMAIL\n# e.g. receipts@sizzlensambar.com.au\n\nfirebase functions:secrets:set SENDGRID_FROM_NAME\n# e.g. Sizzle N Sambar`} />
      </Step>

      <Step id="twilio" num="3" title="Create a Twilio account (SMS) — optional">
        <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 10, lineHeight: 1.6 }}>
          Twilio sends SMS confirmations. Costs ~$0.085 per SMS. Skip if you only want email receipts.
        </p>
        <ol style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 2, paddingLeft: 18, marginBottom: 10 }}>
          <li>Sign up at <a href="https://www.twilio.com/try-twilio" target="_blank" rel="noreferrer" style={{ color: 'var(--brand)' }}>twilio.com/try-twilio</a></li>
          <li>Get a phone number with SMS capability</li>
          <li>Note your Account SID and Auth Token from the dashboard</li>
        </ol>
        <CodeBlock code={`firebase functions:secrets:set TWILIO_ACCOUNT_SID\nfirebase functions:secrets:set TWILIO_AUTH_TOKEN\nfirebase functions:secrets:set TWILIO_FROM_NUMBER\n# e.g. +61400000000`} />
      </Step>

      <Step id="deploy" num="4" title="Deploy the Cloud Function">
        <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 10, lineHeight: 1.6 }}>
          Run these commands from the HospoStack project folder on your laptop.
          Requires <a href="https://nodejs.org" target="_blank" rel="noreferrer" style={{ color: 'var(--brand)' }}>Node 20</a> and the Firebase CLI.
        </p>
        <CodeBlock code={`# Install Firebase CLI (one-time)\nnpm install -g firebase-tools\n\n# Login\nfirebase login\n\n# Install function dependencies\ncd functions && npm install && cd ..\n\n# Deploy\nfirebase deploy --only functions\n\n# Verify it deployed\nfirebase functions:list`} />
        <div style={{
          background: 'var(--blue-deep)', border: '1px solid rgba(96,165,250,0.2)',
          borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--blue)',
          marginTop: 10, lineHeight: 1.6
        }}>
          💡 <b>Auto-deploy via GitHub Actions</b> — the workflow at
          <code style={{ margin: '0 4px', padding: '1px 6px', background: 'var(--surface-2)', borderRadius: 4 }}>.github/workflows/deploy-functions.yml</code>
          deploys automatically when you push changes. Add
          <code style={{ margin: '0 4px', padding: '1px 6px', background: 'var(--surface-2)', borderRadius: 4 }}>FIREBASE_SERVICE_ACCOUNT_JSON</code>
          and
          <code style={{ margin: '0 4px', padding: '1px 6px', background: 'var(--surface-2)', borderRadius: 4 }}>FIREBASE_PROJECT_ID</code>
          to GitHub Secrets.
        </div>
      </Step>

      <Step id="test" num="5" title="Test a receipt">
        <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 10, lineHeight: 1.6 }}>
          Once deployed, take a test payment in Till mode and enter your own email/mobile on the receipt screen.
          The receipt should arrive within 10–30 seconds.
        </p>
        <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>
          To check delivery status for any order: <b>Config → Reports → Orders tab → click any order → scroll to "Send / Resend receipt"</b>.
        </p>
        <div style={{
          background: 'var(--amber-deep)', border: '1px solid rgba(251,191,36,0.25)',
          borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--amber)', marginTop: 10, lineHeight: 1.6
        }}>
          ⚠️ If status shows <b>no_channels_configured</b>, the Cloud Function is not yet deployed, or the secrets weren't set correctly.
          Check <code style={{ margin: '0 4px', padding: '1px 6px', background: 'var(--surface-2)', borderRadius: 4 }}>firebase functions:log</code> for errors.
        </div>
      </Step>

      {/* ── Display settings ── */}
      <div className="section" style={{ marginTop: 24 }}>
        <div className="section-head"><h4>Receipt display settings</h4></div>
        <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>
          These are stored in Firestore and read by the Cloud Function when rendering receipts.
          Set them here — no redeployment needed.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, maxWidth: 560 }}>
          <div className="field-row">
            <div className="field">
              <label>Sender name</label>
              <input value={fromName} onChange={e => setFromName(e.target.value)} placeholder="Sizzle N Sambar" />
            </div>
            <div className="field">
              <label>Reply-to email</label>
              <input type="email" value={replyTo} onChange={e => setReplyTo(e.target.value)} placeholder="info@sizzlensambar.com.au" />
            </div>
          </div>
          <div className="field">
            <label>Verified sender email
              <span style={{ color: 'var(--text-3)', fontWeight: 400, marginLeft: 6, fontSize: 11 }}>
                must be verified in SendGrid
              </span>
            </label>
            <input type="email" value={fromEmail} onChange={e => setFromEmail(e.target.value)} placeholder="receipts@sizzlensambar.com.au" />
          </div>
          <div style={{ marginTop: 16 }}>
            <button className="btn btn-primary" onClick={saveConfig} disabled={saving}>
              {saving ? 'Saving…' : 'Save receipt settings'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Delivery status reference ── */}
      <div className="section" style={{ marginTop: 24 }}>
        <div className="section-head"><h4>Delivery status reference</h4></div>
        <div className="data-table">
          <div className="row head" style={{ gridTemplateColumns: '140px 1fr' }}>
            <div>Status</div><div>Meaning</div>
          </div>
          {[
            ['queued',                  'Delivery doc written — Cloud Function hasn\'t picked it up yet (usually < 2 seconds)'],
            ['sending',                 'Function is actively calling SendGrid / Twilio'],
            ['delivered',               'All channels sent successfully'],
            ['partial',                 'One channel succeeded, the other failed — check Reports for detail'],
            ['failed',                  'Both channels failed — see errors[] on the delivery doc'],
            ['no_channels_configured',  'Cloud Function is not deployed or secrets not set'],
            ['error',                   'Unexpected error — run firebase functions:log to diagnose'],
          ].map(([status, meaning]) => (
            <div key={status} className="row" style={{ gridTemplateColumns: '140px 1fr' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--brand)' }}>{status}</div>
              <div style={{ fontSize: 13, color: 'var(--text-2)' }}>{meaning}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
