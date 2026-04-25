# CINNY-089 Implementation Report

## Summary

Implemented the compact ChatGPT/OpenAI-style voice note UI for recording and playback.

Recording now uses a composer capsule with only discard, live SVG waveform, active timer, pause/resume, and send. Playback now branches voice `m.audio` into a compact capsule with only play/pause, waveform progress/seek, and time. Generic non-voice audio stays on the existing player.

R1 review fixes were committed in `4ddf61cedfea00db9cb002a8aadc21095d65ff90`.
R2 cross-room lifecycle fixes were committed in `be6ca8cb3a949e0e7aa83bf23dd48507084e539f`.
R3 compact voice race fixes were committed in `5cee523b736bd41c1dcc3ce69fb62d7c23542bf1`.

The branch was rebased on 2026-04-25 onto current local `dev` at `87873f1c` (`Hide React Query Devtools by default`). The replayed conflict resolution kept the current MindRoom room-input extension and send-session controller seams, then reapplied compact voice context capture, direct voice auto-send, early pending ownership, keyed cross-room completion, and regular composer/upload-board duplicate guards through those seams.

## Files Changed

- Waveform utilities/UI:
  - `src/app/utils/audioWaveform.ts`
  - `src/app/utils/audioWaveform.test.ts`
  - `src/app/components/voice/VoiceWaveform.tsx`
  - `src/app/components/voice/VoiceWaveform.css.ts`
  - `src/app/components/voice/VoiceWaveform.test.ts`
- Recorder:
  - `src/app/features/room/useVoiceRecorder.ts`
  - `src/app/features/room/useVoiceRecorder.test.ts`
  - `src/app/features/room/VoiceRecordingCapsule.tsx`
  - `src/app/features/room/VoiceRecordingCapsule.css.ts`
  - `src/app/features/room/VoiceRecordingCapsule.test.ts`
  - `src/app/features/room/VoiceRecorderDialog.tsx`
- Send/metadata:
  - `src/app/features/room/RoomInput.tsx`
  - `src/app/features/room/RoomInput.test.ts`
  - `src/app/features/room/msgContent.test.ts`
  - `src/app/state/room/roomInputDrafts.ts`
  - `src/app/utils/voiceMessage.ts`
  - `src/app/utils/voiceMessage.test.ts`
- Playback:
  - `src/app/components/message/content/useAudioContentSource.ts`
  - `src/app/components/message/content/AudioContent.tsx`
  - `src/app/components/message/content/VoiceAudioContent.tsx`
  - `src/app/components/message/content/VoiceAudioContent.css.ts`
  - `src/app/components/message/content/VoiceAudioContent.test.ts`
  - `src/app/components/message/MsgTypeRenderers.tsx`
  - `src/app/components/message/MsgTypeRenderers.audio.test.ts`
  - `src/app/components/message/content/index.ts`
- Test discovery/docs:
  - `vitest.config.ts`
  - `FORK_CHANGES.md`

## Deviations From FINAL-PLAN.md

- Added a tiny shared `useAudioContentSource` hook for the lazy media/decrypt/blob URL path. This avoids duplicating the existing `AudioContent` loading logic while keeping generic audio UI unchanged.
- Added `src/app/components/message/content/AudioContent.test.tsx` to Vitest discovery so the existing generic audio regression test runs in full-suite discovery.
- Did not add decoded waveform peaks or any runtime dependency. Playback uses Matrix waveform metadata first and deterministic fallback rendering second.

## CINNY-052 Preservation

Voice send context is captured when recording starts and stored in `RoomInput`.

Tests cover:
- thread A -> thread B -> send -> thread C upload completion sends to thread A,
- room overview recording stays room-level after opening a thread,
- pause/navigation/resume/send stays on the original thread,
- cross-room navigation still sends to the recording-start room/thread,
- waveform metadata passes through to upload metadata and Matrix voice details,
- deferred voice send does not clear a newer reply draft.

## R1 Review Fixes

- Locked the recording-start voice send context so later mic/open attempts and repeated `onRecordingStart` calls cannot retarget an active recording.
- Guarded the recorder state machine and UI so discard cannot clear a pending Send while MediaRecorder is still in `processing`.
- Made waveform seek on unloaded voice messages load media, retain the pending seek, and apply it before first playback.
- Preserved Matrix `m.audio.duration` when browser media duration is `NaN`, `Infinity`, or otherwise invalid.
- Stopped an acquired mic stream when the `MediaRecorder` constructor throws.
- Gated voice sending strictly on an explicit Send action; unexpected recorder stops now clean up and show an error without sending captured chunks.
- Kept the recorder error dialog mounted in room overview until the user dismisses it.
- Retained active send-session upload files/items so voice sends still complete to the captured room/thread after Send followed by cross-room navigation before upload completion.

