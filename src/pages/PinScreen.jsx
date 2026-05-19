import { useEffect, useState } from 'react';
import { useDevice } from '../context/DeviceContext';
import { findUserByPin } from '../lib/data';

export default function PinScreen() {
  const { device, login, reset } = useDevice();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e) => {
      if (e.key >= '0' && e.key <= '9') append(e.key);
      else if (e.key === 'Backspace') back();
      else if (e.key === 'Enter') submit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line
  }, [pin]);

  const append = (d) => {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    setError('');
    if (next.length === 4) setTimeout(() => trySubmit(next), 80);
  };

  const back = () => { setPin(p => p.slice(0, -1)); setError(''); };
  const submit = () => trySubmit(pin);

  const trySubmit = async (p) => {
    if (p.length !== 4) return;
    try {
      const user = await findUserByPin(p);
      if (!user) {
        setError('Invalid PIN');
        setPin('');
        return;
      }
      // Role check — kitchen device shouldn't let a waiter log in by accident, etc.
      // Manager can sign in anywhere.
      if (user.role !== 'manager') {
        const required = device.mode === 'kitchen' ? 'kitchen'
                       : device.mode === 'floor'   ? 'waiter'
                       : 'cashier';
        if (user.role !== required) {
          setError(`${user.name} is a ${user.role} — wrong device`);
          setPin('');
          return;
        }
      }
      await login(user);
    } catch (e) {
      setError(e.message);
      setPin('');
    }
  };

  return (
    <div className="pin-screen">
      <div className="pin-card">
        <h2>{modeLabel(device.mode)}</h2>
        <div className="subtitle">{device.deviceName} · Enter your 4-digit PIN</div>

        <div className="pin-dots">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className={`pin-dot ${i < pin.length ? 'filled' : ''}`} />
          ))}
        </div>
        <div className="pin-error">{error}</div>

        <div className="pin-grid">
          {['1','2','3','4','5','6','7','8','9'].map(d => (
            <button key={d} className="pin-key" onClick={() => append(d)}>{d}</button>
          ))}
          <button className="pin-key muted" onClick={back}>Del</button>
          <button className="pin-key" onClick={() => append('0')}>0</button>
          <button className="pin-key muted" onClick={() => reset()}>Setup</button>
        </div>

        <div className="pin-hint">
          Demo PINs · Manager <code>1234</code> · Waiter <code>1111</code> · Kitchen <code>2222</code> · Cashier <code>3333</code>
        </div>
      </div>
    </div>
  );
}

function modeLabel(m) {
  return m === 'kitchen' ? 'Kitchen Display'
       : m === 'floor'   ? 'Floor / Table Mode'
       : 'Till POS';
}
