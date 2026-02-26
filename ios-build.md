# MindRoom iOS Build Instructions

## Prerequisites

- macOS with Xcode 15+ (ensure the iOS platform is installed via Xcode > Settings > Components)
- Apple Developer account (for signing/TestFlight)
- CocoaPods (`brew install cocoapods` or `sudo gem install cocoapods`)
- Node.js 18+

## First-time setup

```bash
# Clone the repo (or pull latest)
cd mindroom-cinny

# Install dependencies and build web assets
npm install
npm run build

# Sync web assets and install CocoaPods dependencies
npx cap sync ios
```

Recommended preflight checks before opening Xcode:

```bash
npm run test
npm run build
npm run ios:icons
npm run appstore:preflight
```

## Open in Xcode

```bash
npx cap open ios
```

Or open `ios/App/App.xcworkspace` directly in Xcode.

## Configure signing

1. Open the project in Xcode
2. Select the "App" target
3. Go to "Signing & Capabilities"
4. Select your Apple Developer team
5. Set bundle ID to `com.mindroom.app`

## Build & Run (Debug)

- Select your iPhone (or simulator) as target
- Cmd+R to build and run

## Archive for TestFlight / App Store

1. In Xcode, set scheme to `App` and destination to `Any iOS Device (arm64)`.
2. Product → Archive.
3. In Organizer, select the archive and click `Distribute App`.
4. Choose `App Store Connect` → `Upload`.
5. In App Store Connect, attach the build to your app version and complete TestFlight/App Review metadata (see `APP_STORE_SUBMISSION_PACKET.md`).

## Updating web content

After making changes to the web app:

```bash
npm run build
npx cap sync ios
```

Then rebuild in Xcode.

## App Icon

Source icon should be `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` (1024x1024).
Regenerate all iOS icon slots with:

```bash
npm run ios:icons
```

## Notes

- `npx cap sync ios` must be run before each archive so `ios/App/App/public`, `config.xml`, and `capacitor.config.json` are regenerated.
- `NSAppTransportSecurity` allows cleartext only for local-network homeservers; non-local homeservers must use HTTPS.
- For this build profile, registration is enabled and Apple SSO provider support is required in homeserver auth flows.
- The app includes usage descriptions for microphone/camera/photo-library access to support voice and media attachment flows.
- For App Store submission readiness, complete the checklist in `APP_STORE_COMPLIANCE.md`.
