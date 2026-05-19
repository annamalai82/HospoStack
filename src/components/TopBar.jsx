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
        <div className="brand">
          <span className="mark">Hospo</span>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, letterSpacing: '-0.02em' }}>Stack</span>
          <span className="dot" />
          <VenueSwitcher />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <ConnectionIndicator />
          <span className={`mode-pill ${device.mode}`}>
            <span className="pin" />
            {device.mode === 'kitchen' ? 'Kitchen Display' : device.mode === 'floor' ? 'Floor · Tables' : 'Till POS'}
            <span style={{ color: 'var(--text-3)', marginLeft: 4 }}>· {device.deviceName}</span>
          </span>
        </div>

        <div className="right">
          <div className="user-chip">
            <div className="avatar">{initials}</div>
            <span>{device.user.name}</span>
          </div>
          {isManager && (
            <button className="btn-ghost" onClick={() => setShowHub(true)} title="Manager settings">
              ⚙ Manage
            </button>
          )}
          <button className="btn-ghost" onClick={logout}>Lock</button>
          <button className="btn-ghost" onClick={reset}>Setup</button>
        </div>
      </div>

      {showHub && isManager && <ManagerHub onClose={() => setShowHub(false)} />}
    </>
  );
}
