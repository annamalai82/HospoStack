import { useState } from 'react';
import { useDevice } from '../context/DeviceContext';
import { useTheme } from '../context/ThemeContext';
import ManagerHub from './ManagerHub';
import ConnectionIndicator from './ConnectionIndicator';

const THEMES = [
  { id: 'dark',   icon: '🌑', label: 'Dark' },
  { id: 'light',  icon: '☀️', label: 'Light' },
  { id: 'cinema', icon: '🎬', label: 'Cinema' },
];

export default function TopBar() {
  const { device, logout, reset } = useDevice();
  const { theme, setTheme } = useTheme();
  const [showHub, setShowHub] = useState(false);
  const [showTheme, setShowTheme] = useState(false);

  const initials = (device.user?.name || '?')
    .split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();

  const isManager = device.user?.role === 'manager';
  const currentTheme = THEMES.find(t => t.id === theme) || THEMES[0];

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
          {/* Avatar always visible */}
          <div className="user-chip">
            <div className="avatar">{initials}</div>
            <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{device.user.name}</span>
          </div>
          {/* Just avatar on mobile */}
          <div className="avatar" style={{ display: 'none' /* shown below via CSS */ }}>{initials}</div>

          {/* Theme picker */}
          <div style={{ position: 'relative' }}>
            <button
              className="btn-ghost"
              onClick={() => setShowTheme(v => !v)}
              title="Change theme"
              style={{ padding: '8px', fontSize: 16 }}
            >
              {currentTheme.icon}
            </button>
            {showTheme && (
              <div className="theme-dropdown">
                {THEMES.map(t => (
                  <button
                    key={t.id}
                    className={`theme-option ${theme === t.id ? 'active' : ''}`}
                    onClick={() => { setTheme(t.id); setShowTheme(false); }}
                  >
                    <span>{t.icon}</span>
                    <span>{t.label}</span>
                    {theme === t.id && <span style={{ marginLeft: 'auto', color: 'var(--brand)' }}>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

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
