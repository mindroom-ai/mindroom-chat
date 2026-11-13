# Releases and the iOS app

This page covers the calendar versions this repository releases under, how a release is cut by hand or after CI, how Xcode Cloud builds the iOS app from this repository, and the steps that move the App Store app (MindRoom AI, `chat.mindroom.app`) from the legacy MindRoom Chat repository (`mindroom-ai/mindroom-chat-legacy`) to this one.

In short:

- A release is a tag `vYYYY.M.N` on a commit of `main`. `just release` cuts one by hand; `.github/workflows/release.yml` cuts one after every green push to `main` while `release.config.json` says `"autoRelease": true`, as it does. Every release also publishes the container image `ghcr.io/mindroom-ai/mindroom-chat:YYYY.M.N` ([`deployment.md`](deployment.md#container-image)).
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

`.github/workflows/release.yml` runs after the CI workflow completes for a push to `main`. When CI passed, it checks out that commit with every tag and runs `node scripts/calver.mjs auto <commit> --main origin/main`, which reads `release.config.json` at that commit:

- `"autoRelease": true` (as it is): the job cuts the release as `just release --yes` would, with the job's `GITHUB_TOKEN` (`contents: write`), and hands its tag to the `image` job, which publishes the release's container image (`.github/workflows/image.yml`, [`deployment.md`](deployment.md#container-image)).
- `"autoRelease": false`: the job logs `Automatic releases are off: release.config.json has "autoRelease": false. Nothing to do.` and succeeds.

A push whose CI failed, or was cancelled by a newer push, gets no release; the next green push releases its commits too. Runs never overlap, and a run whose commit no longer contains the newest release (one that lost a race) does nothing. Pushes that change only `docs/design/` or `docs/provenance.md` do not run CI, so they release nothing either.

Releases follow every green push rather than a daily batch: a burst of pushes still makes one release at a time (a waiting run gives way to the newest), a deployment can take a fix as soon as CI passes, and Xcode Cloud builds move to a new version with each release instead of sharing one for a day, which App Store review may close for uploads once it approves a build of it.

To switch automatic releases off, change the one boolean and push it to `main`:

```json
{
  "autoRelease": false
}
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
- **Automatic releases:** push `"autoRelease": false`. A release that should not exist can be deleted with `gh release delete <tag> --cleanup-tag --yes` while no build of it has reached App Store review. Its container image stays on GHCR under its tags until its package version is deleted there, and keeps `latest` until a newer release takes it: point `latest` back at the previous release first, with `docker buildx imagetools create --tag ghcr.io/mindroom-ai/mindroom-chat:latest ghcr.io/mindroom-ai/mindroom-chat:<previous YYYY.M.N>` (a token with `write:packages`), and only then delete the package version, which would otherwise take `latest` with it.
- The build counter keeps counting whichever way; there is nothing to reset.

## Choices to revisit

- `N` starts at 0, as in the backend's tags (`v2026.11.0`). Starting at 1 means changing `nextVersion` in `scripts/calver.mjs` and its tests.
- With automatic releases on, every green push to `main` is a release and, with a Branch Changes workflow, a TestFlight build. A tag start condition (tags beginning with `v2`) instead of Branch Changes builds only releases, which suits a slower cadence.
- Untagged builds take the next release's version, so TestFlight builds between releases share it and differ by build number. They get no tag of their own.
