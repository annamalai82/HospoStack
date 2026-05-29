import { useEffect, useState, useMemo, useRef } from 'react';
import {
  watchLostFound, logLostItem, claimLostItem, discardLostItem,
  deleteLostItem, reopenLostItem
} from '../lib/data';
import { useDevice } from '../context/DeviceContext';
import Modal from './Modal';

/**
 * LostFoundPanel — Config → 🎒 Lost & Found
 *
 * Quick log for items left behind by customers. Each entry has:
 *   - A short description (e.g. "Black leather jacket, size M")
 *   - Where it was found (table 3, bathroom, etc)
 *   - An optional photo (camera or upload), compressed to ~600px → base64
 *   - Who logged it
 *   - Status: unclaimed | claimed | discarded
 *
 * Photos are stored as base64 data URLs in the Firestore doc itself.
 * After compression to ~600px JPEG ~70% quality, even a phone photo is
 * comfortably under 100KB so well below Firestore's 1MB doc limit.
 */
export default function LostFoundPanel() {
  const { device } = useDevice();
  const [items, setItems]       = useState([]);
  const [filter, setFilter]     = useState('unclaimed'); // unclaimed | claimed | all
  const [search, setSearch]     = useState('');
  const [showLog, setShowLog]   = useState(false);
  const [claiming, setClaiming] = useState(null); // item being claimed
  const [viewing, setViewing]   = useState(null); // item open for detail/photo view

  useEffect(() => watchLostFound(setItems), []);

  const filtered = useMemo(() => {
    let list = items;
    if (filter !== 'all') list = list.filter(i => i.status === filter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(i =>
      (i.description || '').toLowerCase().includes(q) ||
      (i.location    || '').toLowerCase().includes(q) ||
      (i.claimedBy   || '').toLowerCase().includes(q)
    );
    return list;
  }, [items, filter, search]);

  const counts = useMemo(() => ({
    unclaimed: items.filter(i => i.status === 'unclaimed').length,
    claimed:   items.filter(i => i.status === 'claimed').length,
    discarded: items.filter(i => i.status === 'discarded').length,
  }), [items]);

  // Items older than 30 days that are still unclaimed — staff prompt
  const stale = items.filter(i =>
    i.status === 'unclaimed' && (Date.now() - (i.foundAtMs || 0)) > 30 * 86400_000
  );

  return (
    <>
      <h3>🎒 Lost &amp; Found</h3>
      <p className="subtitle">
        Quick log for items customers leave behind. Photo + description + where found.
        Mark as claimed when the customer collects it.
      </p>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={() => setShowLog(true)}>
          + Log a found item
        </button>
        <input
          placeholder="Search description, location, claimer…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 200, maxWidth: 360 }}
        />
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            className={`cat-chip ${filter === 'unclaimed' ? 'active' : ''}`}
            onClick={() => setFilter('unclaimed')}
          >Unclaimed ({counts.unclaimed})</button>
          <button
            className={`cat-chip ${filter === 'claimed' ? 'active' : ''}`}
            onClick={() => setFilter('claimed')}
          >Claimed ({counts.claimed})</button>
          <button
            className={`cat-chip ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >All</button>
        </div>
      </div>

      {stale.length > 0 && filter === 'unclaimed' && (
        <div style={{
          padding: '12px 14px', borderRadius: 'var(--radius)',
          background: 'var(--amber-deep)', border: '1px solid rgba(251,191,36,0.3)',
          color: 'var(--amber)', fontSize: 13, marginBottom: 14, lineHeight: 1.6
        }}>
          <b>🗓 {stale.length} item{stale.length === 1 ? '' : 's'} older than 30 days.</b>
          {' '}Consider discarding/donating items that have been unclaimed for over a month.
        </div>
      )}

      {filtered.length === 0 ? (
        <div style={{
          padding: 40, textAlign: 'center', color: 'var(--text-3)',
          background: 'var(--surface-2)', borderRadius: 'var(--radius)', border: '1px dashed var(--border)'
        }}>
          {items.length === 0
            ? 'No items logged yet. Click "Log a found item" to get started.'
            : 'No items match your filter.'}
        </div>
      ) : (
        <div className="lf-grid">
          {filtered.map(item => (
            <LostItemCard
              key={item.id}
              item={item}
              onView={() => setViewing(item)}
              onClaim={() => setClaiming(item)}
              onReopen={() => reopenLostItem(item.id)}
            />
          ))}
        </div>
      )}

      {showLog && (
        <LogLostItemModal
          foundBy={device.user?.name || ''}
          onSave={async (data) => {
            await logLostItem({ ...data, foundBy: device.user?.name || '' });
            setShowLog(false);
          }}
          onClose={() => setShowLog(false)}
        />
      )}

      {claiming && (
        <ClaimItemModal
          item={claiming}
          onClaim={async (claimedBy) => {
            await claimLostItem(claiming.id, claimedBy);
            setClaiming(null);
          }}
          onClose={() => setClaiming(null)}
        />
      )}

      {viewing && (
        <LostItemDetailModal
          item={viewing}
          byName={device.user?.name || ''}
          onClose={() => setViewing(null)}
          onDiscard={async () => {
            if (confirm('Mark this item as discarded/donated? It will be hidden from the unclaimed list.')) {
              await discardLostItem(viewing.id, device.user?.name);
              setViewing(null);
            }
          }}
          onDelete={async () => {
            if (confirm('Permanently delete this entry? This cannot be undone.')) {
              await deleteLostItem(viewing.id);
              setViewing(null);
            }
          }}
          onClaim={() => { setClaiming(viewing); setViewing(null); }}
        />
      )}
    </>
  );
}

/* ── Card showing a single lost item ─────────────────────────────────────── */
function LostItemCard({ item, onView, onClaim, onReopen }) {
  const isClaimed   = item.status === 'claimed';
  const isDiscarded = item.status === 'discarded';
  const days        = Math.floor((Date.now() - (item.foundAtMs || 0)) / 86400_000);

  return (
    <button
      className={`lf-card lf-card--${item.status}`}
      onClick={onView}
    >
      <div className="lf-card-photo">
        {item.photoDataUrl
          ? <img src={item.photoDataUrl} alt={item.description} />
          : <div className="lf-card-photo-empty">📦</div>}
        {isClaimed   && <div className="lf-card-status lf-card-status--claimed">✓ Claimed</div>}
        {isDiscarded && <div className="lf-card-status lf-card-status--discarded">Discarded</div>}
      </div>
      <div className="lf-card-body">
        <div className="lf-card-desc">{item.description}</div>
        {item.location && <div className="lf-card-meta">📍 {item.location}</div>}
        <div className="lf-card-meta">
          {formatRelativeDays(days)}
          {item.foundBy && <> · by {item.foundBy}</>}
        </div>
        {isClaimed && item.claimedBy && (
          <div className="lf-card-claimed-by">→ {item.claimedBy}</div>
        )}
      </div>
      {(isClaimed || isDiscarded) ? (
        <div className="lf-card-action lf-card-action--ghost" onClick={(e) => { e.stopPropagation(); onReopen(); }}>
          ↶ Reopen
        </div>
      ) : (
        <div className="lf-card-action" onClick={(e) => { e.stopPropagation(); onClaim(); }}>
          Mark claimed →
        </div>
      )}
    </button>
  );
}

/* ── Log a new lost item ─────────────────────────────────────────────────── */
function LogLostItemModal({ foundBy, onSave, onClose }) {
  const [description, setDescription] = useState('');
  const [location, setLocation]       = useState('');
  const [notes, setNotes]             = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState(null);
  const [photoProcessing, setPhotoProcessing] = useState(false);
  const [err, setErr]                 = useState('');
  const [saving, setSaving]           = useState(false);
  const fileRef = useRef(null);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoProcessing(true);
    try {
      const compressed = await compressImage(file, 600, 0.72);
      setPhotoDataUrl(compressed);
    } catch (ex) {
      setErr('Could not load that image: ' + ex.message);
    } finally {
      setPhotoProcessing(false);
    }
  };

  const handleSave = async () => {
    if (!description.trim()) { setErr('Description is required'); return; }
    setErr('');
    setSaving(true);
    try {
      await onSave({ description, location, notes, photoDataUrl });
    } catch (ex) {
      setErr('Save failed: ' + ex.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title="🎒 Log a found item"
      onClose={onClose}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving || photoProcessing}>
          {saving ? 'Saving…' : '✓ Log item'}
        </button>
      </>}
    >
      <div className="field">
        <label>Description <span style={{ color: 'var(--red)' }}>*</span></label>
        <input
          value={description}
          onChange={e => { setDescription(e.target.value); setErr(''); }}
          placeholder="e.g. Black leather jacket size M, iPhone 14 Pro silver, blue umbrella"
          autoFocus
        />
      </div>

      <div className="field">
        <label>Where found</label>
        <input
          value={location}
          onChange={e => setLocation(e.target.value)}
          placeholder="e.g. Table 3, bathroom, near entrance"
        />
      </div>

      <div className="field">
        <label>Photo</label>
        <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '0 0 8px' }}>
          Camera or gallery. Compressed to ~600px before saving.
        </p>
        {photoDataUrl ? (
          <div className="lf-photo-preview">
            <img src={photoDataUrl} alt="preview" />
            <button
              className="btn-ghost"
              onClick={() => { setPhotoDataUrl(null); if (fileRef.current) fileRef.current.value = ''; }}
              style={{ marginTop: 8 }}
            >
              × Remove photo
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn"
              onClick={() => fileRef.current?.click()}
              disabled={photoProcessing}
              style={{ flex: 1 }}
            >
              {photoProcessing ? '⏳ Processing…' : '📷 Take / choose photo'}
            </button>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
      </div>

      <div className="field">
        <label>Notes (optional)</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Anything else — distinguishing marks, where it'll be stored, etc."
          rows={2}
        />
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-3)', paddingTop: 4 }}>
        Logged by <b>{foundBy || 'unknown'}</b>
      </div>

      {err && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 10 }}>{err}</div>}
    </Modal>
  );
}

/* ── Claim modal — collect claimant name ─────────────────────────────────── */
function ClaimItemModal({ item, onClaim, onClose }) {
  const [name, setName] = useState('');

  return (
    <Modal
      title="✓ Mark item as claimed"
      onClose={onClose}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onClaim(name)}>
          ✓ Mark claimed
        </button>
      </>}
    >
      <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 12 }}>
        Marking <b>{item.description}</b> as collected by its owner.
      </p>
      <div className="field">
        <label>Claimed by (optional)</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Customer name or description"
          autoFocus
        />
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
          Helps later if the same customer asks again.
        </div>
      </div>
    </Modal>
  );
}

/* ── Detail / photo view modal ───────────────────────────────────────────── */
function LostItemDetailModal({ item, byName, onClose, onDiscard, onDelete, onClaim }) {
  const isOpen = item.status === 'unclaimed';

  return (
    <Modal
      title={item.description}
      onClose={onClose}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Close</button>
        {isOpen ? (
          <>
            <button className="btn" onClick={onDiscard}>Discard / donate</button>
            <button className="btn btn-primary" onClick={onClaim}>✓ Mark claimed</button>
          </>
        ) : (
          <button className="btn btn-danger" onClick={onDelete}>🗑 Delete entry</button>
        )}
      </>}
    >
      {item.photoDataUrl && (
        <div className="lf-detail-photo">
          <img src={item.photoDataUrl} alt={item.description} />
        </div>
      )}
      <dl className="lf-detail-list">
        {item.location && <><dt>Found at</dt><dd>{item.location}</dd></>}
        <dt>Logged</dt>
        <dd>
          {formatFullDate(item.foundAtMs)}
          {item.foundBy && <> by {item.foundBy}</>}
        </dd>
        {item.status === 'claimed' && (
          <>
            <dt>Claimed</dt>
            <dd>
              {formatFullDate(item.claimedAtMs)}
              {item.claimedBy && <> by {item.claimedBy}</>}
            </dd>
          </>
        )}
        {item.status === 'discarded' && (
          <>
            <dt>Discarded</dt>
            <dd>
              {formatFullDate(item.discardedAtMs)}
              {item.discardedBy && <> by {item.discardedBy}</>}
            </dd>
          </>
        )}
        {item.notes && <><dt>Notes</dt><dd>{item.notes}</dd></>}
      </dl>
    </Modal>
  );
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/** Compress an image file to a target max width and quality, returning a
 *  data URL. Uses an offscreen canvas — works in all modern browsers. */
function compressImage(file, maxWidth = 600, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not decode image'));
      img.onload = () => {
        const ratio = Math.min(1, maxWidth / img.width);
        const w = Math.round(img.width * ratio);
        const h = Math.round(img.height * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function formatRelativeDays(days) {
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7)  return `${days} days ago`;
  if (days < 30) return `${Math.floor(days/7)}w ago`;
  return `${Math.floor(days/30)}mo ago`;
}

function formatFullDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}
