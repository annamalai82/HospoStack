import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId:    'com.hospostack.pos',
  appName:  'HospoStack POS',
  webDir:   'dist',

  // ── Server ────────────────────────────────────────────────────────────────
  // In production the app loads from bundled assets (webDir).
  // During dev, point at the Vite dev server so hot-reload works on device:
  //   npx cap run android --livereload --external
  // Uncomment the block below for live-reload dev sessions:
  //
  // server: {
  //   url: 'http://192.168.1.X:5173',
  //   cleartext: true,
  // },

  // ── Plugins ───────────────────────────────────────────────────────────────
  plugins: {
    // Keep the screen on during service (critical for a POS / KOT display)
    CapacitorApp: {
      launchShowDuration: 0,
    },

    // Status bar — match the app's dark chrome
    StatusBar: {
      style: 'dark',                 // dark icons on light bg OR light icons
      backgroundColor: '#0b0d10',   // matches --bg CSS variable
      overlaysWebView: false,
    },

    // Keyboard — don't push the layout up when the soft keyboard appears
    // on tablets the keyboard overlays instead
    Keyboard: {
      resize: 'none',
      style: 'dark',
      resizeOnFullScreen: false,
    },

    // Screen orientation — lock to landscape on tablets (best for POS)
    // Can be changed to 'portrait' for a phone-style install
    ScreenOrientation: {
      // Unlocked by default; lock via JS after the app mounts:
      // ScreenOrientation.lock({ orientation: 'landscape' })
    },

    // Local notifications — used for KOT alert sound fallback on Android
    // when the tab/app is backgrounded
    LocalNotifications: {
      smallIcon:         'ic_stat_icon_config_sample',
      iconColor:         '#FF7A45',
      sound:             'beep.wav',
    },

    // Allow cleartext traffic so Firestore WebSocket works on older Android
    // (Firestore SDK uses HTTPS/WSS so this is belt-and-braces)
    CapacitorHttp: {
      enabled: true,
    },
  },

  // ── Android ───────────────────────────────────────────────────────────────
  android: {
    // Minimum API 26 = Android 8 (covers essentially all tablets in service)
    minWebViewVersion: 60,

    // Build in release mode: cd android && ./gradlew bundleRelease
    // Build debug APK:       cd android && ./gradlew assembleDebug
    //
    // Signing — add to android/key.properties (NOT committed to git):
    //   storePassword=...
    //   keyPassword=...
    //   keyAlias=hospostack
    //   storeFile=../hospostack-release.jks
  },

  // ── Windows / Electron ────────────────────────────────────────────────────
  // For Windows tablets use @capacitor-community/electron (see README).
  // Run: npx cap add @capacitor-community/electron
  //      npx cap sync @capacitor-community/electron
  //      npx cap open @capacitor-community/electron
};

export default config;
