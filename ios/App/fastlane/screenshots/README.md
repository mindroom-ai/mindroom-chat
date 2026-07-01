# App Store screenshots

Drop PNG screenshots into per-locale folders (for example `en-US/`) and upload
them with:

```bash
cd ios/App
bundle exec fastlane ios upload_screenshots
```

`deliver` maps each image to a device class by its pixel dimensions, so exact
sizes matter. Commonly accepted sizes:

| Device class            | Portrait size |
| ----------------------- | ------------- |
| iPhone 6.9" (required)  | 1320 x 2868   |
| iPhone 6.5"             | 1242 x 2688   |
| iPad Pro 13" (required if iPad is supported) | 2064 x 2752 |

Ordering: `deliver` sorts filenames alphabetically per device class, so use
numeric prefixes (`0_welcome.png`, `1_threads.png`, ...).

Capturing:
- Simulator: pick the matching device (for example iPhone 16 Pro Max for
  6.9"), then `xcrun simctl io booted screenshot shot.png`.
- Fully automated capture via fastlane `snapshot` needs an Xcode UI-test
  target, which this project does not have yet; see `.docs/ios-fastlane.md`.

Screenshots are intentionally not committed (see `.gitignore`) to keep binary
assets out of the repo; only this README and the locale folder placeholder are
tracked.

Because the lane runs `deliver` with `overwrite_screenshots: true`, populate
the locale folders with the full screenshot set before running it — don't run
it against an empty folder expecting existing App Store Connect screenshots to
survive.
