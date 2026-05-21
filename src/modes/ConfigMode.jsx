import { useState, useEffect } from 'react';
import { useDevice } from '../context/DeviceContext';
import { watchVenues, watchMenuItems, deleteEntireMenu } from '../lib/data';
import MenuImporter from '../components/MenuImporter';
import VenueSetupPanel from '../components/VenueSetupPanel';
import GroupAdminPanel from '../components/GroupAdminPanel';
import EftposReconPanel from '../components/EftposReconPanel';
import MenuPanel from '../components/MenuPanel';
import CategoriesPanel from '../components/CategoriesPanel';
import ModifiersPanel from '../components/ModifiersPanel';
import TablesPanel from '../components/TablesPanel';
import UsersPanel from '../components/UsersPanel';

const SECTIONS = [
  { id: 'overview',   label: 'Overview',          icon: '🏠' },
  { id: 'group',      label: 'Group Admin',       icon: '🌐' },
  { id: 'eftpos',     label: 'EFTPOS Reconcile',  icon: '💳' },
  { id: 'importer',   label: 'Menu Importer',     icon: '✨' },
  { id: 'menu',       label: 'Menu Items',        icon: '🍴' },
  { id: 'categories', label: 'Categories',        icon: '📂' },
  { id: 'modifiers',  label: 'Modifier Groups',   icon: '⚙' },
  { id: 'tables',     label: 'Tables',            icon: '🪑' },
  { id: 'users',      label: 'Users & PINs',      icon: '👥' },
  { id: 'venue',      label: 'Venue Settings',    icon: '🏛' }
];

export default function ConfigMode() {
  const { device } = useDevice();
  const [section, setSection] = useState('overview');
  const [toast, setToast] = useState(null);
  const [venues, setVenues] = useState([]);

  useEffect(() => watchVenues(setVenues), []);

  // Only managers can use Config mode
  if (device?.user?.role !== 'manager') {
    return (
      <div className="config-mode-locked">
        <div className="empty">
          <h3>🔒 Manager access required</h3>
          <p>Config Mode is restricted to managers. Please lock this device and sign in with a manager PIN to continue.</p>
        </div>
      </div>
    );
  }

  const showToast = (msg, kind = 'info') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2400);
  };

  return (
    <div className="config-mode">
      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}

      {/* ── Sidebar ── */}
      <aside className="config-sidebar">
        <div className="config-sidebar-head">
          <div className="venue-label">{device.venueName || 'Current venue'}</div>
          <div className="venue-id">{device.venueId}</div>
        </div>
        <nav className="config-nav">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              className={`config-nav-item ${section === s.id ? 'active' : ''}`}
              onClick={() => setSection(s.id)}
            >
              <span className="icon">{s.icon}</span>
              <span className="label">{s.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* ── Body ── */}
      <main className="config-body">
        {section === 'overview'   && <OverviewSection device={device} venues={venues} onJumpTo={setSection} />}
        {section === 'group'      && <GroupAdminPanel onToast={showToast} />}
        {section === 'eftpos'     && <EftposReconPanel />}
        {section === 'importer'   && <MenuImporter onDone={() => showToast('Menu imported', 'info')} />}
        {section === 'menu'       && <MenuPanel onToast={showToast} />}
        {section === 'categories' && <CategoriesPanel onToast={showToast} />}
        {section === 'modifiers'  && <ModifiersPanel onToast={showToast} />}
        {section === 'tables'     && <TablesPanel onToast={showToast} />}
        {section === 'users'      && <UsersPanel onToast={showToast} />}
        {section === 'venue'      && <VenueSetupPanel onToast={showToast} />}
      </main>
    </div>
  );
}

