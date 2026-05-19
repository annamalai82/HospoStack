import { useEffect, useMemo, useState } from 'react';
import {
  watchVouchers, createVoucher, updateVoucher, deleteVoucher
} from '../lib/data';
import Modal from './Modal';

export default function VouchersPanel() {
  const [vouchers, setVouchers] = useState([]);
  const [filter, setFilter] = useState('all'); // 'all' | 'giftcard' | 'promo' | 'active' | 'spent'
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);

  useEffect(() => watchVouchers(setVouchers), []);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    return vouchers
      .filter(v => {
        if (filter === 'giftcard' && v.kind !== 'giftcard') return false;
        if (filter === 'promo' && v.kind !== 'promo') return false;
        if (filter === 'active' && !isUsable(v)) return false;
        if (filter === 'spent' && isUsable(v)) return false;
        if (q && !v.code.includes(q) && !(v.issuedTo || '').toUpperCase().includes(q)) return false;
        return true;
      });
  }, [vouchers, filter, search]);

  const stats = useMemo(() => ({
    total: vouchers.length,
    activeGiftCards: vouchers.filter(v => v.kind === 'giftcard' && isUsable(v)).length,
    outstandingBalance: vouchers
      .filter(v => v.kind === 'giftcard' && isUsable(v))
      .reduce((s, v) => s + (v.balance || 0), 0),
    activePromos: vouchers.filter(v => v.kind === 'promo' && isUsable(v)).length,
    totalRedeemed: vouchers
      .filter(v => v.kind === 'giftcard')
      .reduce((s, v) => s + ((v.value || 0) - (v.balance || 0)), 0)
  }), [vouchers]);

  return (
    <>
      <h3>Vouchers</h3>
      <p className="subtitle">Issue gift cards and promo codes. Redeem them in Till during payment.</p>

      <div className="stat-grid">
        <Stat label="Total" value={stats.total} />
        <Stat label="Active gift cards" value={stats.activeGiftCards} />
        <Stat label="Outstanding balance" value={`$${stats.outstandingBalance.toFixed(2)}`} />
        <Stat label="Redeemed to date" value={`$${stats.totalRedeemed.toFixed(2)}`} />
        <Stat label="Active promos" value={stats.activePromos} />
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          placeholder="Search code or recipient…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 220, fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}
        />
        <button
          className="btn btn-primary"
          onClick={() => setEditing({ __new: true, kind: 'giftcard', value: 50, active: true })}
        >+ New Voucher</button>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { id: 'all', label: `All (${vouchers.length})` },
          { id: 'giftcard', label: 'Gift cards' },
          { id: 'promo', label: 'Promo codes' },
          { id: 'active', label: 'Active' },
          { id: 'spent', label: 'Expired / spent' }
        ].map(f => (
          <button
            key={f.id}
            className={`cat-chip ${filter === f.id ? 'active' : ''}`}
            onClick={() => setFilter(f.id)}
          >{f.label}</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{
          padding: 60, textAlign: 'center', color: 'var(--text-3)',
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10
        }}>
          <p>{vouchers.length === 0 ? 'No vouchers yet.' : 'No vouchers match.'}</p>
          {vouchers.length === 0 && (
            <p style={{ fontSize: 12, marginTop: 8 }}>
              Issue a gift card (e.g. SAMBAR50 for $50) or a promo code (e.g. WELCOME15 for 15% off).
            </p>
          )}
        </div>
      ) : (
        <div className="data-table">
          <div className="row head" style={{ gridTemplateColumns: '1.4fr 90px 1fr 1fr 1.2fr 90px 80px' }}>
            <div>Code</div>
            <div>Kind</div>
            <div>Value</div>
            <div>Balance / Discount</div>
            <div>Recipient</div>
            <div>Status</div>
            <div></div>
          </div>
          {filtered.map(v => {
            const usable = isUsable(v);
            return (
              <div key={v.id} className="row" style={{ gridTemplateColumns: '1.4fr 90px 1fr 1fr 1.2fr 90px 80px' }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--brand)' }}>
                    {v.code}
                  </div>
                  {v.expiresAt && (
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                      Expires {fmtDate(v.expiresAt)}
                    </div>
                  )}
                </div>
                <div>
                  <span className={`pill ${v.kind === 'giftcard' ? 'manager' : 'cashier'}`}>
                    {v.kind === 'giftcard' ? 'gift card' : 'promo'}
                  </span>
                </div>
                <div style={{ fontFamily: 'var(--font-mono)' }}>
                  {v.kind === 'giftcard'
                    ? `$${(v.value || 0).toFixed(2)}`
                    : v.percentOff ? `${v.percentOff}% off` : `$${(v.amountOff || 0).toFixed(2)} off`}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)' }}>
                  {v.kind === 'giftcard'
                    ? (
                      <span style={{
                        color: (v.balance || 0) > 0 ? 'var(--green)' : 'var(--text-3)'
                      }}>
                        ${(v.balance || 0).toFixed(2)} left
                      </span>
                    )
                    : (
                      <span style={{ color: 'var(--text-3)', fontSize: 12 }}>
                        used {v.usedCount || 0}{v.maxUses ? `/${v.maxUses}` : ''}
                      </span>
                    )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                  {v.issuedTo || <span style={{ color: 'var(--text-3)' }}>—</span>}
                  {v.issuedToContact && (
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{v.issuedToContact}</div>
                  )}
                </div>
                <div>
                  <span className={`pill ${usable ? 'active' : 'inactive'}`}>
                    {!v.active ? 'inactive' :
                     v.expiresAt && new Date(v.expiresAt) < new Date() ? 'expired' :
                     v.kind === 'giftcard' && v.balance <= 0 ? 'spent' :
                     v.maxUses && v.usedCount >= v.maxUses ? 'used up' :
                     'active'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                  <button className="icon-btn" onClick={() => setEditing(v)}>✎</button>
                  <button className="icon-btn danger" onClick={() => {
                    if ((v.usedCount || 0) > 0) {
                      alert('This voucher has been used. Set it inactive instead of deleting.');
                      return;
                    }
                    if (confirm(`Delete voucher ${v.code}?`)) deleteVoucher(v.code);
                  }}>×</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <VoucherModal
          voucher={editing}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            if (editing.__new) {
              await createVoucher(data);
            } else {
              const { code, ...rest } = data;
              await updateVoucher(editing.code, rest);
            }
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat-card">
      <div className="label">{label}</div>
      <div className="value" style={{ fontSize: 22 }}>{value}</div>
    </div>
  );
}

function VoucherModal({ voucher, onClose, onSave }) {
  const isNew = voucher.__new;
  const [code, setCode] = useState(voucher.code || '');
  const [kind, setKind] = useState(voucher.kind || 'giftcard');
  const [value, setValue] = useState(voucher.value !== undefined ? String(voucher.value) : '50');
  const [percentOff, setPercentOff] = useState(voucher.percentOff || '');
  const [amountOff, setAmountOff] = useState(voucher.amountOff || '');
  const [promoType, setPromoType] = useState(voucher.percentOff ? 'percent' : 'amount');
  const [active, setActive] = useState(voucher.active !== false);
  const [maxUses, setMaxUses] = useState(voucher.maxUses || '');
  const [expiresAt, setExpiresAt] = useState(voucher.expiresAt || '');
  const [issuedTo, setIssuedTo] = useState(voucher.issuedTo || '');
  const [issuedToContact, setIssuedToContact] = useState(voucher.issuedToContact || '');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setErr('');
    const trimmedCode = code.toUpperCase().trim();
    if (!trimmedCode) return setErr('Code is required');
    if (!/^[A-Z0-9_-]{3,20}$/.test(trimmedCode)) {
      return setErr('Code must be 3–20 letters, digits, underscore or hyphen');
    }

    const payload = {
      code: trimmedCode,
      kind,
      active,
      maxUses: maxUses ? parseInt(maxUses, 10) : null,
      expiresAt: expiresAt || null,
      issuedTo: issuedTo.trim() || null,
      issuedToContact: issuedToContact.trim() || null
    };

    if (kind === 'giftcard') {
      const v = parseFloat(value);
      if (isNaN(v) || v <= 0) return setErr('Gift card value must be > 0');
      payload.value = v;
    } else {
      if (promoType === 'percent') {
        const p = parseFloat(percentOff);
        if (isNaN(p) || p <= 0 || p > 100) return setErr('Percent off must be 1–100');
        payload.percentOff = p;
        payload.amountOff = null;
      } else {
        const a = parseFloat(amountOff);
        if (isNaN(a) || a <= 0) return setErr('Amount off must be > 0');
        payload.amountOff = a;
        payload.percentOff = null;
      }
    }

    setSaving(true);
    try { await onSave(payload); }
    catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const generateCode = () => {
    const prefix = kind === 'giftcard' ? 'GC' : 'PROMO';
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    setCode(`${prefix}${rand}`);
  };

  return (
    <Modal
      title={isNew ? 'New voucher' : `Edit ${voucher.code}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : isNew ? 'Create' : 'Save'}
          </button>
        </>
      }
    >
      <div className="field">
        <label>Voucher type</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button
            type="button"
            className={`mode-card`}
            aria-pressed={kind === 'giftcard'}
            onClick={() => isNew && setKind('giftcard')}
            disabled={!isNew}
            style={{ padding: 14, opacity: !isNew && kind !== 'giftcard' ? 0.4 : 1, cursor: isNew ? 'pointer' : 'default' }}
          >
            <div style={{ fontSize: 20 }}>🎁</div>
            <div style={{ fontSize: 13, marginTop: 8, fontWeight: 500 }}>Gift card</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
              Pre-paid $ balance, decrements on use, partial OK
            </div>
          </button>
          <button
            type="button"
            className={`mode-card`}
            aria-pressed={kind === 'promo'}
            onClick={() => isNew && setKind('promo')}
            disabled={!isNew}
            style={{ padding: 14, opacity: !isNew && kind !== 'promo' ? 0.4 : 1, cursor: isNew ? 'pointer' : 'default' }}
          >
            <div style={{ fontSize: 20 }}>🏷</div>
            <div style={{ fontSize: 13, marginTop: 8, fontWeight: 500 }}>Promo code</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
              % off or $ off, single or multi-use
            </div>
          </button>
        </div>
      </div>

      <div className="field">
        <label>Code</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 }}>
          <input
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            placeholder="e.g. SAMBAR50 or WELCOME15"
            disabled={!isNew}
            style={{
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.04em',
              opacity: isNew ? 1 : 0.6
            }}
          />
          {isNew && (
            <button className="btn" onClick={generateCode} type="button">↻ Generate</button>
          )}
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
          {isNew ? 'Code cannot be changed after creation.' : ''}
        </p>
      </div>

      {kind === 'giftcard' ? (
        <div className="field">
          <label>Value ($)</label>
          <input
            value={value}
            onChange={e => setValue(e.target.value)}
            inputMode="decimal"
            style={{ fontFamily: 'var(--font-mono)' }}
          />
        </div>
      ) : (
        <>
          <div className="field">
            <label>Discount type</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className={`cat-chip ${promoType === 'percent' ? 'active' : ''}`}
                onClick={() => setPromoType('percent')}
              >% off total</button>
              <button
                type="button"
                className={`cat-chip ${promoType === 'amount' ? 'active' : ''}`}
                onClick={() => setPromoType('amount')}
              >$ off total</button>
            </div>
          </div>
          {promoType === 'percent' ? (
            <div className="field">
              <label>Percent off</label>
              <input
                value={percentOff}
                onChange={e => setPercentOff(e.target.value)}
                inputMode="decimal"
                placeholder="15"
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            </div>
          ) : (
            <div className="field">
              <label>Amount off ($)</label>
              <input
                value={amountOff}
                onChange={e => setAmountOff(e.target.value)}
                inputMode="decimal"
                placeholder="10"
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            </div>
          )}
        </>
      )}

      <div className="field-row">
        <div className="field">
          <label>Expires (optional)</label>
          <input
            type="date"
            value={expiresAt ? expiresAt.slice(0, 10) : ''}
            onChange={e => setExpiresAt(e.target.value || null)}
          />
        </div>
        {kind === 'promo' && (
          <div className="field">
            <label>Max uses (blank = ∞)</label>
            <input
              value={maxUses}
              onChange={e => setMaxUses(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              placeholder="1"
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </div>
        )}
      </div>

      <div className="field-row">
        <div className="field">
          <label>Issued to (optional)</label>
          <input
            value={issuedTo}
            onChange={e => setIssuedTo(e.target.value)}
            placeholder="Recipient name"
          />
        </div>
        <div className="field">
          <label>Recipient contact</label>
          <input
            value={issuedToContact}
            onChange={e => setIssuedToContact(e.target.value)}
            placeholder="email or phone"
          />
        </div>
      </div>

      <div className="field">
        <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Active</span>
          <label className="switch">
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
            <span className="slider" />
          </label>
        </label>
        <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
          Inactive vouchers can't be redeemed but stay on record.
        </p>
      </div>

      {err && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{err}</div>}
    </Modal>
  );
}

function isUsable(v) {
  if (!v.active) return false;
  if (v.expiresAt && new Date(v.expiresAt) < new Date()) return false;
  if (v.kind === 'giftcard' && (v.balance || 0) <= 0) return false;
  if (v.maxUses && (v.usedCount || 0) >= v.maxUses) return false;
  return true;
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' });
}
