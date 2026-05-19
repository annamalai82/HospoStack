import { useEffect, useState } from 'react';
import { DeviceProvider, useDevice } from './context/DeviceContext';
import ConfigScreen from './pages/ConfigScreen';
import PinScreen from './pages/PinScreen';
import TopBar from './components/TopBar';
import KitchenMode from './modes/KitchenMode';
import FloorMode from './modes/FloorMode';
import TillMode from './modes/TillMode';
import { seedIfEmpty } from './lib/data';

function Shell() {
  const { device } = useDevice();
  const [seeded, setSeeded] = useState(false);
  const [seedError, setSeedError] = useState(null);

  useEffect(() => {
    seedIfEmpty()
      .then(() => setSeeded(true))
      .catch(e => { setSeedError(e.message); setSeeded(true); });
  }, []);

  if (!seeded) {
    return <div className="loader"><div className="spinner" /></div>;
  }

  if (seedError) {
    const isOffline = seedError.toLowerCase().includes('offline') || seedError.toLowerCase().includes('unavailable');
    return (
      <div className="loader">
        <div style={{ maxWidth: 520, padding: 32 }}>
          <h3 style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 28, color: 'var(--red)', textAlign: 'center' }}>
            Can't reach Firestore
          </h3>
          <p style={{ marginTop: 8, color: 'var(--text-2)', fontSize: 13, textAlign: 'center', marginBottom: 24 }}>
            {seedError}
          </p>

          {isOffline && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, fontSize: 13 }}>
              <p style={{ color: 'var(--amber)', fontWeight: 600, marginBottom: 14, letterSpacing: '0.04em', fontSize: 11, textTransform: 'uppercase' }}>
                Fix checklist — do these in order
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Step n="1" title="Create the Firestore database">
                  <a href="https://console.firebase.google.com/project/snspos-661a4/firestore" target="_blank" rel="noreferrer"
                     style={{ color: 'var(--blue)' }}>console.firebase.google.com → snspos-661a4 → Firestore Database</a>
                  {' '}→ <b>Create database</b> → Start in <b>test mode</b> → region <b>australia-southeast1</b>
                </Step>

                <Step n="2" title="Publish open security rules">
                  Firestore → <b>Rules</b> tab → replace all text with:
                  <pre style={{ background: 'var(--bg)', padding: '10px 12px', borderRadius: 6, marginTop: 8, fontSize: 12, color: 'var(--text-2)', overflowX: 'auto' }}>{`rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}`}</pre>
                  Then click <b>Publish</b>.
                </Step>

                <Step n="3" title="Reload this page">
                  After publishing rules, hard-refresh (<b>Ctrl+Shift+R</b> / <b>Cmd+Shift+R</b>).
                </Step>
              </div>

              <button
                className="btn btn-primary btn-block"
                style={{ marginTop: 20 }}
                onClick={() => { setSeedError(null); setSeeded(false); seedIfEmpty().then(() => setSeeded(true)).catch(e => { setSeedError(e.message); setSeeded(true); }); }}
              >
                Retry connection
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!device) return <ConfigScreen />;
  if (!device.user) return <PinScreen />;

  return (
    <div className="app">
      <TopBar />
      <main>
        {device.mode === 'kitchen' && <KitchenMode />}
        {device.mode === 'floor' && <FloorMode />}
        {device.mode === 'till' && <TillMode />}
      </main>
    </div>
  );
}

function Step({ n, title, children }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{
        flexShrink: 0, width: 24, height: 24, borderRadius: 999,
        background: 'var(--brand)', color: '#18120e',
        display: 'grid', placeItems: 'center',
        fontWeight: 700, fontSize: 12
      }}>{n}</div>
      <div>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
        <div style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>{children}</div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <DeviceProvider>
      <Shell />
    </DeviceProvider>
  );
}
