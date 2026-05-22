/**
 * native.js — Capacitor plugin wrappers
 *
 * All calls are guarded with isNative() so the same code works in a browser
 * (Vercel deployment) and inside the Capacitor shell on Android / Windows.
 *
 * Import and call initNative() once from main.jsx.
 */

// Check if we're inside a Capacitor native shell
export const isNative = () =>
  typeof window !== 'undefined' && !!(window.Capacitor?.isNativePlatform?.());

export const platform = () =>
  window.Capacitor?.getPlatform?.() || 'web'; // 'android' | 'electron' | 'web'

/**
 * Call once after React mounts.
 * Sets up: status bar, orientation lock, keep-screen-on, back-button handling.
 */
export async function initNative() {
  if (!isNative()) return;

  const plat = platform();

  // ── Status bar ──────────────────────────────────────────────────────────
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#0b0d10' });
    await StatusBar.show();
  } catch (e) { console.warn('StatusBar:', e?.message); }

  // ── Screen orientation — lock landscape on tablets ───────────────────────
  try {
    const { ScreenOrientation } = await import('@capacitor/screen-orientation');
    // Lock landscape for POS / KDS use; portrait mode optional for phone
    await ScreenOrientation.lock({ orientation: 'landscape' });
  } catch (e) { console.warn('ScreenOrientation:', e?.message); }

  // ── Keep screen on ───────────────────────────────────────────────────────
  // Prevents display from sleeping during service — critical for KOT display
  try {
    if (plat === 'android') {
      // Use the WakeLock web API (supported in Android WebView 81+)
      if ('wakeLock' in navigator) {
        let lock = await navigator.wakeLock.request('screen');
        // Re-acquire after tab re-focus (page visibility change)
        document.addEventListener('visibilitychange', async () => {
          if (document.visibilityState === 'visible') {
            try { lock = await navigator.wakeLock.request('screen'); } catch {}
          }
        });
        console.log('WakeLock acquired');
      }
    }
  } catch (e) { console.warn('WakeLock:', e?.message); }

  // ── Hardware back button (Android) ───────────────────────────────────────
  // By default the back button would close the app. Override it to do nothing
  // on the main screen (POS should require deliberate exit).
  try {
    const { App } = await import('@capacitor/app');
    App.addListener('backButton', ({ canGoBack }) => {
      // On the main POS screen canGoBack is false — block exit
      if (!canGoBack) {
        // Could prompt "Exit POS?" here if desired
        console.log('Back button suppressed — POS mode');
      }
    });
  } catch (e) { console.warn('App plugin:', e?.message); }

  // ── Keyboard ─────────────────────────────────────────────────────────────
  try {
    const { Keyboard } = await import('@capacitor/keyboard');
    await Keyboard.setAccessoryBarVisible({ isVisible: false });
    await Keyboard.setScroll({ isDisabled: true });
  } catch (e) { console.warn('Keyboard:', e?.message); }

  console.log(`[HospoStack] Native init complete — platform: ${plat}`);
}

/**
 * Send a local notification for KOT alerts when the app is backgrounded.
 * The in-app audio alert (Web Audio API) handles foreground;
 * this handles the Android notification tray when the KOT display is
 * running as a background process or the screen is off.
 *
 * Call from KitchenMode when a new/modified order arrives.
 */
export async function sendKOTNotification({ type = 'new', count = 1 } = {}) {
  if (!isNative()) return;
  if (document.visibilityState === 'visible') return; // foreground = use Web Audio

  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const perms = await LocalNotifications.checkPermissions();
    if (perms.display !== 'granted') {
      await LocalNotifications.requestPermissions();
    }
    await LocalNotifications.schedule({
      notifications: [{
        id:    Date.now(),
        title: type === 'new' ? `🔔 ${count} new order${count > 1 ? 's' : ''}` : `✏ Order updated`,
        body:  type === 'new'
          ? 'New ticket arrived on KOT display'
          : 'An existing order was modified',
        sound: 'beep.wav',
        smallIcon: 'ic_stat_icon_config_sample',
        iconColor: '#FF7A45',
        extra: { type, count }
      }]
    });
  } catch (e) { console.warn('LocalNotifications:', e?.message); }
}

/**
 * Haptic feedback — short tap for button presses on Android.
 * No-ops silently on web.
 */
export async function haptic(style = 'light') {
  if (!isNative()) return;
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    const map = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy };
    await Haptics.impact({ style: map[style] || ImpactStyle.Light });
  } catch {}
}
