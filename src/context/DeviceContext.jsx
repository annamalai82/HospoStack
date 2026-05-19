import { createContext, useContext, useEffect, useState } from 'react';
import { openSession, closeSession } from '../lib/data';

const DeviceContext = createContext(null);

const KEY = 'hospostack.device';

export function DeviceProvider({ children }) {
  const [device, setDevice] = useState(() => {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
  });

  useEffect(() => {
    if (device) localStorage.setItem(KEY, JSON.stringify(device));
    else localStorage.removeItem(KEY);
  }, [device]);

  const configure = (mode, deviceName) => {
    setDevice({ mode, deviceName, user: null, sessionId: null });
  };

  const login = async (user) => {
    if (!device) return;
    const sessionId = await openSession(device.mode, device.deviceName, user.id);
    setDevice({ ...device, user, sessionId });
  };

  const logout = async () => {
    if (device?.sessionId) await closeSession(device.sessionId).catch(() => {});
    if (device) setDevice({ ...device, user: null, sessionId: null });
  };

  const reset = async () => {
    if (device?.sessionId) await closeSession(device.sessionId).catch(() => {});
    setDevice(null);
  };

  return (
    <DeviceContext.Provider value={{ device, configure, login, logout, reset }}>
      {children}
    </DeviceContext.Provider>
  );
}

export const useDevice = () => useContext(DeviceContext);
