import { useEffect, useMemo, useState } from 'react';
import { watchCategories, watchMenuItems } from '../lib/data';
import ModifierPicker from './ModifierPicker';

/**
 * Reusable order/cart pane.
 *
 * Props:
 *   cartItems          – current line items (live array)
 *   onAdd(item)        – add menu item to cart (simple, no modifiers)
 *   onAddLine(line)    – add a fully-configured line (called from modifier picker)
 *   onQtyChange(i,q)   – change qty for line at index i
 *   onRemove(i)        – remove line at index i
 *   sentItems          – items already sent to kitchen (read-only, shown faded)
 *   header             – React node shown at top of cart
 *   footer             – React node shown at bottom of cart (actions)
 *   gstPct             – GST percentage (default 10)
 */
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

  return (
    <div className="order-screen">
      <div className="menu-pane">
        <div className="menu-search">
          <input
            placeholder="Search menu…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="menu-cat-bar">
          {cats.map(c => (
            <button
              key={c.id}
              className={`cat-chip ${activeCat === c.id && !search ? 'active' : ''}`}
              onClick={() => { setActiveCat(c.id); setSearch(''); }}
              style={activeCat === c.id && !search ? { borderColor: c.color, color: c.color } : {}}
            >{c.name}</button>
          ))}
        </div>
        <div className="menu-items-grid">
          {filteredItems.map(it => {
            const hasOptions = (it.modifierGroupIds || []).length > 0;
            return (
              <button key={it.id} className="menu-item-card" onClick={() => handleItemTap(it)}>
                <div>
                  <div className="station">
                    {it.station}
                    {hasOptions && <span style={{
                      marginLeft: 6, color: 'var(--brand)', fontSize: 9,
                      letterSpacing: '0.1em'
                    }}>· OPTIONS</span>}
                  </div>
                  <div className="name">{it.name}</div>
                </div>
                <div className="price">
                  ${it.price.toFixed(2)}
                  {hasOptions && <span style={{ color: 'var(--text-3)', fontSize: 11, fontWeight: 400 }}> +</span>}
                </div>
              </button>
            );
          })}
          {filteredItems.length === 0 && (
            <div className="empty" style={{ gridColumn: '1 / -1' }}>
              <p>No items match.</p>
            </div>
          )}
        </div>
      </div>

      <div className="cart">
        {header}
        <div className="cart-items">
          {allLines.length === 0 ? (
            <div className="cart-empty">
              <div className="icon">🍽</div>
              <p>Tap menu items to start an order</p>
            </div>
          ) : allLines.map((line, i) => {
            const isSent = line._sent;
            const cartIndex = isSent ? -1 : i - sentItems.length;
            const selections = line.selections || [];
            return (
              <div key={i} className={`cart-row ${isSent ? 'sent' : ''}`}>
                {isSent
                  ? <span className="qty">{line.qty}×</span>
                  : <span className="qty" onClick={() => onQtyChange(cartIndex, line.qty + 1)} style={{ cursor: 'pointer' }} title="Tap to +1">
                      {line.qty}×
                    </span>
                }
                <div className="name">
                  {line.name}
                  {isSent && <span className="badge">sent</span>}
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
                {!isSent && (
                  <button className="rm" onClick={() => onRemove(cartIndex)}>×</button>
                )}
              </div>
            );
          })}
        </div>

        <div className="cart-totals">
          <div className="line"><span>Subtotal (ex GST)</span><span>${(total - gst).toFixed(2)}</span></div>
          <div className="line"><span>GST ({gstPct}%)</span><span>${gst.toFixed(2)}</span></div>
          <div className="line total"><span>Total</span><span>${total.toFixed(2)}</span></div>
        </div>

        {footer}
      </div>

      {pickerItem && (
        <ModifierPicker
          item={pickerItem}
          onCancel={() => setPickerItem(null)}
          onConfirm={handlePickerConfirm}
        />
      )}
    </div>
  );
}