function OverviewSection({ device, venues, onJumpTo }) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteToast, setDeleteToast] = useState(null);
  const [menuItems, setMenuItems] = useState(null); // null = loading

  // Watch menu item count so danger zone hides when menu is empty
  useEffect(() => {
    return watchMenuItems(setMenuItems);
  }, []);

  const hasMenu = menuItems !== null && menuItems.length > 0;

  const handleDeleteMenu = async () => {
    setDeleting(true);
    try {
      const count = await deleteEntireMenu();
      setShowDeleteConfirm(false);
      setDeleteToast(`Deleted ${count} items and categories.`);
      setTimeout(() => setDeleteToast(null), 3000);
    } catch (e) {
      setDeleteToast('Delete failed: ' + e.message);
    } finally {
      setDeleting(false);
    }
  };
  const TILES = [
    { id: 'importer',   icon: '✨', title: 'Import a menu', blurb: 'Paste text, upload Excel/PDF/Word, or snap a photo of a handwritten menu.', cta: 'Start importing →' },
    { id: 'group',      icon: '🌐', title: 'Group dashboard', blurb: 'See live sales and tables across all venues in one place.', cta: 'Open dashboard →' },
    { id: 'menu',       icon: '🍴', title: 'Edit menu items', blurb: 'Add, edit, deactivate items. Set prices and modifier groups.', cta: 'Manage menu →' },
    { id: 'modifiers',  icon: '⚙',  title: 'Modifier groups', blurb: 'Set up protein choices, spice levels, extras.', cta: 'Manage modifiers →' },
    { id: 'tables',     icon: '🪑', title: 'Tables & zones', blurb: 'Define tables, seats, dining vs patio zones.', cta: 'Set up tables →' },
    { id: 'users',      icon: '👥', title: 'Staff & PINs', blurb: 'Add staff, assign roles, change PINs.', cta: 'Manage staff →' }
  ];

  return (
    <div className="config-overview">
      <div className="config-overview-hero">
        <div>
          <h1>
            Welcome to <span style={{ color: 'var(--brand)' }}>Config Mode</span>
          </h1>
          <p>
            Set up everything that powers your POS. Changes here apply to <b>{device.venueName}</b> only.
            For cross-venue tools, use the Group Admin section.
          </p>
        </div>
        <div className="config-overview-stats">
          <div className="stat-card">
            <div className="label">All venues</div>
            <div className="value">{venues.length}</div>
          </div>
          <div className="stat-card">
            <div className="label">Current venue</div>
            <div className="value" style={{ fontSize: 16, fontFamily: 'var(--font-serif)', fontStyle: 'italic' }}>
              {device.venueName || '—'}
            </div>
          </div>
        </div>
      </div>

      <div className="config-tile-grid">
        {TILES.map(t => (
          <button key={t.id} className="config-tile" onClick={() => onJumpTo(t.id)}>
            <div className="config-tile-icon">{t.icon}</div>
            <div className="config-tile-body">
              <h3>{t.title}</h3>
              <p>{t.blurb}</p>
              <div className="config-tile-cta">{t.cta}</div>
            </div>
          </button>
        ))}
      </div>

      {/* ── Danger Zone — only shown when menu has items ──────────── */}
      {hasMenu && (
        <div className="danger-zone">
          <div className="danger-zone-head">
            <h4>⚠ Danger zone</h4>
            <p>These actions cannot be undone. Proceed with caution.</p>
          </div>
          {deleteToast && (
            <div style={{ padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, marginBottom: 10 }}>
              {deleteToast}
            </div>
          )}
          <button
            className="btn btn-danger"
            onClick={() => setShowDeleteConfirm(true)}
            disabled={deleting}
          >
            🗑 Delete entire menu for {device.venueName}
          </button>
        </div>
      )}

      {/* Toast shown after delete even when danger zone is hidden */}
      {!hasMenu && deleteToast && (
        <div style={{ marginTop: 24, padding: '12px 14px', background: 'var(--green-deep)', border: '1px solid rgba(74,222,128,0.3)', borderRadius: 8, fontSize: 13, color: 'var(--green)' }}>
          ✓ {deleteToast}
        </div>
      )}

      {/* Delete confirm modal */}
      {showDeleteConfirm && (
        <div className="modal-overlay" onClick={() => !deleting && setShowDeleteConfirm(false)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-head" style={{ background: 'var(--red-deep)', borderColor: 'rgba(248,113,113,0.3)' }}>
              <h3 style={{ color: 'var(--red)' }}>🗑 Delete entire menu</h3>
              <button className="icon-btn" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 15, fontWeight: 500, marginBottom: 14 }}>
                This will permanently delete <b>all menu items and all categories</b> for <b style={{ color: 'var(--brand)' }}>{device.venueName}</b>.
              </p>
              <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: 12, fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6 }}>
                Orders and sales history are not affected. Only the menu configuration is deleted.
                You can re-import a fresh menu immediately after.
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn-ghost" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
                Cancel
              </button>
              <button className="btn btn-danger btn-lg" onClick={handleDeleteMenu} disabled={deleting}>
                {deleting ? 'Deleting…' : '🗑 Yes, delete entire menu'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
