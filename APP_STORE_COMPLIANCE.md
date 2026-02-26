# MindRoom iOS App Store Compliance Checklist

Last updated: 2026-02-26

Use this checklist before every TestFlight/App Store submission.
Use `APP_STORE_SUBMISSION_PACKET.md` to populate App Store Connect metadata and review notes.

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
