import { useState, useEffect } from 'react';
import UsersPanel from './UsersPanel';
import MenuPanel from './MenuPanel';
import ModifiersPanel from './ModifiersPanel';
import TablesPanel from './TablesPanel';
import ReportsPanel from './ReportsPanel';
import VenuePanel from './VenuePanel';
import CustomersPanel from './CustomersPanel';
import BookingsPanel from './BookingsPanel';
import VouchersPanel from './VouchersPanel';

const TABS = [
  { id: 'reports',   label: 'Reports',       icon: '📊', group: 'Insights' },
  { id: 'bookings',  label: 'Bookings',      icon: '📅', group: 'Insights' },
  { id: 'customers', label: 'Customers',     icon: '👥', group: 'Insights' },
  { id: 'vouchers',  label: 'Vouchers',      icon: '🎟', group: 'Insights' },
  { id: 'menu',      label: 'Menu',          icon: '🍽',  group: 'Setup' },
  { id: 'modifiers', label: 'Modifiers',     icon: '⚙',  group: 'Setup' },
  { id: 'tables',    label: 'Tables',        icon: '🪑', group: 'Setup' },
  { id: 'users',     label: 'Users & PINs',  icon: '🔑', group: 'Setup' },
  { id: 'venue',     label: 'Venue',         icon: '🏪', group: 'Setup' }
];

export default function ManagerHub({ onClose }) {
  const [tab, setTab] = useState('reports');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="hub-overlay" onClick={onClose} />
      <div className="hub">
        <div className="hub-head">
          <h2>Manager · Settings</h2>
          <button className="close" onClick={onClose}>×</button>
        </div>

        <nav className="hub-nav">
          <div className="label">Insights</div>
          {TABS.filter(t => t.group === 'Insights').map(t => (
            <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
              <span className="icon">{t.icon}</span>{t.label}
            </button>
          ))}

          <div className="divider" />
          <div className="label">Setup</div>
          {TABS.filter(t => t.group === 'Setup').map(t => (
            <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
              <span className="icon">{t.icon}</span>{t.label}
            </button>
          ))}
        </nav>

        <div className="hub-body">
          {tab === 'reports'   && <ReportsPanel />}
          {tab === 'bookings'  && <BookingsPanel />}
          {tab === 'customers' && <CustomersPanel />}
          {tab === 'vouchers'  && <VouchersPanel />}
          {tab === 'menu'      && <MenuPanel />}
          {tab === 'modifiers' && <ModifiersPanel />}
          {tab === 'tables'    && <TablesPanel />}
          {tab === 'users'     && <UsersPanel />}
          {tab === 'venue'     && <VenuePanel />}
        </div>
      </div>
    </>
  );
}
