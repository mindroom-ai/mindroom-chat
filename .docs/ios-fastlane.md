# MindRoom iOS Releases with fastlane

[fastlane](https://fastlane.tools) automates the manual parts of the iOS
release flow: uploading App Store metadata, uploading screenshots, and pushing
TestFlight builds. It complements — not replaces — the existing pipeline
(push to `dev` → `auto-mindroom-release.yml` tags a release → Xcode Cloud
builds and uploads via `ios/App/ci_scripts`).

What fastlane owns in this repo:

| Task                       | Lane                 | Replaces                                                                                    |
| -------------------------- | -------------------- | ------------------------------------------------------------------------------------------- |
| Upload App Store metadata  | `upload_metadata`    | Manual copy-paste from `.docs/APP_STORE_SUBMISSION_PACKET.md` into App Store Connect        |
| Upload screenshots         | `upload_screenshots` | Manual drag-and-drop per device class in App Store Connect                                  |
| Local TestFlight build     | `beta`               | Xcode → Product → Archive → Organizer → Distribute (useful when Xcode Cloud is unavailable) |
| Web build + Capacitor sync | `sync_web`           | `npm run build && npx cap sync ios`                                                         |

## Install

Homebrew (simplest, no Ruby management):

```bash
brew install fastlane
```

Or via Bundler using the checked-in `ios/App/Gemfile` (requires Ruby >= 3.2,
e.g. `brew install ruby`; the macOS system Ruby 2.6 is too old for the
committed `Gemfile.lock`):

```bash
cd ios/App
bundle install
```

With Bundler, prefix commands with `bundle exec`; with the Homebrew install,
call `fastlane` directly.

## Authentication

Create an App Store Connect API key (App Store Connect → Users and Access →
Integrations → App Store Connect API) with the App Manager role, then export:

```bash
export ASC_KEY_ID="D383SF739"
export ASC_ISSUER_ID="6053b7fe-68a8-4acb-89be-165aa6465141"
export ASC_KEY_PATH="$HOME/keys/AuthKey_D383SF739.p8"
# or, for CI secrets: ASC_KEY_CONTENT="$(base64 -i AuthKey_D383SF739.p8)"
```

API-key auth avoids Apple ID two-factor prompts and works in CI.

## Lanes

Run all lanes from `ios/App`:

```bash
cd ios/App

# Upload name/subtitle/description/keywords/review notes to App Store Connect
bundle exec fastlane ios upload_metadata

# Upload screenshots from fastlane/screenshots/<locale>/
bundle exec fastlane ios upload_screenshots

# Build web assets, sync Capacitor, archive, upload to TestFlight
bundle exec fastlane ios beta
```

Metadata lives in `ios/App/fastlane/metadata/` as plain-text files (one field
per file), seeded from `.docs/APP_STORE_SUBMISSION_PACKET.md`. Edit the files
and re-run `upload_metadata`; the submission packet doc remains the place for
review-time checklists and credentials handling.

`deliver` uploads each file verbatim and simply skips fields whose file does
not exist. Release notes ("What's New") are therefore intentionally not
checked in — write real notes into
`fastlane/metadata/en-US/release_notes.txt` before each release upload, so a
stale placeholder can never ship. The same applies to the marketing URL.

Safety defaults (`ios/App/fastlane/Deliverfile`): uploads never submit for
review and never auto-release. Reviewer demo credentials are intentionally not
stored in the repo — fill the demo account fields in App Store Connect
manually at submission time.

## Screenshots

See `ios/App/fastlane/screenshots/README.md` for required pixel sizes, naming
conventions, and capture commands. Screenshot binaries are gitignored; the
directory only tracks documentation.

Follow-up (not yet implemented): fully automated capture with fastlane
`snapshot` requires adding an Xcode UI-test target to `App.xcodeproj`.
Alternatively, because the app is a Capacitor webview, Playwright (already in
this repo for e2e) could render App-Store-sized viewports and write directly
into `fastlane/screenshots/en-US/`.

## Signing note

The `beta` lane relies on Xcode-managed signing (`-allowProvisioningUpdates`)
with your local Apple Developer session. If team members without access to the
account need to build, adopt fastlane `match` (shared signing certificates in
an encrypted repo) as a follow-up.
