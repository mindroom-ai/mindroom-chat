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
numeric prefixes (`0_iphone-6-9_light_personal-workspace.png`,
`1_iphone-6-9_dark_mindroom-explained.png`, ...).

The automated release set contains five different scenes per device class:

| Order | Theme | Content |
| ----- | ----- | ------- |
| 0 | Light | Personal workspace overview |
| 1 | Dark | MindRoom product explanation |
| 2 | Light | Campground watcher with expanded tool calls |
| 3 | Dark | Car research and negotiation shortlist |
| 4 | Light | Household reminder batch |

The theme is part of each filename, and the capture test rejects byte-identical
screenshots within a device class. This prevents an unnoticed navigation or
rendering failure from uploading duplicate release artwork.

Automated capture, from the repository root:

```bash
npm run appstore:screenshots
```

The command starts the local Docker Matrix fixture stack by default, provisions
an isolated disposable account and room for each run, seeds a public-safe fake
`Personal` room with Bas Nijholt as the user, downloads and uploads the public
`nijho.lt` profile avatar at seed time, uploads AI agent avatars, and captures
the required iPhone 6.9" and iPad 13" PNGs into `en-US/`. The fixture shows
five distinct personal-agent examples across explicit light and dark themes: a
daily workspace overview, Mind's public-safe markdown-formatted explanation of
MindRoom, a campground watcher with expanded tool calls, car research, and a
household reminder batch. It starts a fresh Vite server on an available port by
default to avoid reusing stale local dependency caches.

To set up only the Matrix fixture without taking screenshots:

```bash
npm run appstore:fixture
```

Existing/live account capture is intentionally unsupported for App Store
screenshots because it can expose private rooms, profiles, or existing account
state. Use the local fixture path for release assets.

The fixture intentionally gives each thread summary a topic-specific emoji and
varied message counts, including one long-running watcher around 100 messages,
so room overview screenshots look like an active personal workspace.

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
