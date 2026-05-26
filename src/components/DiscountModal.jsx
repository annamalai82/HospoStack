import { useState } from 'react';
import Modal from './Modal';

/**
 * DiscountModal — apply a percentage or fixed-amount discount to the current order.
 * Quick presets for common values.
 */
export default function DiscountModal({ subtotal, currentDiscount, onApply, onClose }) {
  const [type, setType]     = useState(currentDiscount?.type || 'pct');
  const [value, setValue]   = useState(currentDiscount?.value?.toString() || '');
  const [reason, setReason] = useState(currentDiscount?.reason || '');
  const [err, setErr]       = useState('');

  const handleApply = () => {
    const v = parseFloat(value);
    if (isNaN(v) || v <= 0) return setErr('Enter a positive number');
    if (type === 'pct' && v > 100) return setErr('Percentage cannot exceed 100');
    if (type === 'amount' && v > subtotal) return setErr(`Amount cannot exceed subtotal ($${subtotal.toFixed(2)})`);
    onApply({ type, value: v, reason: reason.trim() });
  };

  const preview = type === 'pct'
    ? +(subtotal * (parseFloat(value || 0) / 100)).toFixed(2)
    : Math.min(parseFloat(value || 0), subtotal);

  return (
    <Modal
      title="🏷 Apply discount"
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply}>
            Apply discount
          </button>
        </>
      }
    >
      <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14, lineHeight: 1.6 }}>
        Discount applies to the whole order subtotal of <b style={{ color: 'var(--brand)' }}>${subtotal.toFixed(2)}</b>.
        GST is recalculated from the discounted total.
      </p>

      {/* Type toggle */}
      <div className="btn-toggle-group btn-toggle-group--2" style={{ marginBottom: 16 }}>
        <button
          className={`btn-toggle ${type === 'pct' ? 'btn-toggle--active' : ''}`}
          onClick={() => setType('pct')}
        >% Percentage</button>
        <button
          className={`btn-toggle ${type === 'amount' ? 'btn-toggle--active' : ''}`}
          onClick={() => setType('amount')}
        >$ Fixed amount</button>
      </div>

      <div className="field">
        <label>{type === 'pct' ? 'Discount %' : 'Discount amount ($)'}</label>
        <input
          value={value}
          onChange={e => { setValue(e.target.value.replace(/[^\d.]/g, '')); setErr(''); }}
          inputMode="decimal"
          autoFocus
          placeholder={type === 'pct' ? '10' : '5.00'}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, textAlign: 'center' }}
        />
      </div>

      {/* Quick presets */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {(type === 'pct'
          ? [5, 10, 15, 20, 25, 50]
          : [5, 10, 15, 20, 25, 50]
        ).map(p => (
          <button
            key={p}
            className="cat-chip"
            onClick={() => { setValue(p.toString()); setErr(''); }}
          >
            {type === 'pct' ? `${p}%` : `$${p}`}
          </button>
        ))}
      </div>

      <div className="field">
        <label>Reason <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>(optional — shown on receipt)</span></label>
        <input
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="e.g. Staff meal, Loyalty, VIP"
        />
      </div>

      {/* Preview */}
      {value && !err && (
        <div style={{
          background: 'var(--green-deep)', border: '1px solid rgba(74,222,128,0.25)',
          borderRadius: 'var(--radius)', padding: '12px 14px', marginTop: 6,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>NEW ORDER TOTAL</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: 'var(--green)' }}>
              ${(subtotal - preview).toFixed(2)}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>DISCOUNT APPLIED</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, color: 'var(--green)', fontWeight: 600 }}>
              −${preview.toFixed(2)}
            </div>
          </div>
        </div>
      )}

      {err && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 12 }}>{err}</div>}
    </Modal>
  );
}
