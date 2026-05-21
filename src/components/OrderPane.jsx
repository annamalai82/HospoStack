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
  onModifySent,   // (sentIndex, newQty) — edit a sent item
  onRemoveSent,   // (sentIndex) — remove a sent item
  onNoteChange,   // (cartIndex, note) — update note on a cart item
  onSentNoteChange, // (sentIndex, note) — update note on a sent item
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
  const [showMisc, setShowMisc] = useState(false);

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

  const handleMiscConfirm = (line) => {
    if (onAddLine) onAddLine(line);
    setShowMisc(false);
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

  const makeCartRow = (line, i) => {
    const isSent = line._sent;
    const sentIndex = isSent ? i : -1;
    const cartIndex = isSent ? -1 : i - sentItems.length;
    const editKey = isSent ? `sent-${sentIndex}` : `cart-${cartIndex}`;
    const isEditing = editingIndex === editKey;
    return (
      <CartRow
        key={i}
        line={line}
        isSent={isSent}
        isEditing={isEditing}
        onEdit={() => setEditingIndex(editKey)}
        onDone={() => setEditingIndex(null)}
        onInc={() => {
          if (isSent && onModifySent) onModifySent(sentIndex, line.qty + 1);
          else onQtyChange(cartIndex, line.qty + 1);
        }}
        onDec={() => {
          if (isSent) {
            if (line.qty <= 1) { if (onRemoveSent) onRemoveSent(sentIndex); setEditingIndex(null); }
            else if (onModifySent) onModifySent(sentIndex, line.qty - 1);
          } else {
            if (line.qty <= 1) { onRemove(cartIndex); setEditingIndex(null); }
            else onQtyChange(cartIndex, line.qty - 1);
          }
        }}
        onRemove={() => {
          if (isSent) { if (onRemoveSent) onRemoveSent(sentIndex); }
          else onRemove(cartIndex);
          setEditingIndex(null);
        }}
        onNoteChange={note => {
          if (isSent && onSentNoteChange) onSentNoteChange(sentIndex, note);
          else if (!isSent && onNoteChange) onNoteChange(cartIndex, note);
        }}
      />
    );
  };

  const menuPane = (
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
        {/* Misc item button — always visible at end of grid */}
        <button
          className="menu-item-card menu-item-card--misc"
          onClick={() => setShowMisc(true)}
          style={{ borderStyle: 'dashed', opacity: 0.75 }}
        >
          <div>
            <div className="station">misc</div>
            <div className="name">+ Miscellaneous Item</div>
          </div>
          <div className="price" style={{ color: 'var(--text-3)' }}>custom $</div>
        </button>
      </div>
    </div>
  );

  const cartContent = (
    <>
      {header}
      <div className="cart-items">
        {allLines.length === 0 ? (
          <div className="cart-empty">
            <div className="icon">🍽</div>
            <p>Tap menu items to add to order</p>
          </div>
        ) : allLines.map((line, i) => makeCartRow(line, i))}
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
        {menuPane}
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
            <button
              className="menu-item-card menu-item-card--misc"
              onClick={() => setShowMisc(true)}
              style={{ borderStyle: 'dashed', opacity: 0.75 }}
            >
              <div>
                <div className="station">misc</div>
                <div className="name">+ Miscellaneous Item</div>
              </div>
              <div className="price" style={{ color: 'var(--text-3)' }}>custom $</div>
            </button>
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
              {header && (
                <div style={{ padding: '0 0 0', borderBottom: '1px solid var(--border)' }}>
                  {header}
                </div>
              )}
              <div className="cart-items" style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
                {allLines.length === 0 ? (
                  <div className="cart-empty"><div className="icon">🍽</div><p>Tap menu items to add to order</p></div>
                ) : allLines.map((line, i) => makeCartRow(line, i))}
              </div>
              <div className="cart-totals">
                <div className="line"><span>Subtotal (ex GST)</span><span>${(total - gst).toFixed(2)}</span></div>
                <div className="line"><span>GST ({gstPct}%)</span><span>${gst.toFixed(2)}</span></div>
                <div className="line total"><span>Total</span><span>${total.toFixed(2)}</span></div>
              </div>
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

      {showMisc && (
        <MiscItemModal onCancel={() => setShowMisc(false)} onConfirm={handleMiscConfirm} />
      )}
    </>
  );
}

