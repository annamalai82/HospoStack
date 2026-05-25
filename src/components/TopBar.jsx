import { useState } from 'react';
import { useDevice } from '../context/DeviceContext';
import { useTheme, THEMES } from '../context/ThemeContext';
import ManagerHub from './ManagerHub';
import ConnectionIndicator from './ConnectionIndicator';

const GROUPS = ['Base', 'Indian Luxury', 'Fast Casual', 'Vibrant', 'Operational'];

export default function TopBar() {
  const { device, logout } = useDevice();
  const { theme, setTheme } = useTheme();
  const [showHub, setShowHub]       = useState(false);
  const [showTheme, setShowTheme]   = useState(false);

  const initials = (device.user?.name || '?')
    .split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();

  const isManager   = device.user?.role === 'manager';
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

        {/* Right — user chip + theme + manager + lock */}
        <div className="topbar-right">
          {/* User chip */}
          <div className="user-chip">
            <div className="avatar">{initials}</div>
            <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{device.user.name}</span>
          </div>

          {/* Theme picker button — inline in topbar, no floating FAB */}
          <div style={{ position: 'relative' }}>
            <button
              className="topbar-theme-btn"
              onClick={() => setShowTheme(v => !v)}
              title={`Theme: ${currentTheme.label}`}
              aria-label="Change colour theme"
            >
              <span className="topbar-theme-swatch">
                {currentTheme.preview.map((c, i) => (
                  <span key={i} style={{ background: c, flex: i === 0 ? 2 : 1 }} />
                ))}
              </span>
              <span style={{ fontSize: 13 }}>🎨</span>
            </button>

            {showTheme && (
              <div
                className="theme-picker-modal topbar-theme-dropdown"
                onClick={e => e.stopPropagation()}
              >
                <div className="theme-picker-head" style={{ padding: '16px 20px 12px' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 16 }}>Choose a theme</h3>
                    <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--text-2)' }}>
                      Applies instantly across all modes
                    </p>
                  </div>
                  <button className="icon-btn" onClick={() => setShowTheme(false)}>×</button>
                </div>

                <div className="theme-picker-body" style={{ padding: '12px 20px 20px' }}>
                  {GROUPS.map(group => {
                    const groupThemes = THEMES.filter(t => t.group === group);
                    return (
                      <div key={group} className="theme-group">
                        <div className="theme-group-label">{group}</div>
                        <div className="theme-grid">
                          {groupThemes.map(t => (
                            <button
                              key={t.id}
                              className={`theme-card ${theme === t.id ? 'active' : ''}`}
                              onClick={() => { setTheme(t.id); setShowTheme(false); }}
                            >
                              <div className="theme-card-swatch">
                                {t.preview.map((c, i) => (
                                  <span key={i} style={{ background: c, flex: i === 0 ? 2 : 1 }} />
                                ))}
                              </div>
                              <div className="theme-card-body">
                                <div className="theme-card-name">
                                  <span className="theme-card-emoji">{t.emoji}</span>
                                  {t.label}
                                  {theme === t.id && (
                                    <span className="theme-card-active-badge">✓</span>
                                  )}
                                </div>
                                <div className="theme-card-desc">{t.description}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Click-outside dismissal */}
            {showTheme && (
              <div
                style={{ position: 'fixed', inset: 0, zIndex: 199 }}
                onClick={() => setShowTheme(false)}
              />
            )}
          </div>

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
