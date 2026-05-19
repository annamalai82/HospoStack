import { useEffect, useMemo, useState } from 'react';
import { watchCategories, watchMenuItems } from '../lib/data';
import ModifierPicker from './ModifierPicker';

export default function OrderPane({
  cartItems = [],
  sentItems = [],
  onAdd,
  onAddLine,
  onQtyChange,
  onRemove,
  header,
  footer,
  gstPct = 10
}) {
  const [cats, setCats] = useState([]);
  const [items, setItems] = useState([]);
  const [activeCat, setActiveCat] = useState(null);
  const [search, setSearch] = useState('');
  const [pickerItem, setPickerItem] = useState(null);
  const [cartOpen, setCartOpen] = useState(false); // mobile cart drawer

  useEffect(() => watchCategories(setCats), []);
  useEffect(() => watchMenuItems(setItems), []);
  useEffect(() => {
    if (!activeCat && cats.length) setActiveCat(cats[0].id);
  }, [cats, activeCat]);

  const handleItemTap = (it) => {
    if ((it.modifierGroupIds || []).length > 0 && onAddLine) {
      setPickerItem(it);
    } else {
      onAdd(it);
    }
  };

  const handlePickerConfirm = (line) => {
    if (onAddLine) onAddLine(line);
    setPickerItem(null);
  };

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(i => {
      if (q) return i.name.toLowerCase().includes(q);
      return i.categoryId === activeCat;
    });
  }, [items, activeCat, search]);

  const allLines = [...sentItems.map(i => ({ ...i, _sent: true })), ...cartItems];
  const subtotal = allLines.reduce((s, l) => s + l.price * l.qty, 0);
  const gst = +(subtotal * (gstPct / (100 + gstPct))).toFixed(2);
  const total = +subtotal.toFixed(2);
  const itemCount = cartItems.reduce((n, l) => n + l.qty, 0)
                  + sentItems.reduce((n, l) => n + l.qty, 0);

  const [editingIndex, setEditingIndex] = useState(null); // which cart row is in edit mode

  const cartContent = (
    <>
      {header}
      <div className="cart-items">
        {allLines.length === 0 ? (
          <div className="cart-empty">
            <div className="icon">🍽</div>
            <p>Tap menu items to add to order</p>
          </div>
        ) : allLines.map((line, i) => {
          const isSent = line._sent;
          const cartIndex = isSent ? -1 : i - sentItems.length;
          const isEditing = !isSent && editingIndex === cartIndex;

          return (
            <CartRow
              key={i}
              line={line}
              isSent={isSent}
              isEditing={isEditing}
              onEdit={() => { if (!isSent) setEditingIndex(cartIndex); }}
              onDone={() => setEditingIndex(null)}
              onInc={() => onQtyChange(cartIndex, line.qty + 1)}
              onDec={() => {
                if (line.qty <= 1) { onRemove(cartIndex); setEditingIndex(null); }
                else onQtyChange(cartIndex, line.qty - 1);
              }}
              onRemove={() => { onRemove(cartIndex); setEditingIndex(null); }}
            />
          );
        })}
      </div>
      <div className="cart-totals">
        <div className="line"><span>Subtotal (ex GST)</span><span>${(total - gst).toFixed(2)}</span></div>
        <div className="line"><span>GST ({gstPct}%)</span><span>${gst.toFixed(2)}</span></div>
        <div className="line total"><span>Total</span><span>${total.toFixed(2)}</span></div>
      </div>
      {footer}
    </>
  );

  return (
    <>
      {/* ── Desktop: side-by-side ── */}
      <div className="order-screen order-screen--desktop">
        <div className="menu-pane">
          <div className="menu-search">
            <input placeholder="Search menu…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="menu-cat-bar">
            {cats.map(c => (
              <button key={c.id}
                className={`cat-chip ${activeCat === c.id && !search ? 'active' : ''}`}
                onClick={() => { setActiveCat(c.id); setSearch(''); }}
                style={activeCat === c.id && !search ? { borderColor: c.color, color: c.color } : {}}
              >{c.name}</button>
            ))}
          </div>
          <div className="menu-items-grid">
            {filteredItems.map(it => <MenuItemCard key={it.id} item={it} onTap={handleItemTap} />)}
            {filteredItems.length === 0 && <div className="empty" style={{ gridColumn: '1/-1' }}><p>No items match.</p></div>}
          </div>
        </div>
        <div className="cart">{cartContent}</div>
      </div>

      {/* ── Mobile: full-screen menu + sticky cart bar ── */}
      <div className="order-screen--mobile">
        {/* Full-height menu */}
        <div className="mobile-menu">
          <div className="menu-search">
            <input placeholder="Search menu…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="menu-cat-bar">
            {cats.map(c => (
              <button key={c.id}
                className={`cat-chip ${activeCat === c.id && !search ? 'active' : ''}`}
                onClick={() => { setActiveCat(c.id); setSearch(''); }}
                style={activeCat === c.id && !search ? { borderColor: c.color, color: c.color } : {}}
              >{c.name}</button>
            ))}
          </div>
          <div className="menu-items-grid">
            {filteredItems.map(it => <MenuItemCard key={it.id} item={it} onTap={handleItemTap} />)}
            {filteredItems.length === 0 && <div className="empty" style={{ gridColumn: '1/-1' }}><p>No items match.</p></div>}
          </div>
        </div>

        {/* Sticky bottom bar — always visible, tap to expand cart */}
        <div className="mobile-cart-bar" onClick={() => itemCount > 0 && setCartOpen(true)}>
          <div className="mobile-cart-bar-left">
            {itemCount > 0
              ? <span className="mobile-cart-count">{itemCount} item{itemCount !== 1 ? 's' : ''}</span>
              : <span style={{ color: 'var(--text-3)', fontSize: 13 }}>No items yet</span>
            }
            {itemCount > 0 && <span style={{ fontSize: 12, color: 'var(--text-3)', marginLeft: 6 }}>tap to review</span>}
          </div>
          <div className="mobile-cart-bar-right">
            {total > 0 && (
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--brand)', fontSize: 16 }}>
                ${total.toFixed(2)}
              </span>
            )}
          </div>
        </div>

        {/* Cart drawer sheet */}
        {cartOpen && (
          <div className="mobile-cart-overlay" onClick={() => setCartOpen(false)}>
            <div className="mobile-cart-sheet" onClick={e => e.stopPropagation()}>
              <div className="mobile-cart-handle-bar">
                <div className="handle" />
              </div>
              {/* Cart content */}
              {header && (
                <div style={{ padding: '0 0 0', borderBottom: '1px solid var(--border)' }}>
                  {header}
                </div>
              )}
              <div className="cart-items" style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
                {allLines.length === 0 ? (
                  <div className="cart-empty"><div className="icon">🍽</div><p>Tap menu items to add to order</p></div>
                ) : allLines.map((line, i) => {
                  const isSent = line._sent;
                  const cartIndex = isSent ? -1 : i - sentItems.length;
                  const isEditing = !isSent && editingIndex === cartIndex;
                  return (
                    <CartRow
                      key={i}
                      line={line}
                      isSent={isSent}
                      isEditing={isEditing}
                      onEdit={() => { if (!isSent) setEditingIndex(cartIndex); }}
                      onDone={() => setEditingIndex(null)}
                      onInc={() => onQtyChange(cartIndex, line.qty + 1)}
                      onDec={() => {
                        if (line.qty <= 1) { onRemove(cartIndex); setEditingIndex(null); }
                        else onQtyChange(cartIndex, line.qty - 1);
                      }}
                      onRemove={() => { onRemove(cartIndex); setEditingIndex(null); }}
                    />
                  );
                })}
              </div>
              <div className="cart-totals">
                <div className="line"><span>Subtotal (ex GST)</span><span>${(total - gst).toFixed(2)}</span></div>
                <div className="line"><span>GST ({gstPct}%)</span><span>${gst.toFixed(2)}</span></div>
                <div className="line total"><span>Total</span><span>${total.toFixed(2)}</span></div>
              </div>
              {/* Replace footer actions with full-width ones */}
              <div className="mobile-cart-actions">
                <button className="btn btn-block" style={{ background: 'var(--surface-3)', marginBottom: 8 }} onClick={() => setCartOpen(false)}>
                  ← Continue ordering
                </button>
                {footer}
              </div>
            </div>
          </div>
        )}
      </div>

      {pickerItem && (
        <ModifierPicker item={pickerItem} onCancel={() => setPickerItem(null)} onConfirm={handlePickerConfirm} />
      )}
    </>
  );
}

