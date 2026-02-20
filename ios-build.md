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

## Build & Run
- Select your iPhone (or simulator) as target
- Cmd+R to build and run
- For TestFlight: Product → Archive → Distribute App

## Updating web content
After making changes to the web app:
```bash
npm run build
npx cap sync ios
```
Then rebuild in Xcode.

## App Icon
Replace the images in `ios/App/App/Assets.xcassets/AppIcon.appiconset/` with MindRoom-branded icons.
Sizes needed: 1024x1024 (App Store), 180x180 (60pt @3x), 120x120 (60pt @2x), etc.

## Notes
- `NSAppTransportSecurity` is set to allow HTTP for local network homeservers
- `NSLocalNetworkUsageDescription` will show a prompt on first launch
- The app connects to whatever homeserver is configured in `dist/config.json`