/* ── Misc item modal ─────────────────────────────────────────────────────── */
function MiscItemModal({ onCancel, onConfirm }) {
  const [name, setName]   = useState('');
  const [price, setPrice] = useState('');
  const [notes, setNotes] = useState('');

  const parsedPrice = parseFloat(price);
  const valid = name.trim() && !isNaN(parsedPrice) && parsedPrice > 0;

  const handleConfirm = () => {
    if (!valid) return;
    onConfirm({
      itemId: `misc-${Date.now()}`,
      name: name.trim(),
      qty: 1,
      price: parsedPrice,
      station: 'kitchen',
      course: 'main',
      selections: [],
      notes: notes.trim(),
      isMisc: true,
      status: 'pending'
    });
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Miscellaneous Item</h3>
          <button className="icon-btn" onClick={onCancel}>×</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="field">
            <label>Item name *</label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Extra sauce, Corkage"
              onKeyDown={e => e.key === 'Enter' && valid && handleConfirm()}
            />
          </div>
          <div className="field">
            <label>Price ($ inc GST) *</label>
            <input
              type="number"
              min="0"
              step="0.50"
              value={price}
              onChange={e => setPrice(e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
              onKeyDown={e => e.key === 'Enter' && valid && handleConfirm()}
            />
          </div>
          <div className="field">
            <label>Notes <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>(optional)</span></label>
            <input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. No chilli, extra crispy"
              onKeyDown={e => e.key === 'Enter' && valid && handleConfirm()}
            />
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={handleConfirm} disabled={!valid}>
            Add to Order
          </button>
        </div>
      </div>
    </div>
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

function CartRow({ line, isSent, isEditing, onEdit, onDone, onInc, onDec, onRemove, onNoteChange }) {
  const selections = line.selections || [];
  const [noteVal, setNoteVal] = useState(line.notes || '');

  // Keep local state in sync if line.notes changes externally
  useEffect(() => { setNoteVal(line.notes || ''); }, [line.notes]);

  if (isEditing) {
    return (
      <div className="cart-row cart-row--editing">
        <div className="cart-row-edit-inner">
          <div className="cart-edit-info">
            <span className="cart-edit-name">{line.name}</span>
            {isSent && (
              <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span>⚠ Already sent to kitchen</span>
                <span style={{ color: 'var(--text-3)' }}>— KDS will update</span>
              </div>
            )}
            {selections.length > 0 && <div className="cart-edit-sel">{selections.map(s => s.label).join(' · ')}</div>}
            <div className="cart-edit-unit-price">${line.price.toFixed(2)} each</div>
          </div>

          {/* Notes input */}
          <div style={{ margin: '8px 0' }}>
            <input
              value={noteVal}
              onChange={e => setNoteVal(e.target.value)}
              onBlur={() => onNoteChange && onNoteChange(noteVal)}
              placeholder="Add a note… (e.g. no chilli, extra sauce)"
              style={{ fontSize: 13, padding: '7px 10px', width: '100%', boxSizing: 'border-box', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-1)' }}
            />
          </div>

          <div className="cart-edit-controls">
            <button className="cart-edit-delete" onClick={e => { e.stopPropagation(); onRemove(); }}>
              <span>🗑</span>
              <span>Remove</span>
            </button>
            <div className="cart-edit-stepper">
              <button className="cart-edit-step dec" onClick={e => { e.stopPropagation(); onDec(); }}>−</button>
              <span className="cart-edit-qty">{line.qty}</span>
              <button className="cart-edit-step inc" onClick={e => { e.stopPropagation(); onInc(); }}>+</button>
            </div>
            <div className="cart-edit-subtotal">${(line.price * line.qty).toFixed(2)}</div>
            <button className="cart-edit-done" onClick={e => {
              e.stopPropagation();
              // Flush note on done
              if (onNoteChange) onNoteChange(noteVal);
              onDone();
            }}>✓ Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`cart-row cart-row--active`} onClick={onEdit}>
      <div className={`cart-qty-pill cart-qty-pill--tap ${isSent ? 'cart-qty-pill--sent' : ''}`}>
        {line.qty}
      </div>
      <div className="name" style={{ flex: 1 }}>
        <span>{line.name}</span>
        {line.isMisc && (
          <span className="badge" style={{ marginLeft: 6, background: 'rgba(251,191,36,0.12)', color: 'var(--amber)', fontSize: 10 }}>misc</span>
        )}
        {isSent && (
          <span className="badge" style={{ marginLeft: 6, background: 'rgba(96,165,250,0.12)', color: 'var(--blue)' }}>
            sent
          </span>
        )}
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
      <div className="price">${(line.price * line.qty).toFixed(2)}</div>
      <div className="cart-tap-hint">✎</div>
    </div>
  );
}
