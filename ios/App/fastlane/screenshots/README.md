# App Store screenshots

Drop PNG screenshots into per-locale folders (for example `en-US/`) and upload
them with:

```bash
cd ios/App
bundle exec fastlane ios upload_screenshots
```

`deliver` maps each image to a device class by its pixel dimensions, so exact
sizes matter. Required current capture targets:

| Device class            | Portrait size |
| ----------------------- | ------------- |
| iPhone 6.9"             | 1320 x 2868   |
| iPad Pro 13" (required if iPad is supported) | 2064 x 2752 |

Ordering: `deliver` sorts filenames alphabetically per device class, so use
numeric prefixes (`0_welcome.png`, `1_threads.png`, ...).

Automated capture, from the repository root:

```bash
npm run appstore:screenshots
```

The command starts the local Docker Matrix fixture stack by default, provisions
a disposable account, seeds the App Store fixture room, and captures the
required iPhone 6.9" and iPad 13" PNGs into `en-US/`. It starts a fresh Vite
server on an available port by default to avoid reusing stale local dependency
caches.

To capture against an existing/live fixture account instead:

```bash
APPSTORE_SCREENSHOTS_USE_EXISTING_E2E=1 \
E2E_HOMESERVER=https://example.org \
E2E_USERNAME=alice \
E2E_PASSWORD=... \
E2E_FIXTURE_ROOM_ALIAS="#mindroom-app-store-screenshots:example.org" \
npm run appstore:screenshots
```

Manual simulator fallback:
- Pick the matching device (for example iPhone 16 Pro Max for 6.9"), then
  `xcrun simctl io booted screenshot shot.png`.
- Fully automated capture via fastlane `snapshot` needs an Xcode UI-test
  target, which this project does not have yet; see `.docs/ios-fastlane.md`.

Screenshots are intentionally not committed (see `.gitignore`) to keep binary
assets out of the repo; only this README and the locale folder placeholder are
tracked.

Because the lane runs `deliver` with `overwrite_screenshots: true`, populate
the locale folders with the full screenshot set before running it — don't run
it against an empty folder expecting existing App Store Connect screenshots to
survive.
