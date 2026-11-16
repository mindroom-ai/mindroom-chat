# Releases and the iOS app

This page covers the calendar versions this repository releases under, how a release is cut by hand or after CI, how Xcode Cloud builds the iOS app from this repository, the Mac DMG every release carries, and the steps that move the App Store app (MindRoom AI, `chat.mindroom.app`) from the legacy MindRoom Chat repository (`mindroom-ai/mindroom-chat-legacy`) to this one.

In short:

- A release is a tag `vYYYY.M.N` on a commit of `main`. `just release` cuts one by hand; `.github/workflows/release.yml` cuts one after every green push to `main` while `package.json` says `"autoRelease": true`, as it does. Every release also publishes the container image `ghcr.io/mindroom-ai/mindroom-chat:YYYY.M.N` ([`deployment.md`](deployment.md#container-image)) and a signed Mac DMG for Homebrew ([Mac DMG](#mac-dmg)).
- Xcode Cloud builds take their App Store version from that scheme: a tag build gets the tag's version, any other build the version the next release will get. The build number is Xcode Cloud's own counter.
- Every `YYYY.M.N` sorts above the `4.12.x` versions of the legacy MindRoom Chat builds, so with the same app record and bundle identifier, installed apps update in place.

## Calendar versions

A release tag is `vYYYY.M.N`: the year and month (UTC) it was cut in, and `N`, which counts that month's releases from 0. The first release of November 2026 is `v2026.11.0`, the next `v2026.11.1`, and the first one in December `v2026.12.0`. Months have no leading zero, and neither has `N`. The MindRoom backend tags its releases the same way.

`scripts/calver.mjs` is the only code that reads these tags:

| Command | What it does |
|---|---|
| `node scripts/calver.mjs next` | prints the tag the next release gets, from the tags of the checkout (fetch them first: `git fetch --tags https://github.com/mindroom-ai/mindroom-chat.git`) |
| `node scripts/calver.mjs latest` | prints the newest release tag of the checkout; the Image workflow points the container image's `latest` only at that release ([`deployment.md`](deployment.md#container-image)) |
| `just release [<commit>] [--dry-run] [--yes]` | `scripts/calver.mjs release`: cuts a release by hand (below) |
| `node scripts/calver.mjs auto <commit> --main <ref>` | what the Release workflow runs (below) |

The next version is `N + 1` in the month of the newest release tag, or `N = 0` of the current month once that month is later. A clock that is behind the newest tag still gives a higher version. Tags of any other form (`v0.1.0`, `v4.12.6-mindroom.180`, `nightly`) do not count.

Where the version shows:

- **Settings > About** and **`version.json`** (`release`) show what `git describe` says about the release tags: `v2026.11.3` for a release, `v2026.11.3-4-g1a2b3c4` four commits after it (`scripts/build-version.mjs`). A build without a release tag in reach, such as one from `git archive` or a shallow clone, shows `v<package.json version>` unless `MINDROOM_RELEASE_VERSION` names the release. A deployment that builds from `git archive` passes it: `MINDROOM_RELEASE_VERSION="$(git -C <checkout> describe --tags --match 'v[0-9][0-9][0-9][0-9].[0-9]*.[0-9]*' --abbrev=7 <commit>)"`, after `git fetch --tags`.
- **The iOS app** shows the App Store version (`CFBundleShortVersionString`), and its About page the same with a `v` in front.
- `package.json`'s `version` is not a release version and does not change with releases.

## Cutting a release by hand

```bash
just release --dry-run          # what the next release of GitHub main would be, and its notes
just release                    # the same, then asks before it creates anything
just release <commit>           # a commit of main other than its tip
```

The recipe fetches GitHub's tags and `main` first. It refuses a commit that is not on `main`, and does nothing for a commit that already has a release tag or that does not contain the newest release. It then shows the tag, the commit and the release notes, and asks. `gh release create` makes the GitHub release and with it the tag (a lightweight tag at the commit), so it needs `gh` signed in with write access to the repository.

The notes list the commits since the previous release, newest first, up to 200, with a link to the full comparison. A `@name` in a commit subject is put in a code span, so a release notifies nobody. The first release only counts its commits.

## Automatic releases

`.github/workflows/release.yml` runs after the CI workflow completes for a push to `main`. When CI passed, it checks out that commit with every tag and runs `node scripts/calver.mjs auto <commit> --main origin/main`, which reads the top-level `autoRelease` of `package.json` at that commit:

- `"autoRelease": true` (as it is): the job cuts the release as `just release --yes` would, with the job's `GITHUB_TOKEN` (`contents: write`), and hands its tag to the `image` job, which publishes the release's container image (`.github/workflows/image.yml`, [`deployment.md`](deployment.md#container-image)), and to the `macos` job, which attaches its Mac DMG ([Mac DMG](#mac-dmg)).
- `"autoRelease": false`: the job logs `Automatic releases are off: package.json has "autoRelease": false. Nothing to do.` and succeeds.

A push whose CI failed, or was cancelled by a newer push, gets no release; the next green push releases its commits too. Runs never overlap, and a run whose commit no longer contains the newest release (one that lost a race) does nothing. Pushes that change only `docs/design/` do not run CI, so they release nothing either.

Releases follow every green push rather than a daily batch: a burst of pushes still makes one release at a time (a waiting run gives way to the newest), a deployment can take a fix as soon as CI passes, and Xcode Cloud builds move to a new version with each release instead of sharing one for a day, which App Store review may close for uploads once it approves a build of it.

To switch automatic releases off, set the top-level boolean in `package.json` to false and push it to `main`:

```json
  "autoRelease": false,
```

To switch them on again, push `true`; the commit that flips it is the first one released once its CI passes.

Tags that the workflow creates with `GITHUB_TOKEN` start no other GitHub workflow (GitHub's rule against loops). Xcode Cloud is not a GitHub workflow; it learns about pushes and tags from its GitHub app.

## Xcode Cloud builds

Xcode Cloud runs the scripts in `ios/App/ci_scripts/`, beside `ios/App/App.xcworkspace`, which a workflow builds with the shared scheme `App` (`ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme`; Xcode Cloud sees only shared schemes):

1. `ci_post_clone.sh` installs Node and CocoaPods with Homebrew when they are missing, then `npm ci`.
2. `ci_pre_xcodebuild.sh` fetches the tags, asks `scripts/ios-ci-version.mjs` for the versions, writes them into the App target (`MARKETING_VERSION`, `CURRENT_PROJECT_VERSION`), builds the web app with `MINDROOM_RELEASE_VERSION=v<marketing version>` (`npm run build:ios`), runs `npx cap sync ios` (which runs `pod install`) and the App Store preflight.

| Build | `MARKETING_VERSION` | `CURRENT_PROJECT_VERSION` |
|---|---|---|
| started by a release tag (`CI_TAG=v2026.11.3`) | `2026.11.3` | `CI_BUILD_NUMBER` |
| of a commit that carries a release tag | that tag's version | `CI_BUILD_NUMBER` |
| of any other commit, such as a push to `main` | the next release's version, `2026.11.4` after `v2026.11.3` | `CI_BUILD_NUMBER` |
| started by a tag that is not `vYYYY.M.N` | the build fails | |

With automatic releases on, a push to `main` starts its Xcode Cloud build before the Release workflow tags it; both arrive at the same version unless another release lands in between. `IOS_MARKETING_VERSION` (or `APP_STORE_MARKETING_VERSION`) and `IOS_BUILD_NUMBER`, set as workflow environment variables, override both. The build log names the source of each value, for example `Resolved iOS marketing version from next-after:v2026.11.3`. Untagged builds of one commit range share a version and differ in build number, which App Store Connect allows; Xcode Cloud's counter only grows.

Checked on macbook-m5 (Xcode 27.2, iOS 27.2 SDK, Node 26) on 2026-11-05, without Apple credentials, in a scratch clone with the test tags `v2026.10.4` and `v2026.11.1`: both scripts ran as Xcode Cloud runs them (`CI=TRUE CI_BUILD_NUMBER=9001`); `xcodebuild -showBuildSettings` for scheme `App` reported `MARKETING_VERSION = 2026.11.2`, `CURRENT_PROJECT_VERSION = 9001`, `PRODUCT_BUNDLE_IDENTIFIER = chat.mindroom.app` and `DEVELOPMENT_TEAM = DNA6966LGZ`; an unsigned `xcodebuild build` and `xcodebuild archive` for `generic/platform=iOS` (`CODE_SIGNING_ALLOWED=NO`) succeeded, and the archived app's `Info.plist` said `2026.11.2 (9001)` and its `version.json` `"release":"v2026.11.2"`. Signing, export and the upload to App Store Connect run only in Xcode Cloud and were not tried.

## Mac DMG

`.github/workflows/macos.yml` builds the Mac Catalyst app outside the App Store for every release: `release.yml` calls it after an automatic release, and the release event starts it for one cut by hand (prereleases, such as the watch SDK builds, get none). It runs `scripts/build-macos-app.sh --sign` on a `macos-26` runner with `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` both `YYYY.M.N`, which exports the app with Developer ID, notarizes and staples it, and packs it as `MindRoom.app` into `MindRoom.dmg`, itself signed, notarized and stapled. The job attaches the DMG to the release, and while that release is still the newest it sends `mindroom-chat-release` to `mindroom-ai/homebrew-tap`, whose workflow points the cask `mindroom-ai/tap/mindroom-chat` at it. The cask installs the app as `MindRoom Chat.app`, since the backend's menu bar app (cask `mindroom-ai/tap/mindroom`) is also `MindRoom.app`. The tap also checks once a day and takes the newest release that has a DMG.

A release's DMG is never replaced, so its bytes and the cask's checksum stay fixed. A release without one (its build failed, or it predates the workflow) gets it from a manual run of the workflow with its tag (Actions, **Mac app**, **Run workflow**), or from **Re-run failed jobs** on the failed run; releases before `v2026.11.100` cannot, since their build script still writes `MindRoom-Chat.dmg`. When only the request to the tap failed, the DMG is up and a rerun stops at it: run the tap's **Update MindRoom Chat cask** workflow by hand instead. Pull requests that change `ios/`, the build script or the workflow build the app unsigned and publish nothing.

The job needs these repository secrets: `MACOS_CODESIGN_CERTIFICATE_BASE64` and `MACOS_CODESIGN_CERTIFICATE_PASSWORD` (the Developer ID Application certificate of team `DNA6966LGZ` as a base64 `.p12`), `MACOS_KEYCHAIN_PASSWORD` (any value, for the runner's temporary keychain), `MACOS_PROVISIONING_PROFILE_BASE64` (the Developer ID profile `MindRoom Chat Developer ID` for `chat.mindroom.app`, base64), `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` (for `notarytool`), and `RELEASE_BOT_PRIVATE_KEY` with the variable `RELEASE_BOT_APP_ID` (the release bot GitHub App, which may dispatch to the tap).

## Mac App Store

`AppStoreMac` is a separate shared Catalyst scheme and application target for the Mac App Store, under the existing `chat.mindroom.app` identifier and team `DNA6966LGZ`. It reuses the client, plugins and scenes with separate sandbox entitlements and Mac category/copyright metadata. `App` and `scripts/build-macos-app.sh --sign` remain the Developer ID DMG route above. The Store target has no Watch dependency or Watch embed phase.

Quick Capture keeps its global Control+Option+Space shortcut and floating window. A native macOS `MindRoomMacSupport.bundle` performs the AppKit, Carbon and window-ordering operations using typed public APIs. The Store executable resolves each scene once using a unique, hidden title, caches its window weakly, restores the visible title, and clears the binding on disconnect. Ambiguous titles are rejected. Missing native support, shortcut failures and window errors are retained and shown in the main window; unsuccessful plugin operations reject. Links received by a restored widget wait for the main bridge. The Store sources contain no private `uiWindows` lookup. **Apple DTS calls the Catalyst/AppKit-bundle configuration unsupported** ([761049](https://developer.apple.com/forums/thread/761049), [769279](https://developer.apple.com/forums/thread/769279)). An unsigned build does not establish Store acceptance. Signed upload validation, a sandboxed TestFlight run and App Review are required before treating this route as accepted. Do not silently drop Quick Capture features or replace the Mac shell if validation fails.

For local structural verification, commit source changes first, then set `version` and `build` explicitly to the values being checked. The wrapper requires a clean checkout so it cannot stamp uncommitted code as HEAD; the generated, untracked Podfile.lock is excluded from that check.

```bash
scripts/test-macos-support.sh
MARKETING_VERSION="$version" CURRENT_PROJECT_VERSION="$build" scripts/build-macos-store.sh --unsigned
```

The unsigned command stamps the bundled web assets with HEAD and the chosen marketing version, archives `AppStoreMac` into `build/mac-app-store/MindRoomChat.xcarchive`, then checks bundle IDs, versions, commit, Mac metadata, every architecture, the native support bundle and the absence of Watch products. Its binary scan rejects a literal `uiWindows` string, but Swift short-string encoding means this is only a supplementary check; source isolation and runtime/Apple validation remain necessary. The command never signs, notarizes, uploads or starts a cloud build. A new sandboxed Store installation may require a new sign-in and Matrix verification; it does not migrate or modify the DMG's existing data.

Configure a **separate Xcode Cloud workflow**, keeping the existing iOS workflow unchanged:

1. Source repository `mindroom-ai/mindroom-chat`, branch changes on `main`, shared scheme `AppStoreMac`, workspace `ios/App/App.xcworkspace`.
2. Archive action `Archive - macOS`, platform macOS, destination Mac Catalyst, distribution preparation **App Store Connect** / **TestFlight and App Store**.
3. Internal TestFlight post-action for the Mac archive and the existing `MindRoom Testers` group. Add no external testing.

The pre-build script recognizes `CI_XCODE_SCHEME=AppStoreMac` and rejects an unexpected `CI_PRODUCT_PLATFORM` instead of entering the iOS path. It versions only AppStoreMac and its native support bundle using the product's positive, increasing `CI_BUILD_NUMBER`, and stamps web content with the actual checkout commit. iOS actions continue versioning App and the Watch targets. The post-build hook requires both `CI_ARCHIVE_PATH` and `CI_APP_STORE_SIGNED_APP_PATH`, checks the archive structure, and fully checks the signed export before distribution. Expected version/build values are resolved independently from the source and CI environment. Missing, ambiguous or invalid exports fail the build. Other schemes keep their existing path. Confirm the first Cloud run supplies the documented export variable and blocks distribution on any hook failure. PRs exercise the native contract and both unsigned Mac archive paths and publish neither.

The same check can inspect a downloaded export directory, `.app` or flat `.pkg` without installing it:

```bash
node scripts/macos-store-preflight.mjs "$app" "$version" "$build" "$commit"
```

Without `--structure-only`, this also verifies signatures, team `DNA6966LGZ`, Mac App Store distribution identities and signed sandbox/media/user-selected-file/network entitlements, production APNs and associated domains. Installer packages additionally require the team's Mac App Store installer signature; temporary extraction is removed after inspecting the enclosed app. Confirm Apple's processed build is App Store eligible; do not substitute Developer ID or development signing. Reuse Xcode Cloud signing instead of adding notarization credentials to this workflow.

Before review, exercise login/logout and encrypted history after restart, SSO/custom/universal links, notifications, voice messages, calls with microphone/camera permission denial and recovery, file selection/export/drag-drop, and Quick Capture from another app and full-screen Spaces, both screenshot targets and keyboard return. Screenshots require macOS 15.2 or later, as the existing ScreenCaptureKit guard specifies. Decide whether incoming-network access is needed from real WebRTC tests and sandbox evidence; do not grant broad filesystem access. Keep test accounts and captures separate from existing user data.

Add the macOS platform and safe Mac screenshots/review instructions to the existing App Store record only after reviewed fixes and validation. Mac versions have their own submission; preserve any pending iOS/Watch submission. Use the actual processed version/build and its release-tag source commit, show the concrete submission before final approval, and retain automatic release after approval. Stop on an Apple error, unanswered questionnaire, required agreement/tax/bank acceptance, or sign-in/2FA prompt. The iOS fastlane screenshot/submission lane is not the Mac release path.

## Moving the App Store app to this repository

The app keeps its App Store record (MindRoom AI, Apple ID 6760272172), bundle identifier `chat.mindroom.app` and team `DNA6966LGZ`; this repository's Xcode project already uses them. Only the repository Xcode Cloud builds from changes, so people who have the app get the next version as an ordinary update. These steps happen in GitHub, App Store Connect and the dev repository's `app-store/` tooling; nothing in them can be done from this repository.

1. **Retarget the old name.** Since 2026-11-07 UTC, `mindroom-ai/mindroom-chat` names this repository and the legacy client is `mindroom-ai/mindroom-chat-legacy`, so anything set up before then that names `mindroom-ai/mindroom-chat` reads this repository while it means the legacy client. Set the Primary Repository of every existing Xcode Cloud workflow that builds the legacy client to `https://github.com/mindroom-ai/mindroom-chat-legacy.git`, also for a workflow you only mean to disable, and set `app-store/source.env` in the dev repository to `mindroom-ai/mindroom-chat-legacy`. Do this before step 3: once Xcode Cloud may read this repository, a legacy workflow still on the old URL would start on its pushes.
2. **Finish what is in flight.** Let any legacy MindRoom Chat build or review that is under way end. Note the newest build: `./app-store/release.sh inspect` in the dev repository prints its version and build number (`target.version`, `target.build`, for example `4.12.421 (415)`).
3. **Give Xcode Cloud this repository.** In the `mindroom-ai` organization's GitHub settings, under GitHub Apps, configure the Xcode Cloud app and add `mindroom-ai/mindroom-chat` to the repositories it may read.
4. **Point a workflow at it.** In App Store Connect, open the app's Xcode Cloud tab and Manage Workflows, and make a workflow for this repository, most easily a duplicate of the one that builds the app today (its check runs are named `MindRoom.chat | Default | Archive - iOS`). In its workflow editor (the More button on the Manage Workflows page), set **Primary Repository** to `https://github.com/mindroom-ai/mindroom-chat.git`, the start condition to **Branch Changes** on `main`, the workspace to `ios/App/App.xcworkspace` with scheme `App`, and keep the Archive - iOS action and its TestFlight post-action as they were. Then disable the old workflow, or remove its start condition, so legacy MindRoom Chat pushes stop building. Both workflows belong to the same Xcode Cloud product and share its build counter. (Changing the primary repository on the product's Settings page, More Options, Change URL, moves every workflow at once instead; Apple describes both ways in its tech talk "Connect your project to Xcode Cloud".)
5. **Check the build counter.** On the Xcode Cloud Settings page, under Build Number, Next Build Number must be above the build noted in step 2. With the same product it already is; if Xcode Cloud ever starts from 1 again (a new product), set it there ("Setting the next build number for Xcode Cloud builds" in Apple's documentation).
6. **Build once.** Start the new workflow by hand on `main`. Before any release tag exists, its log says `Setting iOS MARKETING_VERSION=<year>.<month>.0 CURRENT_PROJECT_VERSION=<counter>` (`2026.11.0` in November 2026), and the archive reaches TestFlight with that version and build number.
7. **Point the release tooling at it.** In the dev repository, set `app-store/source.env` to `mindroom-ai/mindroom-chat`, this repository, then run `./app-store/release.sh inspect`. It should name the `main` commit of step 6 and its Apple version.
8. **Tag before submitting.** Run `just release <commit inspect named>` here and confirm only when the tag it prints is the version inspect showed. With automatic releases on, the workflow has already done this. If the two differ (the month changed since the build, or another release came in between), answer no, start a new build of `main` (it takes the version `just release` printed), and inspect again. Then submit as `app-store/README.md` describes.

An approved version cannot be uploaded again: App Store Connect rejects any later upload whose version is not higher than the newest approved one. Tagging a version before submitting it keeps that from happening, because untagged builds then take the version after it. If a version went out untagged, tag its commit with that version and the next builds move on.

### Rolling back

- **Before any calendar version is approved:** enable the old workflow again and disable the new one, after checking that the old workflow's Primary Repository is `https://github.com/mindroom-ai/mindroom-chat-legacy.git` (step 1; if step 4 used Change URL, change it to that address), and set `app-store/source.env` back to `mindroom-ai/mindroom-chat-legacy`, the value of step 1 (not the one from before the move, which now names this repository); `./app-store/release.sh inspect` then names a legacy commit. Nothing on the App Store changes; TestFlight keeps the `2026.x` builds, which nobody has to install.
- **After a calendar version is approved:** the App Store holds `2026.M.N`, and a legacy MindRoom Chat build at `4.12.x` can no longer be uploaded. A rollback build needs a version above the live one; in this repository's scripts `IOS_MARKETING_VERSION` sets it, and the legacy client's scripts would need the same before they can ship again.
- **Automatic releases:** push `"autoRelease": false` in `package.json`. A release that should not exist can be deleted with `gh release delete <tag> --cleanup-tag --yes` while no build of it has reached App Store review. Its container image stays on GHCR under its tags until its package version is deleted there, and keeps `latest` if it holds it until a newer release takes it. When `docker buildx imagetools inspect` shows `latest` with the same digest as the withdrawn release, point `latest` at the newest remaining release that has an image first, with `docker buildx imagetools create --tag ghcr.io/mindroom-ai/mindroom-chat:latest ghcr.io/mindroom-ai/mindroom-chat:<that YYYY.M.N>` (a token with `write:packages`), and only then delete the package version, which would otherwise take `latest` with it.
- The build counter keeps counting whichever way; there is nothing to reset.

## Choices to revisit

- `N` starts at 0, as in the backend's tags (`v2026.11.0`). Starting at 1 means changing `nextVersion` in `scripts/calver.mjs` and its tests.
- With automatic releases on, every green push to `main` is a release and, with a Branch Changes workflow, a TestFlight build. A tag start condition (tags beginning with `v2`) instead of Branch Changes builds only releases, which suits a slower cadence.
- Untagged builds take the next release's version, so TestFlight builds between releases share it and differ by build number. They get no tag of their own.
