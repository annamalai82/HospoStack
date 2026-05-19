import { useState } from 'react';
import { useDevice } from '../context/DeviceContext';

const MODES = [
  {
    id: 'kitchen',
    title: 'Kitchen Display',
    role: 'Back of house',
    icon: '🔥',
    blurb: 'Live ticket board for kitchen and bar. Bump items as they go out.',
    bullets: ['Real-time order tickets', 'Station filters (kitchen, bar, expo)', 'Item-level bump & all-ready', 'Aging alerts after 8 / 15 min']
  },
  {
    id: 'floor',
    title: 'Floor / Table',
    role: 'Front of house',
    icon: '🍽',
    blurb: 'Take orders at the table. Send to the kitchen. No payment.',
    bullets: ['Visual table map by zone', 'Open / append to tab', 'Send-to-kitchen flow', 'Live status sync across tablets']
  },
  {
    id: 'till',
    title: 'Till POS',
    role: 'Counter / Cashier',
    icon: '💳',
    blurb: 'Full order + payment at the counter. Cash, card, split-pay.',
    bullets: ['Walk-up / takeaway orders', 'Settle dine-in tabs', 'Cash, card, split & change', 'Per-session cash-up']
  }
];

export default function ConfigScreen() {
  const { configure } = useDevice();
  const [pickedMode, setPickedMode] = useState(null);
  const [deviceName, setDeviceName] = useState('');

  const handleContinue = () => {
    if (!pickedMode) return;
    const name = deviceName.trim() || defaultName(pickedMode);
    configure(pickedMode, name);
  };

  return (
    <div className="config-screen">
      <div className="config-card">
        <div className="config-head">
          <div className="eyebrow">HospoStack · Device Setup</div>
          <h1>Choose this device's <span className="accent">role</span></h1>
          <p>
            One backend, three tailored interfaces. Pick the mode that matches where this
            device will live — kitchen tablet, floor handheld, or counter till. You can
            change it later from the menu.
          </p>
        </div>

        <div className="mode-grid">
          {MODES.map(m => (
            <button
              key={m.id}
              className="mode-card"
              aria-pressed={pickedMode === m.id}
              onClick={() => setPickedMode(m.id)}
            >
              <div className="icon">{m.icon}</div>
              <h3>{m.title}</h3>
              <div className="role">{m.role}</div>
              <p>{m.blurb}</p>
              <ul>
                {m.bullets.map(b => <li key={b}>{b}</li>)}
              </ul>
            </button>
          ))}
        </div>

        <div className="config-foot">
          <div className="device-name">
            <label htmlFor="dname">Device name</label>
            <input
              id="dname"
              placeholder={pickedMode ? defaultName(pickedMode) : 'e.g. Kitchen-1'}
              value={deviceName}
              onChange={e => setDeviceName(e.target.value)}
            />
          </div>
          <button
            className="btn btn-primary btn-lg"
            disabled={!pickedMode}
            style={{ opacity: pickedMode ? 1 : 0.4, cursor: pickedMode ? 'pointer' : 'not-allowed' }}
            onClick={handleContinue}
          >
            Continue →
          </button>
        </div>
      </div>
    </div>
  );
}

function defaultName(mode) {
  return mode === 'kitchen' ? 'Kitchen-1' : mode === 'floor' ? 'Floor-1' : 'Till-1';
}
