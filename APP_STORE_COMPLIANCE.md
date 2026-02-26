# MindRoom iOS App Store Compliance Checklist

Last updated: 2026-02-26

Use this checklist before every TestFlight/App Store submission.
Use `APP_STORE_SUBMISSION_PACKET.md` to populate App Store Connect metadata and review notes.

## Current Progress (2026-02-26)

Use this section as the live status for the current submission attempt. Keep the main checklist below as the reusable template.

- [x] macOS/Xcode environment available and working (`xcodebuild`, CocoaPods, ImageMagick).
- [x] `npm install`
- [x] `npm run test`
- [x] `npm run build`
- [x] `npm run ios:icons`
- [x] `npm run appstore:preflight`
- [x] `npx cap sync ios` (including `pod install`)
- [x] Unsigned iOS Release `xcodebuild` build succeeded.
- [x] Unsigned iOS Release `xcodebuild archive` succeeded.
- [x] iOS Simulator build/install/launch smoke test succeeded.
- [x] Manual iOS Simulator smoke test: app launches, message send works, microphone recording works, and account deactivation entry is visible (deactivation action not executed yet).
- [x] In-app account deletion/deactivation entry point added in Settings → Account.
- [x] Native iOS AppIcon and Splash assets refreshed from `public/res/svg/mindroom.svg` (icon slots regenerated + `cap sync ios` run).
- [x] Native iOS AppIcon and Splash assets refreshed again from `~/Downloads/mindroom-logo.png` (square 1024 icon source render + regenerated icon slots + `cap sync ios` run).
- [x] Re-test on physical iPhone after switching Capacitor Keyboard resize mode to `native` (fix confirmed for predictive/autocorrect bar overlapping room composer).
- [x] Manual physical iPhone smoke test (partial): composer overlap fixed, account deactivation flow works, camera permission works, photo library permission works.
- [ ] Signed Xcode archive upload from Organizer.
- [ ] TestFlight smoke test on physical iPhone (login, register, Apple SSO, media permissions, account deletion entry).
- [ ] Homeserver used for submission exposes Apple SSO provider (current default server probe has no SSO flow).
- [ ] Replace `config.json` support/privacy/terms URLs with final production endpoints (current docs homepage URLs are placeholders for submission).
- [ ] Set final App Store version/build in Xcode (`MARKETING_VERSION` / `CURRENT_PROJECT_VERSION`) before upload.
- [ ] Complete App Store Connect metadata, App Privacy answers, and review notes packet.

## References (Apple)

- App Review Guidelines: <https://developer.apple.com/app-store/review/guidelines/>
- User-Generated Content guidance (Guideline 1.2): <https://developer.apple.com/app-store/review/guidelines/#user-generated-content>
- Sign in with Apple (Guideline 4.8): <https://developer.apple.com/app-store/review/guidelines/#sign-in-with-apple>
- Data Collection and Storage (Guideline 5.1.1): <https://developer.apple.com/app-store/review/guidelines/#data-collection-and-storage>
- Account deletion requirement details: <https://developer.apple.com/support/offering-account-deletion-in-your-app/>
- Account deletion API behavior and token revocation: <https://developer.apple.com/help/app-store-connect/manage-app-access-to-your-accounts/account-deletions-and-revoking-tokens>

## 1. Build + Binary Preflight

- [ ] `npm install`
- [ ] `npm run test`
- [ ] `npm run build`
- [ ] `npm run ios:icons`
- [ ] `npm run appstore:preflight`
- [ ] `npx cap sync ios`
- [ ] Open `ios/App/App.xcworkspace` in Xcode and verify archive builds successfully.
- [ ] Confirm `CFBundleShortVersionString` and `CFBundleVersion` are bumped for this submission.

## 2. App Behavior Gates (Review Risk Reduction)

- [ ] In-app registration is enabled for this build (`config.json` -> `auth.allowRegistration: true`).
- [ ] Apple sign-in requirement is enabled (`config.json` -> `auth.requireAppleProvider: true`).
- [ ] Homeserver SSO provider list includes Apple (`brand=apple` or equivalent provider metadata).
- [ ] Homeserver policy is enforced:
  - non-local servers must be `https://`
  - `http://` is only accepted for local-network hosts.
- [ ] `NSAppTransportSecurity` does not use broad `NSAllowsArbitraryLoads`.

### Apple SSO Homeserver Requirement (What Counts)

For this app build, an acceptable review/test homeserver is any Matrix homeserver that:

- returns `m.login.sso` in `/_matrix/client/v3/login`, and
- includes an Apple identity provider in `identity_providers` (prefer `brand: "apple"`).

The client also recognizes Apple providers by `id` or `name` containing `apple`, but `brand=apple` is the safest metadata for reviewer-visible behavior.

Quick check (replace with your review homeserver):

```bash
curl -sS https://YOUR-HOMESERVER/_matrix/client/v3/login | jq .
```

What to look for in the response:

- `"type": "m.login.sso"` flow present
- `identity_providers` contains an entry like:
  - `"brand": "apple"`
  - `"name": "Apple"` (or similar)

If the response only shows password/application-service flows, Apple SSO is not available for review and this build should not be submitted yet.

## 3. Privacy + Permissions

- [ ] `Info.plist` usage descriptions are present and accurate:
  - `NSMicrophoneUsageDescription`
  - `NSCameraUsageDescription`
  - `NSPhotoLibraryUsageDescription`
  - `NSPhotoLibraryAddUsageDescription`
  - `NSLocalNetworkUsageDescription`
- [ ] `ITSAppUsesNonExemptEncryption` is set correctly for the shipped binary.
- [ ] App Privacy answers in App Store Connect match real behavior (tracking = no unless changed).
- [ ] Privacy policy URL is set in App Store Connect and points to a public, production policy page.

## 4. User-Generated Content (UGC) Requirements

- [ ] The app can block/ignore users.
- [ ] The app can report abusive content/messages.
- [ ] Moderation/reporting behavior is functional against the production homeserver(s).
- [ ] A support contact URL is configured and reachable (`config.json` -> `auth.supportUrl`).

## 5. App Store Connect Metadata

- [ ] App description clearly states this is a Matrix client.
- [ ] Screenshots are current and match shipped UI.
- [ ] Age rating questionnaire is completed accurately.
- [ ] Privacy Policy URL is populated.
- [ ] Support URL is populated.
- [ ] Copyright and contact details are populated.

## 6. App Review Notes (Recommended)

Include a short reviewer note:

- The app is a Matrix client and supports account creation.
- Sign in with Apple is available through homeserver-configured SSO identity providers.
- The app supports message moderation tools (report + ignore/block).
- Local-network HTTP is only for user-owned local homeserver deployments; public homeservers use HTTPS.
- Mention any required test account credentials if your production server requires them.

## 7. Final Submit Gate

- [ ] Build uploaded from Xcode Organizer.
- [ ] Build processed in App Store Connect.
- [ ] TestFlight smoke test on physical iPhone completed.
- [ ] Submission metadata and review notes finalized.
