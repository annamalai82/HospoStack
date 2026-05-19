import { useState } from 'react';
import { useDevice } from '../context/DeviceContext';
import ManagerHub from './ManagerHub';
import VenueSwitcher from './VenueSwitcher';
import ConnectionIndicator from './ConnectionIndicator';

export default function TopBar() {
  const { device, logout, reset } = useDevice();
  const [showHub, setShowHub] = useState(false);

  const initials = (device.user?.name || '?')
    .split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();

  const isManager = device.user?.role === 'manager';

  return (
    <>
      <div className="topbar">
        {/* Brand + venue */}
        <div className="brand">
          <span className="mark">Hospo</span>
          <span className="stack">Stack</span>
          <span className="dot" />
          <span className="venue-name">
            <VenueSwitcher compact />
          </span>
        </div>

        {/* Mode pill — centre */}
        <div className="topbar-center">
          <ConnectionIndicator />
          <span className={`mode-pill ${device.mode}`}>
            <span className="pin" />
            {device.mode === 'kitchen' ? 'Kitchen'
              : device.mode === 'floor' ? 'Floor'
              : 'Till'}
            <span className="device-name">· {device.deviceName}</span>
          </span>
        </div>

        {/* User / actions — right */}
        <div className="topbar-right">
          {/* Avatar always visible */}
          <div className="user-chip">
            <div className="avatar">{initials}</div>
            <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{device.user.name}</span>
          </div>
          {/* Just avatar on mobile */}
          <div className="avatar" style={{ display: 'none' /* shown below via CSS */ }}>{initials}</div>

          {isManager && (
            <button
              className="btn-ghost"
              onClick={() => setShowHub(true)}
              title="Manager settings"
              style={{ padding: '8px' }}
            >
              ⚙
            </button>
          )}
          <button className="btn-ghost" onClick={logout} style={{ padding: '8px' }} title="Lock">🔒</button>
        </div>
      </div>

      {showHub && isManager && <ManagerHub onClose={() => setShowHub(false)} />}
    </>
  );
}
