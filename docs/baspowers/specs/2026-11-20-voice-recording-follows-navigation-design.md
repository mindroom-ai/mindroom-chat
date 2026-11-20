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
- **A Send takes the recording at the press.** Pressing Send (the button, Enter or the voice
  key) claims the recording in the same task: it leaves the atom, capture stops, and no more
  audio is recorded. That composer's destination and bundle are taken in that task too: room,
  thread, reply, typed text and staged files. A second Send in another composer finds nothing
  to claim.
- What makes the send wait after the press (a thread root the server has not confirmed) waits
  with that audio and that snapshot. It never reads the composer or the recorder again, so a
  composer that moved on to another thread changes nothing. If the destination becomes
  impossible meanwhile (the root is deleted unsent, the room is left), the audio parks there as
  a failed send; it never moves to another composer.
- A Send pressed without a recording never takes one later: a text Send that waited for its
  thread root goes out as text.
- Text whose pasted files are still being restored cannot go with the press, because the
  restore reads the editor. The press takes the audio alone and parks it; the text and files
  stay in the composer, and Send again sends them together.
- A failed send parks the audio for retry at the attempted destination, as today
  (`pendingVoiceSendDraftAtom`, `voiceComposerKey`). Parked drafts do not follow navigation.
- With no composer in sight (Threads page, settings, the phone's room list), a small indicator
  shows "Recording 0:32" (or paused) with Discard. It has no Send, because it has no
  destination. It shows in the app's notice places (`src/app/ui/noticeSlots.tsx`): the one
  inside the topmost thing that covers the page (a large dialog, a phone's members sheet, its
  drawer), so the keyboard reaches it there, else the page's. It also shows the capture error
  dialog, once, for every composer.
- Discard and account exit release the microphone at once. Account exit also ends any recording
  a Send claimed that is still stopping. A send begun under the account writes nothing after it:
  no capture error, parked recording, send lock or message (`voiceAccountGuard`).
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
- `voiceCaptureSession.releaseOwner`, `clearError` and `discard`: Discard and account exit use
  `reset()`, which releases the microphone at once, and a capture error leaves the session for
  `liveVoiceRecordingErrorAtom`, which the indicator shows.
- The capsule's `processing` state: a recording stops only once a Send claimed it, and that
  shows as sending.

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
- Unit: account exit stops the microphone and clears the atom, also during a capture stop and
  during an upload, where it leaves the next account's parked recording and send lock alone.
- Unit: Send under an unconfirmed thread root takes the recording at the press, and sends it to
  that thread once the root is confirmed, though the composer moved on; with the root deleted
  unsent it fails there. A text Send held for its root takes no recording started since.
- Unit: a parked retry keeps the attempted destination.
- e2e: record in room A's main view, open a thread in A, go to room B in another space, open a
  thread there, press Send. Exactly one `m.audio` exists, in B's thread; none in A.
