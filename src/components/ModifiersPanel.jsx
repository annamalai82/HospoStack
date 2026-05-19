import { useEffect, useState } from 'react';
import {
  watchModifierGroups, createModifierGroup, updateModifierGroup, deleteModifierGroup,
  watchAllMenuItems
} from '../lib/data';
import Modal from './Modal';

export default function ModifiersPanel() {
  const [groups, setGroups] = useState([]);
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);

  useEffect(() => watchModifierGroups(setGroups), []);
  useEffect(() => watchAllMenuItems(setItems), []);

  // For each group, how many menu items reference it
  const usageCount = (groupId) =>
    items.filter(i => (i.modifierGroupIds || []).includes(groupId)).length;

  return (
    <>
      <h3>Modifier groups</h3>
      <p className="subtitle">
        Reusable option sets — protein choices, spice levels, extras, sides. Attach them to any menu item under <b>Menu → Items</b>.
      </p>

      <div className="section">
        <div className="section-head">
          <h4>{groups.length} group{groups.length === 1 ? '' : 's'}</h4>
          <button
            className="btn btn-primary"
            onClick={() => setEditing({
              __new: true,
              name: '',
              type: 'single',
              required: true,
              options: [{ id: randId(), label: '', priceDelta: 0 }]
            })}
          >+ New Group</button>
        </div>

        {groups.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-3)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
            <p>No modifier groups yet.</p>
            <p style={{ fontSize: 12, marginTop: 8 }}>
              Try one: "Protein" with options Chicken (+$0), Goat (+$2), Prawn (+$5).
            </p>
          </div>
        ) : (
          <div className="data-table">
            <div className="row head" style={{ gridTemplateColumns: '1.8fr 1fr 0.7fr 1.4fr 0.7fr 90px' }}>
              <div>Name</div>
              <div>Type</div>
              <div>Required</div>
              <div>Options</div>
              <div>Used by</div>
              <div></div>
            </div>
            {groups.map(g => {
              const usage = usageCount(g.id);
              return (
                <div key={g.id} className="row" style={{ gridTemplateColumns: '1.8fr 1fr 0.7fr 1.4fr 0.7fr 90px' }}>
                  <div>{g.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)', textTransform: 'capitalize' }}>
                    {g.type === 'multi' ? `Multi (${g.minSelect || 0}–${g.maxSelect || 'any'})` : 'Single'}
                  </div>
                  <div>
                    <span className={`pill ${g.required ? 'manager' : 'inactive'}`} style={{
                      ...(g.required ? {} : { background: 'var(--surface-3)', color: 'var(--text-3)' })
                    }}>
                      {g.required ? 'required' : 'optional'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {(g.options || []).slice(0, 4).map(o => (
                      <span key={o.id} style={{
                        background: 'var(--surface-2)', padding: '2px 8px', borderRadius: 999,
                        fontFamily: 'var(--font-mono)', fontSize: 11
                      }}>
                        {o.label}{o.priceDelta ? ` +$${o.priceDelta.toFixed(2)}` : ''}
                      </span>
                    ))}
                    {(g.options || []).length > 4 && (
                      <span style={{ color: 'var(--text-3)', fontSize: 11 }}>
                        +{g.options.length - 4} more
                      </span>
                    )}
                  </div>
                  <div>
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      background: usage > 0 ? 'var(--surface-3)' : 'transparent',
                      color: usage > 0 ? 'var(--text-2)' : 'var(--text-3)',
                      padding: '2px 8px', borderRadius: 999, fontSize: 12
                    }}>
                      {usage} item{usage === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                    <button className="icon-btn" onClick={() => setEditing(g)}>✎</button>
                    <button className="icon-btn danger" onClick={() => {
                      if (usage > 0) {
                        alert(`This group is used by ${usage} menu item${usage === 1 ? '' : 's'}. Detach it from those items first.`);
                        return;
                      }
                      if (confirm(`Delete "${g.name}"?`)) deleteModifierGroup(g.id);
                    }}>×</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {editing && (
        <ModifierGroupEditModal
          group={editing}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            if (editing.__new) await createModifierGroup(data);
            else                await updateModifierGroup(editing.id, data);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function ModifierGroupEditModal({ group, onClose, onSave }) {
  const isNew = group.__new;
  const [name, setName] = useState(group.name || '');
  const [type, setType] = useState(group.type || 'single');
  const [required, setRequired] = useState(group.required ?? true);
  const [minSelect, setMinSelect] = useState(group.minSelect ?? 0);
  const [maxSelect, setMaxSelect] = useState(group.maxSelect ?? '');
  const [options, setOptions] = useState(
    group.options?.length ? group.options : [{ id: randId(), label: '', priceDelta: 0 }]
  );
  const [err, setErr] = useState('');

  const addOption = () => {
    setOptions([...options, { id: randId(), label: '', priceDelta: 0 }]);
  };
  const updateOption = (i, patch) => {
    setOptions(options.map((o, j) => j === i ? { ...o, ...patch } : o));
  };
  const removeOption = (i) => {
    setOptions(options.filter((_, j) => j !== i));
  };

  const save = async () => {
    setErr('');
    if (!name.trim()) return setErr('Name is required');
    const cleaned = options
      .map(o => ({ ...o, label: (o.label || '').trim(), priceDelta: +(o.priceDelta || 0) }))
      .filter(o => o.label);
    if (cleaned.length < 1) return setErr('Add at least one option');
    if (type === 'single' && cleaned.length < 2) return setErr('Single-select needs at least 2 options');

    const payload = {
      name: name.trim(),
      type,
      required,
      options: cleaned
    };
    if (type === 'multi') {
      payload.minSelect = Math.max(0, parseInt(minSelect) || 0);
      payload.maxSelect = maxSelect === '' ? null : Math.max(payload.minSelect, parseInt(maxSelect) || 0);
    }
    await onSave(payload);
  };

  return (
    <Modal
      title={isNew ? 'New modifier group' : `Edit "${group.name}"`}
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save</button>
        </>
      }
    >
      <div className="field">
        <label>Group name</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Protein, Spice level, Extras"
          autoFocus
        />
      </div>

      <div className="field-row">
        <div className="field">
          <label>Selection</label>
          <select value={type} onChange={e => setType(e.target.value)}>
            <option value="single">Single — pick one</option>
            <option value="multi">Multi — pick any</option>
          </select>
        </div>
        <div className="field">
          <label>Required?</label>
          <div style={{ display: 'flex', alignItems: 'center', height: 38 }}>
            <label className="switch">
              <input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)} />
              <span className="slider" />
            </label>
            <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--text-2)' }}>
              {required ? 'Must select' : 'Skippable'}
            </span>
          </div>
        </div>
      </div>

      {type === 'multi' && (
        <div className="field-row">
          <div className="field">
            <label>Min selections</label>
            <input
              value={minSelect}
              onChange={e => setMinSelect(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </div>
          <div className="field">
            <label>Max selections (blank = any)</label>
            <input
              value={maxSelect}
              onChange={e => setMaxSelect(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </div>
        </div>
      )}

      <div className="field" style={{ marginTop: 8 }}>
        <label>Options</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {options.map((o, i) => (
            <div key={o.id} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 32px', gap: 6 }}>
              <input
                value={o.label}
                onChange={e => updateOption(i, { label: e.target.value })}
                placeholder="Label (e.g. Chicken)"
              />
              <div style={{ position: 'relative' }}>
                <span style={{
                  position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
                  color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontSize: 12
                }}>+$</span>
                <input
                  value={o.priceDelta}
                  onChange={e => updateOption(i, { priceDelta: e.target.value })}
                  inputMode="decimal"
                  placeholder="0.00"
                  style={{ paddingLeft: 26, fontFamily: 'var(--font-mono)' }}
                />
              </div>
              <button
                className="icon-btn danger"
                onClick={() => removeOption(i)}
                disabled={options.length <= 1}
                style={{ opacity: options.length <= 1 ? 0.4 : 1 }}
              >×</button>
            </div>
          ))}
        </div>
        <button
          className="btn-ghost"
          onClick={addOption}
          style={{ marginTop: 8, padding: '8px 12px', border: '1px dashed var(--border)', borderRadius: 6 }}
        >
          + Add option
        </button>
      </div>

      {err && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{err}</div>}
    </Modal>
  );
}

function randId() {
  return Math.random().toString(36).slice(2, 10);
}