function MenuItemCard({ item: it, onTap }) {
  const hasOptions = (it.modifierGroupIds || []).length > 0;
  return (
    <button className="menu-item-card" onClick={() => onTap(it)}>
      <div>
        <div className="station">
          {it.station}
          {hasOptions && <span style={{ marginLeft: 5, color: 'var(--brand)', fontSize: 9, letterSpacing: '0.1em' }}>· OPTIONS</span>}
        </div>
        <div className="name">{it.name}</div>
      </div>
      <div className="price">
        ${it.price.toFixed(2)}
        {hasOptions && <span style={{ color: 'var(--text-3)', fontSize: 11, fontWeight: 400 }}> +</span>}
      </div>
    </button>
  );
}

function CartRow({ line, isSent, isEditing, onEdit, onDone, onInc, onDec, onRemove }) {
  const selections = line.selections || [];

  if (isEditing) {
    return (
      <div className="cart-row cart-row--editing">
        <div className="cart-row-edit-inner">
          <div className="cart-edit-info">
            <span className="cart-edit-name">{line.name}</span>
            {selections.length > 0 && (
              <div className="cart-edit-sel">{selections.map(s => s.label).join(' · ')}</div>
            )}
            {line.notes && <div className="cart-edit-notes">↳ {line.notes}</div>}
            <div className="cart-edit-unit-price">${line.price.toFixed(2)} each</div>
          </div>
          <div className="cart-edit-controls">
            {/* Delete button */}
            <button className="cart-edit-delete" onClick={e => { e.stopPropagation(); onRemove(); }}>
              <span>🗑</span>
              <span>Remove</span>
            </button>
            {/* Stepper */}
            <div className="cart-edit-stepper">
              <button className="cart-edit-step dec" onClick={e => { e.stopPropagation(); onDec(); }}>−</button>
              <span className="cart-edit-qty">{line.qty}</span>
              <button className="cart-edit-step inc" onClick={e => { e.stopPropagation(); onInc(); }}>+</button>
            </div>
            {/* Subtotal + done */}
            <div className="cart-edit-subtotal">${(line.price * line.qty).toFixed(2)}</div>
            <button className="cart-edit-done" onClick={e => { e.stopPropagation(); onDone(); }}>✓ Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`cart-row ${isSent ? 'cart-row--sent' : 'cart-row--active'}`}
      onClick={() => !isSent && onEdit()}
    >
      {/* Qty badge */}
      <div className={`cart-qty-pill ${isSent ? '' : 'cart-qty-pill--tap'}`}>
        {line.qty}
      </div>

      {/* Name + metadata */}
      <div className="name" style={{ flex: 1 }}>
        <span>{line.name}</span>
        {isSent && <span className="badge" style={{ marginLeft: 6 }}>sent</span>}
        {selections.length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2, lineHeight: 1.4 }}>
            {selections.map(s => s.label).join(' · ')}
          </div>
        )}
        {line.notes && (
          <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 2, fontStyle: 'italic' }}>
            ↳ {line.notes}
          </div>
        )}
      </div>

      {/* Price */}
      <div className="price">${(line.price * line.qty).toFixed(2)}</div>

      {/* Tap hint (non-sent items only) */}
      {!isSent && (
        <div className="cart-tap-hint">✎</div>
      )}
    </div>
  );
}
