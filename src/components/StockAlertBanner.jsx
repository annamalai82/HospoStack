import { useEffect, useRef, useState } from 'react';
import { watchStockAlerts } from '../lib/data';

/**
 * StockAlertBanner — shown on Floor & Till devices.
 *
 * Subscribes to the venue's stock_alerts feed. When the kitchen 86's an item
 * (or restocks it), a banner slides in here and a beep plays so waiters and
 * cashiers know instantly not to sell (or that it's available again).
 *
 * Each alert is dismissable. New alerts since the component mounted trigger
 * a beep; alerts already in the window on mount do not (avoids beeping on
 * every page load).
 */
export default function StockAlertBanner() {
  const [alerts, setAlerts]       = useState([]);
  const [dismissed, setDismissed] = useState(new Set());
  const seenRef   = useRef(null);   // ids present at mount (no beep for these)
  const firstRef  = useRef(true);

  useEffect(() => {
    return watchStockAlerts((list) => {
      // On the first snapshot, record existing ids so we don't beep for them
      if (firstRef.current) {
        seenRef.current = new Set(list.map(a => a.id));
        firstRef.current = false;
        setAlerts(list);
        return;
      }
      // Detect genuinely new alerts → beep
      const isNew = list.some(a => !seenRef.current.has(a.id));
      if (isNew) {
        list.forEach(a => seenRef.current.add(a.id));
        playStockBeep();
      }
      setAlerts(list);
    });
  }, []);

  const visible = alerts.filter(a => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="stock-alert-stack">
      {visible.slice(0, 4).map(a => (
        <div
          key={a.id}
          className={`stock-alert ${a.action === '86' ? 'stock-alert--86' : 'stock-alert--restock'}`}
        >
          <span className="stock-alert-icon">
            {a.action === '86' ? '🚫' : '✅'}
          </span>
          <span className="stock-alert-text">
            <b>{a.itemName}</b>
            {a.action === '86'
              ? ' is OUT OF STOCK — do not sell'
              : ' is back in stock'}
            <span className="stock-alert-by"> · {a.byName}</span>
          </span>
          <button
            className="stock-alert-dismiss"
            onClick={() => setDismissed(prev => new Set(prev).add(a.id))}
          >×</button>
        </div>
      ))}
    </div>
  );
}

/* Short attention beep — distinct from the KDS new-order ping */
function playStockBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    // Three quick descending tones — "heads up" pattern
    [[0, 1046], [0.12, 880], [0.24, 660]].forEach(([offset, freq]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, now + offset);
      gain.gain.setValueAtTime(0.25, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.18);
      osc.start(now + offset);
      osc.stop(now + offset + 0.18);
    });
    setTimeout(() => ctx.close(), 700);
  } catch (_) { /* audio unavailable */ }
}
