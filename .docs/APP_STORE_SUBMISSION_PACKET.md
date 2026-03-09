# MindRoom iOS App Store Submission Packet

Last updated: 2026-03-09

Use this file to paste content directly into App Store Connect.

## Current Packet Progress (2026-03-09)

- [x] Reviewer note template drafted below.
- [x] Product summary / fork positioning note available.
- [x] App Store Connect app record created as `Mindroom AI` because `MindRoom` was unavailable.
- [ ] Insert temporary reviewer credentials or a one-time registration token in App Review Information before submission.
- [x] Confirm final public Support / Privacy / Terms URLs.
- [x] Fill App Store Connect subtitle and copyright.
- [x] Decide whether reviewer test account is required: `mindroom.chat` registration is token-gated, so review access must be provided explicitly.
- [ ] Validate App Privacy answers against production server behavior, especially any hosted-service logging outside this client repo.

## 1) App Review Notes (Paste As-Is, Then Edit Bracketed Fields)

```text
Mindroom AI is a Matrix client app optimized for AI-agent workflows.

Important behavior for review:
- This iOS build supports both existing-account login and account creation.
- Sign in with Apple is supported via homeserver SSO identity providers.
- Users sign in to Matrix homeservers and can send/receive end-to-end encrypted messages, voice messages, and media attachments.
- The review homeserver for this build is https://mindroom.chat.
- Reviewer self-signup on this homeserver is not fully open: Matrix registration currently requires an `m.login.registration_token` stage.
- Provide either a temporary reviewer account or a one-time registration token in App Review Information before submission.
- The app includes an in-app account deactivation path at Settings -> Account -> Delete / Deactivate Account.
- The app includes user-generated-content safety controls:
  - report message/content
  - ignore/block users
- Network policy:
  - HTTPS is required for non-local homeservers.
  - HTTP is only permitted for local-network/self-hosted homeserver scenarios.

Support and policy:
- Support URL: https://docs.mindroom.chat/support
- Privacy Policy URL: https://docs.mindroom.chat/privacy
- Terms URL (optional): https://docs.mindroom.chat/terms

Reviewer access to include at submission time:
- Homeserver: https://mindroom.chat
- Username: [TEMP_REVIEW_USERNAME]
- Password: [TEMP_REVIEW_PASSWORD]
- Registration token alternative: [ONE_TIME_REGISTRATION_TOKEN_IF_PROVIDED]
- 2FA / extra steps: None
```

## 2) Metadata Completion Checklist

- App Name: `Mindroom AI`
- Subtitle: `Free your AI from app silos`
- Category: `Social Networking` (or your final selected category)
- Promotional Text:

```text
Your AI is trapped in apps. We set it free.
```

- Description:

```text
Mindroom AI is a Matrix client built for AI-agent collaboration.

Use secure threaded chat, voice messages, and media sharing in Matrix rooms while keeping compatibility with existing Matrix accounts and homeservers. The app is optimized for fast edit rendering, thread-heavy workflows, and visibility into AI tool and run activity.

Features:
- Matrix messaging with end-to-end encrypted rooms
- Voice messages and photo/video sharing
- Apple SSO support when offered by your homeserver
- In-app account deactivation entry point
- Open-source client based on Cinny and adapted for MindRoom workflows

Mindroom AI can connect to your chosen Matrix homeserver. Availability of registration, SSO providers, moderation, and retention policies depends on the homeserver you use.
```

- Keywords: `matrix,chat,ai agents,threads,encryption,collaboration`
- Support URL: must be public and live.
- Privacy Policy URL: must be public and live (required).
- Marketing URL: optional.
- Copyright: `2026 Bas Nijholt` (individual account) or your final legal entity name
- Demo account for review: required if using `mindroom.chat`, because self-signup currently requires a registration token.
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

- Verified client-side facts from this repo:
  - no mobile ad SDK is present
  - no mobile analytics/tracking SDK is present
  - the app requests microphone, camera, photo library, photo-library-add, and local-network permissions only for feature use
- Verified service-side facts from `../mindroom` and public docs:
  - MindRoom-operated services can store account details, workspace/configuration data, and interaction logs in some hosted environments
  - `mindroom.chat` is a Matrix homeserver, so account identifiers, room metadata, messages, and media may be processed there to provide the service
- Conservative App Privacy draft for App Store Connect:
  - Tracking: `No`
  - Data Used to Track You: `None`
  - Data Linked to You: `Identifiers` (Matrix account/user ID), `User Content` (messages, media you send), and possibly `Diagnostics` only if you intentionally share them with support
  - Data Not Linked to You: `None`, unless you have a backend practice you can prove is anonymized
  - Purpose: `App Functionality`; add `Customer Support` only for diagnostics/support emails if you want to disclose that path explicitly
- Ensure final App Privacy answers match actual production/server behavior, especially if the hosted MindRoom platform logs interaction events or stores additional account/profile data outside standard Matrix operation.

## 5) Export Compliance

- `ITSAppUsesNonExemptEncryption` is set in the app.
- Complete export compliance questions in App Store Connect consistent with shipped crypto behavior.

## 6) Final Gate

- Run `npm run appstore:preflight`.
- Complete `APP_STORE_COMPLIANCE.md`.
- Archive and upload from Xcode Organizer.
