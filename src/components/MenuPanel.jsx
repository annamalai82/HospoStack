import { useEffect, useMemo, useState } from 'react';
import {
  watchCategories, createCategory, updateCategory, deleteCategory,
  watchAllMenuItems, createMenuItem, updateMenuItem, deleteMenuItem,
  watchModifierGroups, resetAndReseedMenu
} from '../lib/data';
import Modal from './Modal';

const STATIONS = ['kitchen', 'bar'];
const COURSES = ['starter', 'main', 'dessert', 'drink', 'side'];
const SWATCHES = ['#f59e0b','#ef4444','#8b5cf6','#10b981','#ec4899','#3b82f6','#06b6d4','#f97316','#84cc16','#a855f7'];

export default function MenuPanel({ initialTab, onToast } = {}) {
  const [cats, setCats] = useState([]);
  const [items, setItems] = useState([]);
  const [modifierGroups, setModifierGroups] = useState([]);
  const [tab, setTab] = useState(initialTab || 'items'); // 'items' | 'categories'
  const [filterCat, setFilterCat] = useState('all');
  const [editing, setEditing] = useState(null);
  const [editingCat, setEditingCat] = useState(null);
  const [reseeding, setReseeding] = useState(false);
  const [showReseedConfirm, setShowReseedConfirm] = useState(false);

  useEffect(() => watchCategories(setCats), []);
  useEffect(() => watchAllMenuItems(setItems), []);
  useEffect(() => watchModifierGroups(setModifierGroups), []);

  const catMap = useMemo(() => Object.fromEntries(cats.map(c => [c.id, c])), [cats]);
  const visibleItems = filterCat === 'all' ? items : items.filter(i => i.categoryId === filterCat);

  const handleReseed = async () => {
    setReseeding(true);
    setShowReseedConfirm(false);
    try {
      await resetAndReseedMenu();
      onToast?.('✓ Menu reset to full Sizzle N Sambar menu with correct pricing');
    } catch (e) {
      onToast?.('Reset failed: ' + e.message);
    } finally {
      setReseeding(false);
    }
  };

  return (
    <>
      <h3>Menu</h3>
      <p className="subtitle">Manage categories, items, prices, and which station each item routes to.</p>

      {/* Reseed banner */}
      <div style={{
        background: 'var(--amber-deep)', border: '1px solid rgba(251,191,36,0.3)',
        borderRadius: 'var(--radius)', padding: '10px 14px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, marginBottom: 14, flexWrap: 'wrap'
      }}>
        <span style={{ fontSize: 13, color: 'var(--amber)' }}>
          🍽 Reset menu to full SNS menu with correct per-protein pricing
        </span>
        {showReseedConfirm ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => setShowReseedConfirm(false)}>Cancel</button>
            <button
              className="btn btn-sm"
              style={{ fontSize: 12, background: 'var(--red)', color: '#fff' }}
              disabled={reseeding}
              onClick={handleReseed}
            >{reseeding ? 'Resetting…' : '⚠ Yes, reset menu'}</button>
          </div>
        ) : (
          <button
            className="btn btn-sm"
            style={{ fontSize: 12, background: 'var(--amber)', color: '#18120e', flexShrink: 0 }}
            disabled={reseeding}
            onClick={() => setShowReseedConfirm(true)}
          >Reset & Reload Menu</button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
        <button
          className={`cat-chip ${tab === 'items' ? 'active' : ''}`}
          onClick={() => setTab('items')}
        >Items ({items.length})</button>
        <button
          className={`cat-chip ${tab === 'categories' ? 'active' : ''}`}
          onClick={() => setTab('categories')}
        >Categories ({cats.length})</button>
      </div>

      {tab === 'items' && (
        <div className="section">
          <div className="section-head">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button
                className={`cat-chip ${filterCat === 'all' ? 'active' : ''}`}
                onClick={() => setFilterCat('all')}
              >All</button>
              {cats.map(c => (
                <button
                  key={c.id}
                  className={`cat-chip ${filterCat === c.id ? 'active' : ''}`}
                  onClick={() => setFilterCat(c.id)}
                  style={filterCat === c.id ? { borderColor: c.color, color: c.color } : {}}
                >{c.name}</button>
              ))}
            </div>
            <button
              className="btn btn-primary"
              onClick={() => setEditing({ __new: true, name: '', categoryId: cats[0]?.id || '', price: '', course: 'main', station: 'kitchen' })}
              disabled={cats.length === 0}
              style={cats.length === 0 ? { opacity: 0.4 } : {}}
            >+ New Item</button>
          </div>

          <div className="data-table">
            <div className="row head" style={{ gridTemplateColumns: '2.2fr 1.4fr 1fr 0.8fr 0.8fr 90px' }}>
              <div>Item</div>
              <div>Category</div>
              <div>Price</div>
              <div>Station</div>
              <div>Status</div>
              <div></div>
            </div>
            {visibleItems.map(it => (
              <div key={it.id} className="row" style={{ gridTemplateColumns: '2.2fr 1.4fr 1fr 0.8fr 0.8fr 90px' }}>
                <div>{it.name}</div>
                <div style={{ color: catMap[it.categoryId]?.color || 'var(--text-3)' }}>
                  {catMap[it.categoryId]?.name || '—'}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)' }}>${(it.price || 0).toFixed(2)}</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{it.station}</div>
                <div><span className={`pill ${it.active ? 'active' : 'inactive'}`}>{it.active ? 'active' : 'off'}</span></div>
                <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                  <button className="icon-btn" onClick={() => setEditing(it)}>✎</button>
                  <button className="icon-btn danger" onClick={() => {
                    if (confirm(`Delete "${it.name}"?`)) deleteMenuItem(it.id);
                  }}>×</button>
                </div>
              </div>
            ))}
            {visibleItems.length === 0 && (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-3)' }}>
                No items in this category yet.
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'categories' && (
        <div className="section">
          <div className="section-head">
            <h4>Categories</h4>
            <button
              className="btn btn-primary"
              onClick={() => setEditingCat({ __new: true, name: '', color: SWATCHES[0], order: cats.length + 1 })}
            >+ New Category</button>
          </div>

          <div className="data-table">
            <div className="row head" style={{ gridTemplateColumns: '40px 2fr 80px 1fr 90px' }}>
              <div></div>
              <div>Name</div>
              <div>Order</div>
              <div>Items</div>
              <div></div>
            </div>
            {cats.map(c => {
              const count = items.filter(i => i.categoryId === c.id).length;
              return (
                <div key={c.id} className="row" style={{ gridTemplateColumns: '40px 2fr 80px 1fr 90px' }}>
                  <div>
                    <div style={{ width: 16, height: 16, borderRadius: 4, background: c.color }} />
                  </div>
                  <div>{c.name}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>{c.order}</div>
                  <div style={{ color: 'var(--text-3)', fontSize: 13 }}>{count} item{count === 1 ? '' : 's'}</div>
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                    <button className="icon-btn" onClick={() => setEditingCat(c)}>✎</button>
                    <button className="icon-btn danger" onClick={() => {
                      if (count > 0) { alert(`This category has ${count} items. Move or delete them first.`); return; }
                      if (confirm(`Delete "${c.name}"?`)) deleteCategory(c.id);
                    }}>×</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {editing && (
        <ItemEditModal
          item={editing}
          cats={cats}
          modifierGroups={modifierGroups}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            if (editing.__new) await createMenuItem(data);
            else await updateMenuItem(editing.id, data);
            setEditing(null);
          }}
        />
      )}

      {editingCat && (
        <CategoryEditModal
          cat={editingCat}
          onClose={() => setEditingCat(null)}
          onSave={async (data) => {
            if (editingCat.__new) await createCategory(data);
            else await updateCategory(editingCat.id, data);
            setEditingCat(null);
          }}
        />
      )}
    </>
  );
}

function ItemEditModal({ item, cats, modifierGroups = [], onClose, onSave }) {
  const isNew = item.__new;
  const [name, setName] = useState(item.name || '');
  const [categoryId, setCategoryId] = useState(item.categoryId || cats[0]?.id || '');
  const [price, setPrice] = useState(item.price !== undefined ? String(item.price) : '');
  const [course, setCourse] = useState(item.course || 'main');
  const [station, setStation] = useState(item.station || 'kitchen');
  const [active, setActive] = useState(item.active !== false);
  const [modifierGroupIds, setModifierGroupIds] = useState(item.modifierGroupIds || []);
  const [err, setErr] = useState('');

  const toggleGroup = (gid) => {
    setModifierGroupIds(modifierGroupIds.includes(gid)
      ? modifierGroupIds.filter(x => x !== gid)
      : [...modifierGroupIds, gid]);
  };

  const save = async () => {
    setErr('');
    if (!name.trim()) return setErr('Name is required');
    const p = parseFloat(price);
    if (isNaN(p) || p < 0) return setErr('Price must be a valid number');
    if (!categoryId) return setErr('Pick a category');
    await onSave({
      name: name.trim(), categoryId, price: p, course, station, active,
      modifierGroupIds, taxPct: 10
    });
  };

  return (
    <Modal
      title={isNew ? 'New menu item' : `Edit ${item.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save</button>
        </>
      }
    >
      <div className="field">
        <label>Name</label>
        <input value={name} onChange={e => setName(e.target.value)} autoFocus />
      </div>

      <div className="field-row">
        <div className="field">
          <label>Category</label>
          <select value={categoryId} onChange={e => setCategoryId(e.target.value)}>
            {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Price (incl. GST)</label>
          <input
            value={price}
            onChange={e => setPrice(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            style={{ fontFamily: 'var(--font-mono)' }}
          />
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label>Course</label>
          <select value={course} onChange={e => setCourse(e.target.value)}>
            {COURSES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Routes to</label>
          <select value={station} onChange={e => setStation(e.target.value)}>
            {STATIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
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
          Inactive items don't appear in the Floor and Till order pane.
        </p>
      </div>

      <div className="field" style={{ marginTop: 4 }}>
        <label>Modifier groups</label>
        {modifierGroups.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--text-3)', padding: 10, background: 'var(--bg-2)', borderRadius: 6, lineHeight: 1.5 }}>
            No modifier groups exist yet. Create some under <b>Manager → Modifiers</b> first — for example a "Protein" group with Chicken / Goat / Prawn — then attach them here.
          </p>
        ) : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {modifierGroups.map(g => {
                const selected = modifierGroupIds.includes(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => toggleGroup(g.id)}
                    className={`cat-chip ${selected ? 'active' : ''}`}
                    style={{
                      padding: '8px 12px',
                      fontSize: 13,
                      ...(selected ? {
                        borderColor: 'var(--brand)',
                        color: 'var(--brand)'
                      } : {})
                    }}
                  >
                    {selected ? '✓ ' : '+ '}{g.name}
                    <span style={{ fontSize: 10, marginLeft: 6, opacity: 0.7 }}>
                      {g.type === 'multi' ? 'multi' : 'single'}{g.required ? ' · req' : ''}
                    </span>
                  </button>
                );
              })}
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>
              Tap a group to attach it to this item. When ordering, the customer will be prompted to make selections.
            </p>
          </>
        )}
      </div>

      {err && <div style={{ color: 'var(--red)', fontSize: 13 }}>{err}</div>}
    </Modal>
  );
}

function CategoryEditModal({ cat, onClose, onSave }) {
  const isNew = cat.__new;
  const [name, setName] = useState(cat.name || '');
  const [color, setColor] = useState(cat.color || SWATCHES[0]);
  const [order, setOrder] = useState(cat.order || 1);

  const save = async () => {
    if (!name.trim()) return alert('Name is required');
    await onSave({ name: name.trim(), color, order: +order, active: true });
  };

  return (
    <Modal
      title={isNew ? 'New category' : `Edit ${cat.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save</button>
        </>
      }
    >
      <div className="field">
        <label>Name</label>
        <input value={name} onChange={e => setName(e.target.value)} autoFocus />
      </div>
      <div className="field">
        <label>Display order</label>
        <input
          value={order}
          onChange={e => setOrder(e.target.value.replace(/\D/g, ''))}
          inputMode="numeric"
          style={{ fontFamily: 'var(--font-mono)' }}
        />
      </div>
      <div className="field">
        <label>Colour</label>
        <div className="color-swatches">
          {SWATCHES.map(c => (
            <button
              key={c}
              className={`color-swatch ${color === c ? 'selected' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      </div>
    </Modal>
  );
}
