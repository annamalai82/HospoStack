import { useEffect, useState } from 'react';
import { disableNetwork, enableNetwork } from 'firebase/firestore';
import { db } from '../lib/firebase';

/**
 * Tracks browser online/offline state and surfaces it to the UI.
 * Firestore's offline cache handles queuing writes when offline — this just
 * shows the user what's happening.
 */
export function useConnection() {
  const [online, setOnline] = useState(navigator.onLine);
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    const handleOnline = async () => {
      setReconnecting(true);
      try {
        // Force-enable network to flush queued writes promptly
        await enableNetwork(db);
      } catch (e) { /* ignore */ }
      setOnline(true);
      // Brief "reconnecting" state to acknowledge the change visually
      setTimeout(() => setReconnecting(false), 1200);
    };

    const handleOffline = async () => {
      try {
        // Tell Firestore to stop trying — speeds up local reads
        await disableNetwork(db);
      } catch (e) { /* ignore */ }
      setOnline(false);
      setReconnecting(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return { online, reconnecting };
}

export default function ConnectionIndicator() {
  const { online, reconnecting } = useConnection();

  if (online && !reconnecting) {
    return null; // Hide when everything's fine
  }

  if (reconnecting) {
    return (
      <div className="connection-pill reconnecting" title="Reconnected — syncing">
        <span className="dot" />
        Syncing…
      </div>
    );
  }

  return (
    <div className="connection-pill offline" title="Working offline — changes will sync when you reconnect">
      <span className="dot" />
      Offline mode
    </div>
  );
}
