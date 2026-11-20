# A voice recording follows the person through the app

## Problem

A voice recording lives inside the composer that started it. `useVoiceRecorder` creates one
capture session per hook instance and releases it on unmount, so opening a thread, switching
rooms or leaving the page ends the recording. The room it was started in is also bound at start:
Send in another room's composer cannot take it.

The person wants to start recording anywhere, keep recording while moving through rooms, threads
and spaces, and send it wherever they press Send.

## Rule

**The account owns the live recording; the composer whose Send is pressed owns its delivery.**

- A live recording has no destination. It is one capture session held in one jotai atom,
  `liveVoiceRecordingAtom` in `src/app/composer/voice/liveVoiceRecording.ts`.
- The mic button starts it. Only Send, Discard, or account exit ends it. No unmount, navigation
  or layout change ends it.
- Every mounted composer shows the live capsule while it exists, with the same timer, waveform
  and pause state. Pause, resume and Discard act on the shared recording. Mic buttons stay
  disabled.
- Send in a composer claims the recording synchronously, clears the atom, finishes capture and
  sends with that composer's context, read once at Send: room, thread, reply, typed text and
  staged files. A second Send in another composer finds nothing to claim.
- A failed send parks the audio for retry at the attempted destination, as today
  (`pendingVoiceSendDraftAtom`, `voiceComposerKey`). Parked drafts do not follow navigation.
- With no composer on screen (Threads page, settings, the phone's room list), a small floating
  indicator shows "Recording 0:32" (or paused) with Discard. It has no Send, because it has no
  destination. It also shows the capture error dialog, once, for every composer.
- Account exit discards the live recording and releases the microphone.
- A live recording counts as unsaved work for the reload guard.

## What goes away

The start-time destination machinery is deleted, not wrapped:

- `useVoiceRecorder`: per-hook session, `sendBindingAtStartRef`, start-time `getSendContext`,
  the same-room relation refresh, unmount release.
- `useRoomInputVoice`: local `voiceRecorderOpen`, the one-open-recorder token effects,
  `relationContext` in the voice bundle.
- `openVoiceRecorderAtom`: replaced by `liveVoiceRecordingAtom`.
- `VoiceRecorderComposer`: auto-start on `active` and reset on inactive; start is an explicit
  action.
- `RoomView`: the hold that kept the thread beside the room while recording, which existed only
  because the recording died with its composer.
- `voiceCaptureSession.releaseOwner` and `clearError`: account exit uses `discard()`, and a
  capture error leaves the session for `liveVoiceRecordingErrorAtom`, which the indicator shows.

## Boundaries kept

- Capture (`voiceCaptureSession.ts`) imports no React, jotai, matrix-js-sdk or composer module.
  `liveVoiceRecording.ts` imports capture and jotai only: it knows no destination.
  `voiceOwnership.architecture.test.ts` enforces both, and that `createVoiceCaptureSession` is
  called only from `liveVoiceRecording.ts`.
- Delivery stays in `voiceSendDraftController.ts` and `useRoomInputVoice.tsx`, with today's
  live-room checks at send time (membership, encryption, confirmed thread root).
- The Mac native recorder stays behind the capture session, unchanged.

## Known trade-off

Enter in any composer sends the recording there, together with any typed text. That is the
asked-for behaviour; the capsule in that composer is the visible cue.

## Tests

- Unit: the recording survives a composer unmount and remount elsewhere.
- Unit: Send uses the pressing composer's room, thread, reply and bundle.
- Unit: two composers share one session; Send in one clears both; a second Send claims nothing.
- Unit: account exit stops the microphone and clears the atom.
- Unit: a parked retry keeps the attempted destination.
- e2e: record in room A's main view, open a thread in A, go to room B in another space, open a
  thread there, press Send. Exactly one `m.audio` exists, in B's thread; none in A.
