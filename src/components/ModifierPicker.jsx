import { useEffect, useState, useMemo } from 'react';
import { watchModifierGroups } from '../lib/data';

/**
 * Customer-facing modifier picker.
 *
 * Renders a bottom-sheet style modal letting the user choose options for an
 * item that has modifierGroupIds attached. Computes price live as they pick.
 * Notes field at the bottom for ad-hoc requests ("no onion").
 *
 * Props:
 *   item      – menu item with modifierGroupIds
 *   onCancel
 *   onConfirm(line) – line shape:
 *     { itemId, name, qty, price, station, course,
 *       selections: [{ groupId, groupName, optionIds, label }],
 *       notes, modifiersPriceDelta }
 */
export default function ModifierPicker({ item, onCancel, onConfirm }) {
  const [groups, setGroups] = useState([]);
  const [selections, setSelections] = useState({}); // groupId -> [optionId]
  const [notes, setNotes] = useState('');
  const [qty, setQty] = useState(1);

  useEffect(() => {
    return watchModifierGroups((all) => {
      const itemGroupIds = item.modifierGroupIds || [];
      const filtered = all.filter(g => itemGroupIds.includes(g.id));
      setGroups(filtered);
    });
  }, [item]);

  // Validate
  const validation = useMemo(() => {
    const errs = [];
    groups.forEach(g => {
      const picked = selections[g.id] || [];
      if (g.required && picked.length === 0) {
        errs.push(`Pick ${g.type === 'single' ? 'one' : 'at least one'} ${g.name.toLowerCase()}`);
      }
      if (g.type === 'multi') {
        if (g.minSelect && picked.length < g.minSelect) {
          errs.push(`${g.name}: pick at least ${g.minSelect}`);
        }
        if (g.maxSelect && picked.length > g.maxSelect) {
          errs.push(`${g.name}: pick at most ${g.maxSelect}`);
        }
      }
    });
    return errs;
  }, [groups, selections]);

  // Live price delta
  const priceDelta = useMemo(() => {
    let d = 0;
    groups.forEach(g => {
      const picked = selections[g.id] || [];
      picked.forEach(optId => {
        const opt = g.options?.find(o => o.id === optId);
        if (opt) d += (+opt.priceDelta || 0);
      });
    });
    return d;
  }, [groups, selections]);

  const unitPrice = item.price + priceDelta;
  const total = unitPrice * qty;

  const togglePick = (group, optionId) => {
    setSelections(prev => {
      const picked = prev[group.id] || [];
      if (group.type === 'single') {
        return { ...prev, [group.id]: picked[0] === optionId ? [] : [optionId] };
      }
      // multi
      if (picked.includes(optionId)) {
        return { ...prev, [group.id]: picked.filter(id => id !== optionId) };
      }
      if (group.maxSelect && picked.length >= group.maxSelect) {
        // Replace oldest, or just don't add — let's be polite and replace oldest
        return { ...prev, [group.id]: [...picked.slice(1), optionId] };
      }
      return { ...prev, [group.id]: [...picked, optionId] };
    });
  };

  const handleConfirm = () => {
    if (validation.length > 0) return;
    const sel = groups.map(g => {
      const picked = selections[g.id] || [];
      const opts = picked.map(id => g.options.find(o => o.id === id)).filter(Boolean);
      return {
        groupId: g.id,
        groupName: g.name,
        optionIds: picked,
        label: opts.map(o => o.label).join(', ')
      };
    }).filter(s => s.optionIds.length > 0);

    onConfirm({
      itemId: item.id,
      name: item.name,
      qty,
      price: unitPrice,           // unit price including modifiers
      basePrice: item.price ?? 0,
      station: item.station ?? 'kitchen',
      course: item.course ?? 'main',
      selections: sel,
      notes: notes.trim(),
      modifiersPriceDelta: priceDelta,
      status: 'pending'
    });
  };

  return (
    <div className="modifier-sheet-overlay" onClick={onCancel}>
      <div className="modifier-sheet" onClick={e => e.stopPropagation()}>

        <div className="modifier-head">
          <div>
            <div className="eyebrow">Customize</div>
            <h2>{item.name}</h2>
            <div className="base-price">Base ${item.price.toFixed(2)}</div>
          </div>
          <button className="icon-btn" onClick={onCancel} style={{ width: 36, height: 36, fontSize: 18 }}>×</button>
        </div>

        <div className="modifier-body">
          {groups.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-3)' }}>
              Loading options…
            </div>
          ) : (
            groups.map(g => (
              <ModifierGroup
                key={g.id}
                group={g}
                picked={selections[g.id] || []}
                onPick={(optionId) => togglePick(g, optionId)}
              />
            ))
          )}

          <div className="modifier-section">
            <div className="modifier-group-head">
              <h4>Special instructions</h4>
              <span className="modifier-group-rule">Optional</span>
            </div>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. no onion, extra spicy, allergy info"
              maxLength={200}
              rows={2}
            />
          </div>
        </div>

        <div className="modifier-foot">
          <div className="qty-stepper">
            <button onClick={() => setQty(Math.max(1, qty - 1))}>−</button>
            <span>{qty}</span>
            <button onClick={() => setQty(qty + 1)}>+</button>
          </div>
          <button
            className="btn btn-primary btn-lg"
            disabled={validation.length > 0}
            style={{ opacity: validation.length > 0 ? 0.5 : 1, flex: 1 }}
            onClick={handleConfirm}
          >
            {validation.length > 0
              ? validation[0]
              : <>Add {qty} · <span style={{ fontFamily: 'var(--font-mono)' }}>${total.toFixed(2)}</span></>
            }
          </button>
        </div>
      </div>
    </div>
  );
}

function ModifierGroup({ group, picked, onPick }) {
  const isMulti = group.type === 'multi';
  const limitLabel = isMulti
    ? group.maxSelect
      ? group.minSelect === group.maxSelect
        ? `Pick ${group.maxSelect}`
        : `Pick ${group.minSelect || 0}–${group.maxSelect}`
      : group.required ? `Pick at least 1` : 'Pick any'
    : 'Pick one';

  return (
    <div className="modifier-section">
      <div className="modifier-group-head">
        <h4>{group.name}</h4>
        <span className="modifier-group-rule">
          {group.required ? <b>Required</b> : 'Optional'} · {limitLabel}
        </span>
      </div>

      <div className="modifier-options">
        {(group.options || []).map(opt => {
          const isPicked = picked.includes(opt.id);
          return (
            <button
              key={opt.id}
              className={`modifier-option ${isPicked ? 'picked' : ''}`}
              onClick={() => onPick(opt.id)}
            >
              <span className="check">
                {isMulti
                  ? (isPicked ? '☑' : '☐')
                  : (isPicked ? '●' : '○')
                }
              </span>
              <span className="label">{opt.label}</span>
              {opt.priceDelta > 0 && (
                <span className="delta">+${opt.priceDelta.toFixed(2)}</span>
              )}
              {opt.priceDelta < 0 && (
                <span className="delta neg">−${Math.abs(opt.priceDelta).toFixed(2)}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
