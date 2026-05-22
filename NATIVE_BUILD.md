# HospoStack — Native App Build Guide
## Android Tablet + Windows Tablet

HospoStack uses **Capacitor 8** to wrap the React/Vite web app in a native
shell. The same codebase deploys to:

| Target | Output | Notes |
|---|---|---|
| **Android tablet** | APK / AAB | Sideload or Play Store |
| **Windows tablet** | `.exe` installer | Via Capacitor Electron |
| **Browser (Vercel)** | Web app | Always-on, no install needed |

---

## Prerequisites

### Common
- Node 20+ (`node -v`)
- npm 10+ (`npm -v`)
- Git

### Android
- **Java 17** — `java -version` (install via Adoptium or Android Studio)
- **Android Studio** — [developer.android.com/studio](https://developer.android.com/studio)
  - After install: SDK Manager → install Android 13 (API 33) or 14 (API 34)
  - Accept all SDK licences: `yes | sdkmanager --licenses`
- Set `ANDROID_HOME` env var:
  ```bash
  # macOS / Linux (~/.zshrc or ~/.bashrc)
  export ANDROID_HOME=$HOME/Library/Android/sdk   # macOS
  export ANDROID_HOME=$HOME/Android/Sdk           # Linux
  export PATH=$PATH:$ANDROID_HOME/emulator
  export PATH=$PATH:$ANDROID_HOME/platform-tools

  # Windows (PowerShell profile or System env vars)
  $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
  ```

### Windows tablet (Electron)
- Node 20 on Windows
- `npm install -g @capacitor-community/electron`

---

## First-time Android setup

```bash
# 1. Clone the repo
git clone https://github.com/annamalai82/HospoStack.git
cd HospoStack

# 2. Install deps
npm install

# 3. Add the Android platform
npx cap add android

# 4. Build + sync
npm run cap:sync

# 5. Open in Android Studio
npx cap open android
```

Android Studio will open the `android/` folder. Press **▶ Run** to install
on a connected tablet (USB debugging must be enabled on the device).

---

## Building an APK (sideload — no Play Store needed)

```bash
npm run cap:sync              # build web + sync to android/

# In Android Studio:
# Build → Generate Signed Bundle / APK → APK → fill in keystore → release

# OR via Gradle (unsigned debug — good for testing):
cd android
./gradlew assembleDebug       # → android/app/build/outputs/apk/debug/app-debug.apk

# Release (signed):
./gradlew assembleRelease     # requires signing configured (see below)
```

### Signing the APK

1. Generate a keystore (one-time):
   ```bash
   keytool -genkey -v \
     -keystore hospostack-release.jks \
     -alias hospostack \
     -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Create `android/key.properties` (**never commit this**):
   ```
   storePassword=YOUR_STORE_PASSWORD
   keyPassword=YOUR_KEY_PASSWORD
   keyAlias=hospostack
   storeFile=../hospostack-release.jks
   ```
3. Reference it in `android/app/build.gradle` (already done by Capacitor).

---

## Installing on a tablet

### Android (sideload)
1. On the tablet: **Settings → Security → Install unknown apps** → enable for Files/Chrome
2. Transfer the APK via USB, email, or Google Drive
3. Tap the APK to install

### Android (ADB direct install)
```bash
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

---

## Windows tablet (Electron)

```bash
# 1. Install Electron Capacitor community plugin
npm install @capacitor-community/electron

# 2. Add the platform
npx cap add @capacitor-community/electron

# 3. Build + sync + open
npm run cap:electron          # opens the Electron project in VS Code / explorer

# 4. Inside the electron/ folder:
cd electron
npm install
npm run electron:start        # dev mode
npm run electron:build        # produces installer in electron/dist/
```

The Windows installer will be a `.exe` NSIS installer or a `.msi`.
Copy it to the Windows tablet and install normally.

---

## Live-reload development (test on real device while coding)

1. Find your laptop's LAN IP:
   ```bash
   ipconfig getifaddr en0   # macOS
   hostname -I              # Linux
   ipconfig                 # Windows — look for IPv4 Address
   ```
2. Edit `capacitor.config.ts` — uncomment the `server` block and set the IP:
   ```ts
   server: {
     url: 'http://192.168.1.42:5173',
     cleartext: true,
   },
   ```
3. Run:
   ```bash
   npm run cap:livereload    # starts Vite + syncs + deploys to connected device
   ```
   Changes in `src/` reload instantly on the tablet.

4. **Remember to re-comment the `server` block** before building a release APK.

---

## App behaviour on device

| Feature | Behaviour |
|---|---|
| **Screen lock** | Disabled (WakeLock API) — screen stays on during service |
| **Orientation** | Locked to landscape |
| **Status bar** | Dark, branded (#0b0d10) |
| **Back button** | Suppressed on main POS screen — prevents accidental exit |
| **KOT alerts (foreground)** | Web Audio API (two-tone ping) |
| **KOT alerts (backgrounded)** | Android notification tray + sound |
| **Offline** | Firestore persistent cache — works through wifi drops, syncs on reconnect |
| **Keyboard** | Doesn't push layout — overlay mode |

---

## Updating the app on installed devices

```bash
# 1. Push code changes to GitHub
git push

# 2. Pull on build machine and rebuild
git pull
npm run cap:sync

# 3. Build new APK and install via ADB or sideload
cd android && ./gradlew assembleRelease
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

For a Play Store deployment, use `bundleRelease` instead of `assembleRelease`
to produce a `.aab` file, then upload to the Play Console.

---

## Recommended hardware

| Use | Recommended |
|---|---|
| Till / cashier | 10" Android tablet (Samsung Galaxy Tab A8 or similar), wall/counter mount |
| KOT display | 10–12" Android tablet mounted in kitchen, always-on |
| Config / reports | Any, including Windows Surface or iPad via web browser |

Keep tablets on a dedicated WiFi SSID close to the router for reliable Firebase sync.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `SDK location not found` | Set `ANDROID_HOME` env var, restart terminal |
| `Installed Build Tools revision ... is corrupted` | SDK Manager → uninstall + reinstall Build Tools |
| White screen on device | Check ADB logcat; usually a CORS or mixed-content issue |
| `cleartext not permitted` | Set `server.cleartext: true` in capacitor.config.ts for dev |
| App crashes on start | `adb logcat \| grep HospoStack` to see the error |
| WakeLock not working | Grant "Display over other apps" permission in Android settings |
