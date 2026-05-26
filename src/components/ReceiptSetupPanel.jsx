import { useState, useEffect } from 'react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { getVenue, updateVenue, checkReceiptSetup, getVenueId } from '../lib/data';

export default function ReceiptSetupPanel({ onToast }) {
  const [venue,     setVenue]     = useState(null);
  const [status,    setStatus]    = useState(null);   // null | checking | result obj
  const [checking,  setChecking]  = useState(false);
  const [fromName,  setFromName]  = useState('');
  const [fromEmail, setFromEmail] = useState('');
  const [replyTo,   setReplyTo]   = useState('');
  const [saving,    setSaving]    = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testPhone, setTestPhone] = useState('');
  const [testing,   setTesting]   = useState(false);
  const [testResult,setTestResult]= useState(null);
  const [open,      setOpen]      = useState(null);

  useEffect(() => {
    getVenue().then(v => {
      if (!v) return;
      setVenue(v);
      setFromName(v.receiptFromName  || v.name || '');
      setFromEmail(v.receiptFromEmail || '');
      setReplyTo(v.receiptReplyTo   || '');
    });
  }, []);

  const checkStatus = async () => {
    setChecking(true);
    setStatus(null);
    try {
      const result = await checkReceiptSetup();
      setStatus(result);
    } catch (e) {
      setStatus({ deployed: false, error: e.message });
    } finally {
      setChecking(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      await updateVenue({
        receiptFromName:  fromName.trim(),
        receiptFromEmail: fromEmail.trim(),
        receiptReplyTo:   replyTo.trim(),
      });
      onToast?.('✓ Receipt settings saved');
    } catch (e) {
      onToast?.('Save failed: ' + e.message);
    } finally { setSaving(false); }
  };

  const sendTestReceipt = async () => {
    if (!testEmail.trim() && !testPhone.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const venueId = getVenueId();
      const testId  = 'test-' + Date.now();
      const ref = await addDoc(
        collection(db, 'venues', venueId, 'receipt_deliveries'),
        {
          orderId:  testId,
          customer: {
            name:  'Test Customer',
            email: testEmail.trim() || null,
            phone: testPhone.trim() || null,
          },
          status:   'queued',
          isTest:   true,
          testOrder: {
            id:        testId,
            orderType: 'takeaway',
            total:     42.90,
            gst:       3.90,
            items: [
              { name: 'Butter Chicken', qty: 1, price: 22.90, selections: [] },
              { name: 'Garlic Naan',    qty: 2, price: 5.00,  selections: [] },
              { name: 'Mango Lassi',    qty: 1, price: 6.50,  selections: [] },
            ],
            payments: [{ method: 'eftpos', amount: 42.90 }],
          },
          createdAt: serverTimestamp(),
        }
      );
      setTestResult({ queued: true, id: ref.id });
      onToast?.('Test receipt queued — check your email in ~30 seconds');
    } catch (e) {
      setTestResult({ error: e.message });
      onToast?.('Test failed: ' + e.message, 'error');
    } finally { setTesting(false); }
  };

  // ── Status badge colours ──────────────────────────────────────────────────
  const StatusBadge = ({ ok, label, sub }) => (
    <div style={{
      background: ok ? 'var(--green-deep)' : 'var(--red-deep)',
      border: `1px solid ${ok ? 'rgba(74,222,128,0.25)' : 'rgba(248,113,113,0.25)'}`,
      borderRadius: 'var(--radius)', padding: '12px 16px',
      display: 'flex', alignItems: 'flex-start', gap: 12
    }}>
      <span style={{ fontSize: 20, flexShrink: 0 }}>{ok ? '✅' : '❌'}</span>
      <div>
        <div style={{ fontWeight: 700, fontSize: 14, color: ok ? 'var(--green)' : 'var(--red)' }}>{label}</div>
        {sub && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>{sub}</div>}
      </div>
    </div>
  );

  const Accordion = ({ id, title, icon, children }) => {
    const isOpen = open === id;
    return (
      <div style={{ border: '1.5px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 8 }}>
        <button
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px',
            background: isOpen ? 'var(--surface-2)' : 'var(--surface)', cursor: 'pointer', textAlign: 'left' }}
          onClick={() => setOpen(isOpen ? null : id)}
        >
          <span style={{ fontSize: 18 }}>{icon}</span>
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', flex: 1 }}>{title}</span>
          <span style={{ color: 'var(--text-3)', fontSize: 14 }}>{isOpen ? '▲' : '▼'}</span>
        </button>
        {isOpen && (
          <div style={{ padding: '16px 20px 20px', borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
            {children}
          </div>
        )}
      </div>
    );
  };

  const Code = ({ c }) => (
    <pre style={{
      background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
      padding: '12px 16px', fontSize: 12, fontFamily: 'var(--font-mono)',
      color: 'var(--text-2)', overflowX: 'auto', margin: '10px 0',
      lineHeight: 1.8, userSelect: 'all', whiteSpace: 'pre-wrap'
    }}>{c}</pre>
  );

  return (
    <>
      <h3 style={{ marginBottom: 4 }}>Digital Receipts</h3>
      <p className="subtitle" style={{ marginBottom: 24 }}>
        Send customers a branded HTML email receipt and/or an SMS confirmation instantly after payment.
        Powered by Firebase Cloud Functions + SendGrid + Twilio.
      </p>

      {/* ── Live status check ────────────────────────────────────────────── */}
      <div style={{
        background: 'var(--surface-2)', border: '1.5px solid var(--border)',
        borderRadius: 'var(--radius-lg)', padding: '20px 22px', marginBottom: 24
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>System status</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
              Check whether the Cloud Function is deployed and secrets are set
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={checkStatus} disabled={checking}>
            {checking ? '⏳ Checking…' : '🔍 Check status'}
          </button>
        </div>

        {status === null && !checking && (
          <div style={{ fontSize: 13, color: 'var(--text-3)', textAlign: 'center', padding: '12px 0' }}>
            Click "Check status" to verify your setup
          </div>
        )}

        {status && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <StatusBadge
              ok={status.deployed}
              label={status.deployed ? 'Cloud Function deployed ✓' : 'Cloud Function not deployed'}
              sub={status.deployed
                ? 'deliverReceipt is running in australia-southeast1'
                : status.notDeployed
                  ? 'Run: firebase deploy --only functions --project snspos-661a4'
                  : `Error: ${status.error}`}
            />
            {status.deployed && (
              <>
                <StatusBadge
                  ok={status.email?.configured}
                  label={status.email?.configured
                    ? `Email ready — sending from ${status.email.from}`
                    : 'Email not configured — SENDGRID_API_KEY or SENDGRID_FROM_EMAIL missing'}
                  sub={!status.email?.configured ? 'Run: firebase functions:secrets:set SENDGRID_API_KEY' : null}
                />
                <StatusBadge
                  ok={status.sms?.configured}
                  label={status.sms?.configured
                    ? `SMS ready — sending from ${status.sms.from}`
                    : 'SMS not configured (optional) — Twilio secrets missing'}
                  sub={!status.sms?.configured ? 'Run: firebase functions:secrets:set TWILIO_ACCOUNT_SID' : null}
                />
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Test send ────────────────────────────────────────────────────── */}
      <div style={{
        background: 'color-mix(in srgb, var(--brand) 8%, var(--surface))',
        border: `1.5px solid color-mix(in srgb, var(--brand) 30%, var(--border))`,
        borderRadius: 'var(--radius-lg)', padding: '20px 22px', marginBottom: 24
      }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>📨 Send a test receipt</div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 14 }}>
          Sends a sample order receipt to your own email/phone to verify delivery end-to-end.
          The Cloud Function must be deployed first.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: 11 }}>📧 Your email</label>
            <input type="email" value={testEmail} onChange={e => setTestEmail(e.target.value)}
              placeholder="your@email.com" disabled={testing} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: 11 }}>💬 Your mobile</label>
            <input type="tel" value={testPhone} onChange={e => setTestPhone(e.target.value)}
              placeholder="04xx xxx xxx" style={{ fontFamily: 'var(--font-mono)' }} disabled={testing} />
          </div>
        </div>
        {testResult && (
          <div style={{
            fontSize: 12, padding: '8px 12px', borderRadius: 6, marginBottom: 10,
            background: testResult.error ? 'var(--red-deep)' : 'var(--green-deep)',
            color:      testResult.error ? 'var(--red)' : 'var(--green)',
            border: `1px solid ${testResult.error ? 'rgba(248,113,113,0.2)' : 'rgba(74,222,128,0.2)'}`
          }}>
            {testResult.error
              ? `❌ ${testResult.error}`
              : `✅ Test queued (doc ${testResult.id?.slice(-6)}). Check your email/phone in ~30s. If nothing arrives, click Check Status above.`}
          </div>
        )}
        <button
          className="btn btn-primary btn-sm"
          onClick={sendTestReceipt}
          disabled={testing || (!testEmail.trim() && !testPhone.trim())}
        >
          {testing ? '⏳ Sending…' : '📨 Send test receipt'}
        </button>
      </div>

      {/* ── Sender settings (saved to Firestore — no redeploy needed) ──── */}
      <div className="section" style={{ marginBottom: 24 }}>
        <div className="section-head"><h4>Sender settings</h4></div>
        <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14, lineHeight: 1.6 }}>
          These are saved to Firestore and read by the Cloud Function when rendering receipts.
          Change them here anytime — no redeployment needed.
        </p>
        <div style={{ maxWidth: 540, display: 'flex', flexDirection: 'column', gap: 0 }}>
          <div className="field-row">
            <div className="field">
              <label>Sender display name</label>
              <input value={fromName} onChange={e => setFromName(e.target.value)}
                placeholder={venue?.name || 'Sizzle N Sambar'} />
            </div>
            <div className="field">
              <label>Reply-to email</label>
              <input type="email" value={replyTo} onChange={e => setReplyTo(e.target.value)}
                placeholder="info@sizzlensambar.com.au" />
            </div>
          </div>
          <div className="field">
            <label>
              Verified sender email
              <span style={{ color: 'var(--text-3)', fontWeight: 400, marginLeft: 6, fontSize: 11 }}>
                — must be verified in your SendGrid account
              </span>
            </label>
            <input type="email" value={fromEmail} onChange={e => setFromEmail(e.target.value)}
              placeholder="receipts@sizzlensambar.com.au" />
          </div>
          <button className="btn btn-primary btn-sm" onClick={saveSettings} disabled={saving} style={{ marginTop: 8, alignSelf: 'flex-start' }}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </div>

      {/* ── Setup guides ─────────────────────────────────────────────────── */}
      <h4 style={{ marginBottom: 12, color: 'var(--text-2)', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        Setup guide
      </h4>

      <Accordion id="prereq" icon="🔧" title="Prerequisites — Node, Firebase CLI, project login">
        <ol style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 2.2, paddingLeft: 18 }}>
          <li>Install Node 20+ — <a href="https://nodejs.org" target="_blank" rel="noreferrer" style={{ color: 'var(--brand)' }}>nodejs.org</a></li>
          <li>Install Firebase CLI: <code style={{ background: 'var(--bg)', padding: '1px 6px', borderRadius: 4, fontFamily: 'monospace' }}>npm install -g firebase-tools</code></li>
          <li>Login: <code style={{ background: 'var(--bg)', padding: '1px 6px', borderRadius: 4, fontFamily: 'monospace' }}>firebase login</code></li>
          <li>Upgrade Firebase project to <b>Blaze plan</b> (pay-as-you-go — free tier covers normal restaurant use)
            <br /><a href="https://console.firebase.google.com/project/snspos-661a4/usage/details" target="_blank" rel="noreferrer" style={{ color: 'var(--brand)' }}>Firebase Console → snspos-661a4 → Upgrade to Blaze →</a>
          </li>
        </ol>
      </Accordion>

      <Accordion id="sendgrid" icon="📧" title="SendGrid — email receipts (free 100/day)">
        <ol style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 2, paddingLeft: 18, marginBottom: 10 }}>
          <li>Sign up: <a href="https://signup.sendgrid.com" target="_blank" rel="noreferrer" style={{ color: 'var(--brand)' }}>signup.sendgrid.com</a> — free forever up to 100 emails/day</li>
          <li>Verify a sender: Settings → Sender Authentication → "Verify a Single Sender"
            <br /><span style={{ fontSize: 12, color: 'var(--text-3)' }}>Use an email you own, e.g. receipts@sizzlensambar.com.au</span></li>
          <li>Create an API key: Settings → API Keys → Create API Key → Full Access</li>
          <li>Set the secrets in your terminal from the repo root:</li>
        </ol>
        <Code c={`cd /path/to/HospoStack

firebase functions:secrets:set SENDGRID_API_KEY
# Paste your SendGrid API key when prompted

firebase functions:secrets:set SENDGRID_FROM_EMAIL
# e.g.  receipts@sizzlensambar.com.au

firebase functions:secrets:set SENDGRID_FROM_NAME
# e.g.  Sizzle N Sambar`} />
        <div style={{ fontSize: 12, color: 'var(--amber)', background: 'var(--amber-deep)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 6, padding: '8px 12px' }}>
          ⚠️ The "From" email must match a verified sender in SendGrid, or emails will bounce.
        </div>
      </Accordion>

      <Accordion id="twilio" icon="💬" title="Twilio — SMS receipts (optional, ~$0.085/SMS)">
        <ol style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 2, paddingLeft: 18, marginBottom: 10 }}>
          <li>Sign up: <a href="https://www.twilio.com/try-twilio" target="_blank" rel="noreferrer" style={{ color: 'var(--brand)' }}>twilio.com/try-twilio</a> — free trial ~$15 credit</li>
          <li>Upgrade to a paid account for sending to any AU number (trial only sends to verified numbers)</li>
          <li>Buy an AU phone number with SMS capability (~$1.15/month)</li>
          <li>Copy your Account SID and Auth Token from the Twilio Console dashboard</li>
        </ol>
        <Code c={`firebase functions:secrets:set TWILIO_ACCOUNT_SID
# Paste your Account SID

firebase functions:secrets:set TWILIO_AUTH_TOKEN
# Paste your Auth Token

firebase functions:secrets:set TWILIO_FROM_NUMBER
# Your Twilio phone number e.g.  +61400000000`} />
      </Accordion>

      <Accordion id="deploy" icon="🚀" title="Deploy the Cloud Function">
        <Code c={`# From the HospoStack repo root:

cd functions
npm install
cd ..

firebase deploy --only functions --project snspos-661a4

# Verify it's live:
firebase functions:list --project snspos-661a4`} />
        <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 10, lineHeight: 1.6 }}>
          Deployment takes 1–2 minutes. Once done, click <b>"Check status"</b> at the top of this page
          to confirm the function is running and secrets are loaded.
        </div>
        <div style={{ marginTop: 12, background: 'var(--blue-deep)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: 6, padding: '10px 14px', fontSize: 12, color: 'var(--blue)', lineHeight: 1.6 }}>
          💡 <b>Auto-deploy via GitHub:</b> The workflow at <code>.github/workflows/deploy-functions.yml</code> deploys
          automatically when you push changes to <code>functions/</code>. Add
          <code> FIREBASE_SERVICE_ACCOUNT_JSON</code> and <code>FIREBASE_PROJECT_ID=snspos-661a4</code>
          to your GitHub repo Secrets.
        </div>
      </Accordion>

      <Accordion id="troubleshoot" icon="🔍" title="Troubleshooting — not receiving receipts">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            ['Status stuck at "queued"', 'Cloud Function is not deployed. Run: firebase deploy --only functions --project snspos-661a4'],
            ['Status is "no_channels_configured"', 'Function is deployed but SENDGRID_API_KEY and/or SENDGRID_FROM_EMAIL secrets are missing. Re-run the firebase functions:secrets:set commands.'],
            ['Status is "failed" for email', 'Usually a SendGrid sender verification issue. Check that SENDGRID_FROM_EMAIL is a verified sender in your SendGrid account.'],
            ['Status is "failed" for SMS', 'Check your Twilio account is active (not trial) and the TO number is a valid AU mobile. Run: firebase functions:log --project snspos-661a4'],
            ['Email lands in spam', 'Set up domain authentication in SendGrid (Settings → Sender Authentication → Domain Authentication). Verifying a full domain dramatically improves deliverability.'],
            ['Twilio trial won\'t send', 'Trial accounts can only send to Twilio-verified numbers. Upgrade to a paid account to send to any number.'],
            ['Function logs show an error', 'Run: firebase functions:log --project snspos-661a4 — this shows the exact error message from the last run.'],
          ].map(([problem, fix]) => (
            <div key={problem} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>❓ {problem}</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>{fix}</div>
            </div>
          ))}
        </div>
      </Accordion>
    </>
  );
}