## R2 Review Fixes

- Verified the production room provider remounts the room subtree on cross-room navigation with `RoomProvider key={room.roomId}`.
- Moved compact voice auto-send lifetime out of local upload-board rendering after explicit Send:
  - direct voice upload starts from the captured source room context,
  - upload atom progress remains available while the source composer is still mounted,
  - `mx.sendMessage` targets the captured room/thread/reply context after upload completion,
  - source room upload-board items are removed after completion/error even if the source room unmounted.
- Preserved safe pre-Send cross-room behavior: active recordings unmounted before Send are discarded without sending, without upload items, and with recorder cleanup.
- Added a shared pending compact voice-send guard so a second compact voice send is visibly blocked/disabled while the first auto-send is pending.
- Added keyed room-subtree regressions that unmount/remount `RoomInput`, plus recorder coverage for Send followed by unmount before the `MediaRecorder.stop` event.

## R3 Review Fixes

- Moved compact voice auto-send pending ownership to the explicit Send stop request, before the delayed `MediaRecorder.stop` callback constructs the voice file.
- Kept the captured first voice send authorized through keyed room unmount/remount while blocking unrelated room instances from claiming or sending another compact voice note in the pre-stop gap.
- Guarded the regular composer submit and upload-board Send/session path while compact voice auto-send is pending, so the visible auto-send upload item cannot be submitted a second time through the generic send pipeline.
- Added regressions for delayed-stop ownership, cross-room second-send blocking, and regular composer/upload-board duplicate prevention.

## Validation

- Rebase-on-current-dev validation:
  - focused voice suite passed:
    - `npm test -- src/app/utils/audioWaveform.test.ts src/app/components/voice/VoiceWaveform.test.ts src/app/features/room/useVoiceRecorder.test.ts src/app/features/room/VoiceRecordingCapsule.test.ts src/app/features/room/VoiceRecorderDialog.test.ts src/app/features/room/RoomInput.test.ts src/app/features/room/msgContent.test.ts src/app/utils/voiceMessage.test.ts src/app/components/message/content/VoiceAudioContent.test.ts src/app/components/message/MsgTypeRenderers.audio.test.ts src/app/components/message/content/AudioContent.test.tsx`
    - Result: `11/11` files, `59/59` tests passed.
  - `npm run typecheck` passed.
  - `npm run build` passed. Vite emitted the existing runtime-config, dependency sourcemap, and chunk-size warnings.
  - `npm test` passed: `218/218` files, `1757/1757` tests.
  - `npm run lint` passed with warnings only: `35` warnings, `0` errors.
  - `git diff --check dev...HEAD` passed.
- R3 focused voice suite passed:
  - `npm test -- src/app/utils/audioWaveform.test.ts src/app/components/voice/VoiceWaveform.test.ts src/app/features/room/useVoiceRecorder.test.ts src/app/features/room/VoiceRecordingCapsule.test.ts src/app/features/room/VoiceRecorderDialog.test.ts src/app/features/room/RoomInput.test.ts src/app/features/room/msgContent.test.ts src/app/utils/voiceMessage.test.ts src/app/components/message/content/VoiceAudioContent.test.ts src/app/components/message/MsgTypeRenderers.audio.test.ts src/app/components/message/content/AudioContent.test.tsx`
  - Result: `11/11` files, `59/59` tests passed.
- `npm test` passed:
  - Result: `183/183` files, `1590/1590` tests passed.
- `npm run typecheck` passed.
- `npm run build` passed. Vite emitted the existing runtime-config, dependency sourcemap, and chunk-size warnings.
- `npm run lint` passed with warnings only: `71` warnings, `0` errors.
- `git diff --check` passed.

## Live-Test Recommendations / Blockers

- Recommended live checks:
  - desktop and iPhone-width recording active/paused/resumed states,
  - discard from active and paused states sends nothing,
  - send creates a voice message with waveform playback,
  - waveform seek updates playback position,
  - legacy/malformed voice messages render fallback waveform,
  - non-voice audio still renders the generic player,
  - CINNY-052 thread targeting across navigation and upload completion.
- Not completed in this implementation session:
  - real microphone/browser permission testing,
  - iOS Safari/PWA microphone and playback testing,
  - Playwright screenshot evidence.
