import { createContext, useContext, useEffect, useState } from 'react';
import { openSession, closeSession, setVenueId } from '../lib/data';

const DeviceContext = createContext(null);

const KEY = 'hospostack.device';

export function DeviceProvider({ children }) {
  const [device, setDevice] = useState(() => {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
  });

  // Whenever the device's venue changes, sync the data layer's active venue
  useEffect(() => {
    if (device?.venueId) setVenueId(device.venueId);
  }, [device?.venueId]);

  useEffect(() => {
    if (device) localStorage.setItem(KEY, JSON.stringify(device));
    else localStorage.removeItem(KEY);
  }, [device]);

  const configure = (mode, deviceName, venueId, venueName) => {
    if (venueId) setVenueId(venueId);
    setDevice({
      mode, deviceName, venueId, venueName,
      user: null, sessionId: null
    });
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

  // Manager-PIN-gated venue switch (used by Config mode + group admin)
  const switchVenue = (venueId, venueName) => {
    if (!device) return;
    setVenueId(venueId);
    setDevice({ ...device, venueId, venueName });
  };

  return (
    <DeviceContext.Provider value={{ device, configure, login, logout, reset, switchVenue }}>
      {children}
    </DeviceContext.Provider>
  );
}

export const useDevice = () => useContext(DeviceContext);
