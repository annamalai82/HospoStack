import { useState } from 'react';
import { useTheme, THEMES } from '../context/ThemeContext';

const GROUPS = ['Base', 'Indian Luxury', 'Fast Casual', 'Vibrant', 'Operational'];

/**
 * FloatingThemePicker — rendered in every mode's root so the theme button
 * is always accessible regardless of which screen is active.
 *
 * A small palette button sits in the bottom-right corner.
 * Clicking it opens a full modal picker with preview swatches,
 * grouped by restaurant style.
 */
export default function FloatingThemePicker() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const current = THEMES.find(t => t.id === theme) || THEMES[0];

  return (
    <>
      {/* ── Trigger button ── */}
      <button
        onClick={() => setOpen(true)}
        className="theme-fab"
        title="Change theme"
        aria-label="Change colour theme"
      >
        <span className="theme-fab-swatch">
          {current.preview.map((c, i) => (
            <span key={i} style={{ background: c }} />
          ))}
        </span>
        <span className="theme-fab-icon">🎨</span>
      </button>

      {/* ── Modal ── */}
      {open && (
        <div
          className="modal-overlay theme-picker-overlay"
          onClick={() => setOpen(false)}
        >
          <div
            className="theme-picker-modal"
            onClick={e => e.stopPropagation()}
          >
            <div className="theme-picker-head">
              <div>
                <h3 style={{ margin: 0 }}>Choose a theme</h3>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-2)' }}>
                  Changes apply instantly across all modes
                </p>
              </div>
              <button className="icon-btn" onClick={() => setOpen(false)}>×</button>
            </div>

            <div className="theme-picker-body">
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
                          onClick={() => { setTheme(t.id); setOpen(false); }}
                        >
                          {/* Swatch strip */}
                          <div className="theme-card-swatch">
                            {t.preview.map((c, i) => (
                              <span key={i} style={{ background: c, flex: i === 0 ? 2 : 1 }} />
                            ))}
                          </div>
                          {/* Info */}
                          <div className="theme-card-body">
                            <div className="theme-card-name">
                              <span className="theme-card-emoji">{t.emoji}</span>
                              {t.label}
                              {theme === t.id && (
                                <span className="theme-card-active-badge">✓ Active</span>
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
        </div>
      )}
    </>
  );
}
