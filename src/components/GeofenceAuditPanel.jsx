import { useEffect, useState, useMemo } from 'react';
import { watchGeofenceAudit, readGeofenceOverride, clearGeofenceOverride } from '../lib/data';

/**
 * GeofenceAuditPanel — Config Mode → 🔓 Geofence Overrides
 *
 * Shows all geofence overrides granted in the past N days.
 * Append-only audit log — managers and owners can review who, when, why,
 * and where overrides were granted.
 */
export default function GeofenceAuditPanel() {
  const [audit, setAudit] = useState([]);
  const [filter, setFilter] = useState('');
  const [days, setDays] = useState(30);
  const [activeOverride, setActiveOverride] = useState(() => readGeofenceOverride());

  useEffect(() => watchGeofenceAudit(setAudit, days), [days]);

  // Live tick for the "active override" timer
  useEffect(() => {
    if (!activeOverride) return;
    const id = setInterval(() => {
      if (Date.now() > activeOverride.expiresAt) {
        setActiveOverride(null);
      } else {
        setActiveOverride(o => ({ ...o }));  // force re-render
      }
    }, 1000);
    return () => clearInterval(id);
  }, [activeOverride]);

  const filtered = useMemo(() => {
    if (!filter.trim()) return audit;
    const q = filter.toLowerCase();
    return audit.filter(o =>
      (o.userName || '').toLowerCase().includes(q) ||
      (o.reason   || '').toLowerCase().includes(q) ||
      (o.deviceName || '').toLowerCase().includes(q)
    );
  }, [audit, filter]);

  const totalGrants = audit.length;
  const totalHours  = audit.reduce((s, o) => s + (o.durationMs || 0), 0) / 3_600_000;

  return (
    <>
      <h3>🔓 Geofence Override Audit</h3>
      <p className="subtitle">
        Every geofence override is logged here permanently for accountability.
        Records cannot be deleted or modified.
      </p>

      {/* ── Active override (if any on this device/tab) ────────────────── */}
      {activeOverride && (
        <div style={{
          background: 'var(--amber-deep)',
          border: '1.5px solid rgba(251,191,36,0.35)',
          borderRadius: 'var(--radius-lg)',
          padding: '16px 20px',
          marginBottom: 20,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 14,
        }}>
          <div style={{ fontSize: 28 }}>🔓</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, color: 'var(--amber)', fontSize: 15 }}>
              Active override on this device
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4, lineHeight: 1.6 }}>
              Granted to <b style={{ color: 'var(--text)' }}>{activeOverride.userName}</b><br/>
              <b style={{ color: 'var(--text)' }}>Reason:</b> {activeOverride.reason}<br/>
              <b style={{ color: 'var(--text)' }}>Time remaining:</b> {formatRemaining(activeOverride.expiresAt)}
            </div>
          </div>
          <button
            className="btn btn-danger btn-sm"
            onClick={() => {
              if (confirm('Cancel the active override?')) {
                clearGeofenceOverride();
                setActiveOverride(null);
              }
            }}
          >Cancel override</button>
        </div>
      )}

      {/* ── Stats ── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 10, marginBottom: 20
      }}>
        <Stat label={`Overrides — last ${days}d`} value={totalGrants} />
        <Stat label="Total time bypassed" value={`${totalHours.toFixed(1)}h`} />
        <Stat label="Unique managers" value={new Set(audit.map(o => o.userId)).size} />
      </div>

      {/* ── Filters ── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          placeholder="Search by name, reason, device…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{ flex: 1, minWidth: 200, maxWidth: 360 }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          {[7, 30, 90, 365].map(d => (
            <button
              key={d}
              className={`cat-chip ${days === d ? 'active' : ''}`}
              onClick={() => setDays(d)}
            >
              {d === 7 ? '7d' : d === 30 ? '30d' : d === 90 ? '90d' : '1y'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Log table ── */}
      {filtered.length === 0 ? (
        <div style={{
          padding: 40, textAlign: 'center', color: 'var(--text-3)',
          background: 'var(--surface-2)', borderRadius: 'var(--radius)',
        }}>
          {audit.length === 0
            ? `No overrides recorded in the last ${days} days.`
            : 'No overrides match your search.'}
        </div>
      ) : (
        <div className="data-table">
          <div className="row head" style={{ gridTemplateColumns: '120px 160px 1fr 110px 130px 130px' }}>
            <div>When</div>
            <div>Manager</div>
            <div>Reason</div>
            <div>Duration</div>
            <div>Device</div>
            <div>Location</div>
          </div>
          {filtered.map(o => (
            <div key={o.id} className="row" style={{
              gridTemplateColumns: '120px 160px 1fr 110px 130px 130px',
              alignItems: 'flex-start',
              fontSize: 13,
            }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>
                {formatTimestamp(o.grantedAtMs)}
              </div>
              <div>
                <div style={{ fontWeight: 600 }}>{o.userName}</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                  {o.userId?.slice(0, 8)}
                </div>
              </div>
              <div style={{ color: 'var(--text-2)' }}>{o.reason}</div>
              <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--brand)' }}>
                {formatDuration(o.durationMs)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                {o.deviceName || '—'}
                {o.mode && <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{o.mode}</div>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
                {o.distanceMeters != null && (
                  <div>~{Math.round(o.distanceMeters)}m off-site</div>
                )}
                {o.locationAtGrant?.lat && (
                  <a
                    href={`https://maps.google.com/?q=${o.locationAtGrant.lat},${o.locationAtGrant.lng}`}
                    target="_blank" rel="noreferrer"
                    style={{ color: 'var(--brand)', textDecoration: 'underline' }}
                  >
                    View on map →
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{
      background: 'var(--surface-2)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', padding: '12px 14px'
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--brand)' }}>{value}</div>
    </div>
  );
}

function formatTimestamp(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toLocaleString('en-AU', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function formatDuration(ms) {
  const m = Math.floor((ms || 0) / 60_000);
  if (m < 60) return `${m}m`;
  const h = m / 60;
  return h === Math.floor(h) ? `${h}h` : `${h.toFixed(1)}h`;
}

function formatRemaining(expiresAt) {
  const ms = Math.max(0, expiresAt - Date.now());
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  if (m >= 60) return `${Math.floor(m/60)}h ${m%60}m`;
  if (m >= 1)  return `${m}m ${String(s).padStart(2,'0')}s`;
  return `${s}s`;
}
