# App Store screenshots

Generate the complete screenshot set from the repository root:

```bash
npm run appstore:screenshots
```

The command starts the local Docker Matrix stack, creates a disposable account and room for each run, and seeds the fictional Rivera household from [mindroom-ai/demo](https://github.com/mindroom-ai/demo).
Sam Rivera talks to Hearth, Pantry, and Atlas using bundled avatars in `scripts/fixtures/appstore/avatars/`.
No external profile download or demo checkout is required.
The fixture and avatars are pinned to demo commit `fc39fb8a9e4af01c3c848e191f32c25b7da694a2`.

| Order | Theme | Content |
| ----- | ----- | ------- |
| 0 | Light | Family workspace overview |
| 1 | Dark | Vegetarian meal plan and grocery list |
| 2 | Light | Home automation with expanded tool calls |
| 3 | Dark | Lisbon weekend trip options |
| 4 | Light | Reminder to call Rosa tomorrow at four |

Capture uses UTC so the reminder text agrees with its 4:00 PM schedule on any host.
The local test server enables legacy media downloads so this client can load avatars.
Each summary counts the messages actually seeded.
The test waits for visible images to finish loading and rejects duplicate captures within each device class.
Scene IDs and filenames retain their original names for compatibility with the release preflight.

| Device class | Portrait size |
| ------------ | ------------- |
| iPhone 6.9" | 1320 x 2868 |
| iPad Pro 13" | 2064 x 2752 |

Screenshots are written into `en-US/` and remain gitignored.
Fastlane maps images to device classes by their exact dimensions and sorts filenames alphabetically within each class.
The numeric prefixes keep the scenes in the order above.

Upload the complete set from `ios/App`:

```bash
bundle exec fastlane ios upload_screenshots
```

The lane uses `overwrite_screenshots: true`, so populate both device classes before uploading.
See [.docs/ios-fastlane.md](../../../../.docs/ios-fastlane.md) for release submission and authentication.

To seed only the local fixture:

```bash
npm run appstore:fixture
```

Existing or live account capture is unsupported because it can expose private rooms and profiles.
Setup errors stop capture before Playwright starts.
The wrapper starts a fresh Vite server on an available port to avoid stale local builds.

Manual simulator fallback:

- Pick the matching device, such as iPhone 16 Pro Max for 6.9 inches, then run `xcrun simctl io booted screenshot shot.png`.
- Fastlane `snapshot` requires an Xcode UI-test target, which this project does not have yet.
