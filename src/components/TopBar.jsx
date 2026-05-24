import { useState } from 'react';
import { useDevice } from '../context/DeviceContext';
import { useTheme, THEMES } from '../context/ThemeContext';
import ManagerHub from './ManagerHub';
import ConnectionIndicator from './ConnectionIndicator';

export default function TopBar() {
  const { device, logout } = useDevice();
  const { theme } = useTheme();
  const [showHub, setShowHub] = useState(false);

  const initials = (device.user?.name || '?')
    .split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();

  const isManager = device.user?.role === 'manager';
  const currentTheme = THEMES.find(t => t.id === theme);

  return (
    <>
      <div className="topbar">
        {/* Brand + venue */}
        <div className="brand">
          <span className="mark">Hospo</span>
          <span className="stack">Stack</span>
          <span className="dot" />
          <span className="venue-name" style={{ color: 'var(--brand)', display: 'inline' }}>
            {device.venueName || ''}
          </span>
        </div>

        {/* Mode pill — centre */}
        <div className="topbar-center">
          <ConnectionIndicator />
          <span className={`mode-pill ${device.mode}`}>
            <span className="pin" />
            {device.mode === 'kitchen' ? 'Kitchen'
              : device.mode === 'floor' ? 'Floor'
              : device.mode === 'config' ? 'Config'
              : 'Till'}
            <span className="device-name">· {device.deviceName}</span>
          </span>
        </div>

        {/* User / actions — right */}
        <div className="topbar-right">
          <div className="user-chip">
            <div className="avatar">{initials}</div>
            <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{device.user.name}</span>
          </div>

          {/* Active theme indicator — tiny, opens FloatingThemePicker hint */}
          {currentTheme && (
            <span
              title={`Theme: ${currentTheme.label} — click 🎨 to change`}
              style={{
                fontSize: 12, padding: '3px 8px', borderRadius: 999,
                background: 'var(--surface-2)', color: 'var(--text-3)',
                display: 'flex', alignItems: 'center', gap: 4, cursor: 'default'
              }}
            >
              {currentTheme.emoji}
              <span style={{ display: 'none' /* hide on narrow */ }}>{currentTheme.label}</span>
            </span>
          )}

          {isManager && (
            <button
              className="btn-ghost"
              onClick={() => setShowHub(true)}
              title="Manager settings"
              style={{ padding: '8px' }}
            >⚙</button>
          )}
          <button className="btn-ghost" onClick={logout} style={{ padding: '8px' }} title="Lock">🔒</button>
        </div>
      </div>

      {showHub && isManager && <ManagerHub onClose={() => setShowHub(false)} />}
    </>
  );
}
