# MindRoom iOS App Store Submission Packet

Last updated: 2026-02-26

Use this file to paste content directly into App Store Connect.

## Current Packet Progress (2026-02-26)

- [x] Reviewer note template drafted below.
- [x] Product summary / fork positioning note available.
- [ ] Replace bracketed placeholders in review notes (`[YOUR ...]`, credentials if needed).
- [ ] Confirm final public Support / Privacy / Terms URLs (current config points all three to docs homepage).
- [ ] Fill App Store Connect subtitle and copyright.
- [ ] Decide whether reviewer test account is required and provide credentials/instructions if so.
- [ ] Validate App Privacy answers against production server behavior.

## 1) App Review Notes (Paste As-Is, Then Edit Bracketed Fields)

```text
MindRoom is a Matrix client app.

Important behavior for review:
- This iOS build supports both existing-account login and account creation.
- Sign in with Apple is supported via homeserver SSO identity providers.
- Users sign in to Matrix homeservers and can send/receive end-to-end encrypted messages.
- The app includes user-generated-content safety controls:
  - report message/content
  - ignore/block users
- Network policy:
  - HTTPS is required for non-local homeservers.
  - HTTP is only permitted for local-network/self-hosted homeserver scenarios.

Support and policy:
- Support URL: [YOUR SUPPORT URL]
- Privacy Policy URL: [YOUR PRIVACY POLICY URL]
- Terms URL (optional): [YOUR TERMS URL]

Reviewer test account (if needed):
- Homeserver: [SERVER]
- Username: [USERNAME]
- Password: [PASSWORD]
- 2FA / extra steps: [NONE OR INSTRUCTIONS]
```

## 2) Metadata Completion Checklist

- App Name: `MindRoom`
- Subtitle: `[FILL]`
- Category: `Social Networking` (or your final selected category)
- Support URL: must be public and live.
- Privacy Policy URL: must be public and live (required).
- Marketing URL: optional.
- Copyright: `[FILL]`
- Demo account for review: provide if your server is private.
- Ensure Support/Privacy/Terms URLs are final legal/support pages before submission (not placeholders).

## 3) README Context For Reviewers

If reviewers ask for project context, point them to:

- Product overview and fork positioning in `README.md`.
- Fork behavior/details in `FORK_CHANGES.md`.

Use this one-liner summary:

```text
MindRoom is a Matrix client forked from Cinny and optimized for AI-agent workflows, with emphasis on streaming edit rendering, thread UX, and tool/run metadata visibility.
```

## 4) Privacy / Policy Consistency Checks

- If you operate no analytics SDKs, no ad SDKs, and no tracking, keep tracking disabled in App Privacy responses.
- Ensure App Privacy answers match actual runtime behavior and your production server architecture.
- If any backend controlled by your organization stores user account/profile/message data, reflect this accurately in App Privacy responses.

## 5) Export Compliance

- `ITSAppUsesNonExemptEncryption` is set in the app.
- Complete export compliance questions in App Store Connect consistent with shipped crypto behavior.

## 6) Final Gate

- Run `npm run appstore:preflight`.
- Complete `APP_STORE_COMPLIANCE.md`.
- Archive and upload from Xcode Organizer.
