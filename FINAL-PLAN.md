# CINNY-089 Final Implementation Plan: Modern Compact Voice UI

Status: final synthesis plan only. This commit must not modify production source code.

Inputs read before synthesis:
- `FORK_CHANGES.md` Runbook section
- `/home/basnijholt/.mindroom-chat/mindroom_data/agents/openclaw/workspace/skills/mindroom-dev/references/reports/CINNY-089.md`
- `/var/www/cinny-worktrees/cinny-089-modern-voice-ui-plan-codex/PLAN.md`
- `/var/www/cinny-worktrees/cinny-089-modern-voice-ui-plan-codex/PLAN-CRITIQUE-CODEX.md`
- `/var/www/cinny-worktrees/cinny-089-audio-ui-plan-claude/PLAN-B.md`
- `/var/www/cinny-worktrees/cinny-089-audio-ui-plan-claude/PLAN-CRITIQUE-CLAUDE.md`

## 1. Product / UX Contract

CINNY-089 turns audio messages into compact chat-native voice notes. The UI should feel closer to ChatGPT/OpenAI voice notes than to a generic file player.

Recording visible controls:
- Discard recording.
- Pause/resume recording.
- Send recording.
- Live waveform.
- Timer.

Playback visible controls:
- Play/pause.
- Waveform/progress.
- Duration or current time.

Recording capsule:

```text
[discard] [live waveform................] 0:12 [pause/resume] [send]
```

Playback capsule:

```text
[play/pause] [waveform/progress.........] 0:42
```

Required UX behavior:
- Recording UI is a single compact capsule in the composer area, not a large preview panel.
- Pausing freezes active duration accounting and freezes/dims the waveform. Resuming continues the same recorder session.
- Send finalizes the current recording and sends it through the existing voice upload/send path.
- Discard stops capture, cleans up media resources, drops chunks/waveform data, and sends nothing.
- Playback UI is voice-specific and compact. It must not show speed, download, volume, mute, filename/header chrome, or a generic file-player surface in the inline voice UI.
- The playback waveform should show progress and support a simple click/tap seek with no visible range thumb or extra scrubber chrome.
- Generic non-voice `m.audio` attachments stay on the existing audio UI unless a tiny shared extraction is needed.
- iPhone-width layout must keep all required controls visible without overlap.
- Icon-only buttons must have accessible names and visible focus states. Waveform bars are decorative unless used as the seek target, in which case the control wrapper owns the accessible label.

## 2. Current Code Map From Both Planners

Recording and send path:
- `src/app/features/room/RoomInput.tsx`
  - Owns `voiceRecorderOpen`.
  - Opens `VoiceRecorderComposer` from the mic button after pausing active media.
  - Wires `handleVoiceRecording`, `handleVoiceSend`, `createVoiceUploadItems`, `appendUploadItems`, and `startSendSession`.
  - Existing send-session code captures room/thread/reply details for upload completion. Do not move voice sends back to a later effect that reads live route props.
- `src/app/features/room/VoiceRecorderDialog.tsx`
  - Exports `VoiceRecorderComposer`, despite the filename.
  - Owns current `MediaRecorder` lifecycle, permission/error handling, stop processing, draft preview, native preview audio, "Add to uploads", "Record again", "Discard", and send controls.
  - Current phases do not model pause/resume.
  - Current timer is wall-clock based and must be replaced with active-duration accounting for pause.
- `src/app/features/room/voiceRecorderMime.ts`
  - Chooses a supported `MediaRecorder` MIME type and file extension.
  - Keep existing order unless live browser testing proves a MIME compatibility issue.
- `src/app/state/room/roomInputDrafts.ts`
  - `TUploadMetadata.voiceMessage` already supports `duration` and optional `waveform`.
- `src/app/features/room/msgContent.ts`
  - `getAudioMsgContent(...)` already emits `m.audio` and calls voice metadata helpers when `metadata.voiceMessage` exists.
- `src/app/utils/voiceMessage.ts`
  - Parses stable/unstable voice metadata and writes stable/unstable voice audio details.
  - Existing helpers already understand `waveform`; add shared normalization only if needed.
- `src/types/matrix/common.ts`
  - Matrix audio detail types already include `waveform?: number[]`.

Playback path:
- `src/app/components/message/MsgTypeRenderers.tsx`
  - `MAudio(...)` detects voice messages through `isVoiceMessageContent(...)`.
  - Today both voice and non-voice audio render through the generic attachment/player chrome.
  - This is the right branch point for a voice-only compact capsule.
- `src/app/components/RenderMessageContent.tsx`
  - Routes `MsgType.Audio` to `MAudio`. It should need little or no change.
- `src/app/components/message/content/AudioContent.tsx`
  - Generic audio player with lazy download/decrypt/blob URL setup and media hooks.
  - Current UI includes play chip, time, seek range/progress, mute, and volume.
  - Keep this path for non-voice audio.
- `src/app/components/media/MediaControls.tsx`
  - Generic media layout used outside voice playback. Do not bend it into the voice capsule.
- `src/app/components/message/attachment/Attachment.css.ts`
  - Generic attachment chrome is wider/heavier than the requested voice capsule. Avoid using it for inline voice notes.

Existing relevant tests:
- `src/app/features/room/voiceRecorderMime.test.ts`
- `src/app/utils/voiceMessage.test.ts`
- `src/app/features/room/msgContent.test.ts`
- `src/app/features/room/RoomInput.test.ts`
- `src/app/components/message/content/AudioContent.test.tsx`

Planner synthesis:
- Use Codex's simpler structure where it keeps boundaries clean: utility functions, recorder hook, focused tests, voice-specific playback component, generic audio untouched.
- Use Claude's product alignment where it better matches the requested modern waveform capsule: explicit SVG waveform, capsule-first UX, record-time CINNY-052 preservation, iOS/PWA live evidence.
- Reject Codex's send-click target capture. CINNY-052 must remain recording-start capture.

## 3. Exact Implementation Steps

### Step 0: Pre-edit discipline

- Before changing any production source, read each touched file directly in the implementation worktree.
- Keep edits additive and surgical. Do not replace large files wholesale.
- Keep `FORK_CHANGES.md` Runbook updated during implementation, but this plan-only commit intentionally creates only `FINAL-PLAN.md`.
- Validate after each logical step with focused tests, then `typecheck`, `build`, and full tests when feasible.

### Step 1: Waveform utilities

Add:
- `src/app/utils/audioWaveform.ts`
- `src/app/utils/audioWaveform.test.ts`

Responsibilities:
- Export `VOICE_WAVEFORM_BAR_COUNT = 48`.
- Clamp Matrix waveform points to bounded integers, targeting Matrix-compatible `0..1024`.
- Normalize malformed/short/long waveform arrays into exactly 48 bars.
- Resample live amplitude samples into 48 metadata buckets.
- Create deterministic fallback waveform data for legacy messages with no metadata.
- Map analyser RMS levels to Matrix waveform points.

Avoid:
- No new runtime dependency.
- No duplicated clamp/resample logic in recorder and playback.
- No hard requirement on `decodeAudioData` or `OfflineAudioContext` for v1.

### Step 2: Recorder state and live waveform capture

Prefer adding:
- `src/app/features/room/useVoiceRecorder.ts`
- `src/app/features/room/useVoiceRecorder.test.tsx`

The hook should own:
- Phases: `requesting`, `recording`, `paused`, `processing`, `sending`, and terminal cleanup.
- `start`, `pause`, `resume`, `send`, and `discard`.
- `MediaRecorder`, media chunks, stream tracks, event listeners, timers, and cleanup.
- Active-duration accounting that excludes paused time.
- Live waveform sampling using the existing microphone `MediaStream`, `AudioContext`, `MediaStreamAudioSourceNode`, and `AnalyserNode`.
- Bounded sample storage, final downsampling, analyser failure fallback, and audio context cleanup.
- Native `MediaRecorder.pause()` / `resume()` when available.

Pause/resume constraints:
- Do not stop/recreate the recorder to simulate pause.
- Do not re-register the stop listener on pause/resume.
- If pause/resume is unsupported or throws, keep record/send/discard working and disable only the pause/resume action with accessible state.

Live waveform constraints:
- Use SVG bar data, fixed around 48 bars.
- Sample RMS from `AnalyserNode.getByteTimeDomainData(...)` at a bounded cadence, roughly 10-20 Hz.
- Pause freezes and dims the current waveform. Resume continues the same ring/sample buffer.
- If analyser setup fails, still record and send duration-only voice metadata.

### Step 3: Compact recording capsule

Add:
- `src/app/features/room/VoiceRecordingCapsule.tsx`
- `src/app/features/room/VoiceRecordingCapsule.css.ts`

Add or share:
- `src/app/components/voice/VoiceWaveform.tsx`
- `src/app/components/voice/VoiceWaveform.css.ts`

Update:
- `src/app/features/room/VoiceRecorderDialog.tsx`

Implementation shape:
- Keep `VoiceRecorderComposer` as the exported integration component so `RoomInput.tsx` does not need a structural rewrite.
- Replace the current large preview/save/record-again UI with the compact capsule.
- Remove visible native preview audio, "Add to uploads", "Record again", stop chip, and helper text from the normal recording path.
- Keep existing permission/security/device error mapping and dialog behavior unless the hook extraction naturally moves it to a helper.
- Keep cleanup-on-unmount behavior.

Avoid:
- Do not keep a compatibility/legacy preview path if no caller needs it.
- Do not leave hidden send paths that can diverge from the compact path.
- Do not change `voiceRecorderMime.ts` unless browser validation requires it.

### Step 4: CINNY-052 recording-start send safety and metadata pass-through

Update:
- `src/app/features/room/RoomInput.tsx`
- `src/app/features/room/msgContent.ts` only if normalization pass-through needs adjustment.
- `src/app/utils/voiceMessage.ts` only if shared waveform normalization belongs there instead of `audioWaveform.ts`.

Required implementation:
- Add an explicit voice send context ref in `RoomInput.tsx`, for example `{ roomId, threadId, replyDraft }`.
- Set that ref synchronously when the recorder opens or recording starts, before navigation can change props.
- Clear it only after send/discard/close has completed.
- `handleVoiceSend(file, duration, waveform?)` must prefer the recording-start context ref over current live props.
- Start the existing send session immediately after final file creation, still before upload completion.
- Preserve the same-tick selected-file ref behavior that keeps immediate voice sends alive.
- Pass `waveform` through upload metadata so `getAudioMsgContent(...)` writes stable and unstable Matrix voice audio details.

Hard rule:
- The voice send target is captured at recording start, not Send click.
- Do not regress to send-click target capture.
- Upload completion must use the stored send session, never current route props.

### Step 5: Compact voice playback capsule

Add:
- `src/app/components/message/content/VoiceAudioContent.tsx`
- `src/app/components/message/content/VoiceAudioContent.css.ts`
- `src/app/components/message/content/VoiceAudioContent.test.tsx`

Update:
- `src/app/components/message/MsgTypeRenderers.tsx`
- Potentially `src/app/components/RenderMessageContent.tsx` only if the existing call shape requires it.

Implementation shape:
- Branch in `MAudio(...)`:
  - Voice `m.audio`: render compact `VoiceAudioContent`.
  - Non-voice `m.audio`: keep existing `AudioContent` path unchanged.
- Reuse existing media loading/decryption/blob cleanup logic:
  - `mxcUrlToHttp(...)`
  - `downloadMedia(...)`
  - `downloadEncryptedMedia(...)`
  - `decryptFile(...)`
  - `useBlobUrlCleanup(...)`
  - `useMediaPlay(...)`
  - `useMediaPlayTimeCallback(...)`
  - `useMediaSeek(...)` or equivalent minimal seek handling for waveform click/tap.
- If duplication with `AudioContent.tsx` becomes awkward, extract a tiny shared lazy media source hook. Keep that extraction narrow and covered by tests.

Playback waveform v1:
- Use Matrix waveform metadata first when present.
- Normalize/resample metadata to 48 bars.
- If metadata is absent or malformed, render deterministic/flat fallback waveform or simple progress visualization.
- Do not make `decodeAudioData` or `OfflineAudioContext` a hard dependency for v1. Defer decoded peaks unless implementation can keep them tiny, cached by a stable media key, and fail-soft without delaying playback.

Visible controls:
- Play/pause icon button.
- Waveform/progress area, tappable/clickable to seek.
- Duration/current time.

Avoid:
- No speed control.
- No download button.
- No mute or volume.
- No generic attachment header or file-player chrome.
- No redesign of generic non-voice audio.

### Step 6: Styling, responsive behavior, and accessibility

Use existing vanilla-extract `.css.ts` patterns.

Requirements:
- Fixed, stable capsule dimensions with responsive constraints.
- Compact recording capsule near normal composer height.
- Playback capsule `max-width` around a compact voice-note width and `width: min(...)` behavior so message bubbles do not inflate.
- 40px-ish touch targets where Folds icon buttons already support them.
- Theme-token-driven colors only. No hard-coded hex colors.
- Focus-visible outlines for all buttons and the waveform seek surface.
- `aria-label` on every icon-only button.
- `aria-live="polite"` status for recording state and timer, without announcing waveform ticks.
- `prefers-reduced-motion` support that removes ornamental animation while preserving functional timer/waveform state.

## 4. Locked Design Decisions And Rationale

- Hybrid plan: Codex structure plus Claude product/correctness details.
  - Rationale: Codex is cleaner on file boundaries and tests; Claude is correct on CINNY-052 and closer to the waveform capsule product request.
- SVG waveform bars, fixed 48 buckets.
  - Rationale: testable, themeable, cheap, no canvas complexity, no width-dependent metadata shape.
- No new runtime waveform library.
  - Rationale: the needed behavior is small, and large visualization libraries bring bundle weight and extra playback semantics.
- Live waveform from `AudioContext` + `AnalyserNode`.
  - Rationale: gives real speaking feedback during recording without decoding the final file.
- Pause freezes, dims, and resumes the same recording.
  - Rationale: user-visible pause must not risk broken chunks, changed thread target, or multiple recorder sessions.
- Playback waveform uses metadata first, fallback second.
  - Rationale: Matrix voice waveform metadata is already modeled and should be the stable source. Legacy fallback must never block playback.
- Voice playback is voice-specific.
  - Rationale: Bas asked to simplify voice notes, not to redesign arbitrary audio attachments.
- Waveform seek is allowed only through the waveform surface.
  - Rationale: live-test requirements include a seeked state, but visible controls must remain limited.
- No compatibility/legacy recording preview path unless a real caller requires it.
  - Rationale: retaining dead UI paths increases maintenance and risks mismatched send behavior.

## 5. Thread / Send Safety Requirements For CINNY-052

CINNY-052 is non-negotiable.

The invariant:
- A voice recording sends to the room/thread/reply context active when recording starts.
- Navigation before Send must not retarget the voice message.
- Navigation after Send while upload is pending must not retarget the voice message.

Required regression cases:
- Start recording in thread A, navigate to thread B, click Send, navigate to thread C before upload completes. The sent `m.audio` relation targets thread A.
- Start recording in the room overview, open a thread before Send or before upload completion. The sent `m.audio` remains room-level.
- Start recording in thread A, pause, navigate to thread B, resume, Send. The sent `m.audio` still targets thread A.
- Reply-draft capture and clearing continue to use the original send session and must not clear a newer reply draft.

Implementation safety rails:
- Capture `{ roomId, threadId, replyDraft }` at recorder open/start.
- Keep the `MediaRecorder` stop listener tied to that recording session.
- Pause/resume must not recreate the recorder or update the captured target.
- `handleVoiceSend` must use the captured context ref first.
- Upload completion must use the existing stored send session.
- Do not introduce any effect that waits for an upload and then reads live `threadId`.

## 6. Automated Test Plan

Utility tests:
- `audioWaveform.test.ts`
  - Clamp invalid, negative, non-finite, and out-of-range waveform points.
  - Normalize short/long/malformed Matrix metadata to 48 bars.
  - Resample live samples deterministically.
  - Produce deterministic fallback waveform/progress data.
  - Convert analyser levels to Matrix waveform points.

Recorder tests:
- `useVoiceRecorder.test.tsx`
  - Starts mic capture and recorder.
  - Handles insecure context, permission denied, no device, and busy-device errors.
  - Pause/resume call native recorder methods when supported.
  - Duration excludes paused intervals.
  - Pause freezes sampling and resume continues.
  - Send stops recorder, builds file/duration/waveform, and cleans up.
  - Discard stops recorder, drops chunks, and never calls send.
  - Analyser failure still allows duration-only send.
  - Unmount cleanup stops tracks, listeners, timers, RAF, and audio context.
  - Changing callback props after recording starts does not retarget the stop/send path.

Recording capsule tests:
- `VoiceRecordingCapsule.test.tsx`
  - Renders only discard, waveform, timer, pause/resume, and send.
  - Toggles labels/icons between recording and paused states.
  - Send/discard actions call the expected handlers.
  - Requesting/processing/sending disabled states are accessible.
  - Narrow layout keeps controls visible.

Send and metadata tests:
- Extend `RoomInput.test.ts`
  - Thread A to B to C targeting stays thread A.
  - Overview recording stays room-level after thread navigation.
  - Pause/navigation/resume/send stays on recording-start target.
  - Same-tick voice send remains alive until upload is sendable.
  - Waveform metadata passes through from recorder callback to upload metadata.
- Extend `msgContent.test.ts` / `voiceMessage.test.ts`
  - Stable and unstable voice metadata include normalized duration and waveform.
  - Missing waveform remains valid duration-only voice metadata.

Playback tests:
- `VoiceAudioContent.test.tsx`
  - Voice capsule renders play/pause, waveform/progress, and duration/current time.
  - First play lazily loads/decrypts media and then plays.
  - Play/pause state updates correctly.
  - Waveform click/tap seek updates current time through the existing media hook.
  - Matrix waveform metadata renders normalized bars.
  - Missing/malformed waveform renders fallback waveform/progress.
  - No mute, volume, speed, download, filename/header controls appear.
- Renderer branch test
  - Voice `m.audio` uses `VoiceAudioContent`.
  - Non-voice `m.audio` still uses existing `AudioContent`.
- Existing `AudioContent.test.tsx`
  - Confirm non-voice audio behavior is unchanged.

Responsive/layout tests:
- Add component-level narrow-width tests where practical for recording and playback capsules.
- Use Playwright/live screenshots for final visual proof because JSDOM cannot prove real text overlap and waveform sizing.

Validation commands for implementation:
- Run focused Vitest after each step.
- Run `npm run typecheck`.
- Run `npm run build`.
- Run `npm test` before finalizing.
- Run `npm run lint` when feasible and document any repo-baseline failures separately.

## 7. Live-Test Evidence Plan

Capture screenshots or screen recordings under a dedicated evidence directory during implementation, then reference them from the Runbook.

Recording evidence:
- Active recording: compact capsule, waveform moving, timer visible.
- Paused recording: waveform frozen/dimmed, resume visible, timer stopped.
- Resumed recording: waveform/timer continue.
- Discard from active recording: composer returns cleanly, no upload, no message.
- Discard from paused recording: same.
- Send flow: processing/sending state, composer closes, voice message appears.
- Mic permission denied or secure-context error: existing error dialog appears and UI does not get stuck.

Playback evidence:
- Voice playback idle: play button, waveform, duration.
- Playing: pause button, current time/progress tint advances.
- Paused: progress retained and play button visible.
- Seeked: tap/click waveform and show changed progress/current time.
- Ended: returns to play state with complete progress or reset behavior as implemented.
- Legacy voice without waveform metadata: fallback waveform/progress renders and playback works.
- Malformed waveform metadata: sanitized fallback path works.
- Non-voice audio attachment: existing UI unchanged.

Layout/browser evidence:
- iPhone-width layout with no overlap in recording and playback capsules.
- Desktop narrow and normal-width message layout.
- iOS Safari tab if available: mic prompt, pause/resume, send, playback.
- iOS standalone PWA if available: safe-area/composer layout, mic prompt, playback.
- Android Chrome if available.

Thread safety live checks:
- Record in thread A, navigate to thread B, Send, navigate to thread C before upload completes. Verify message lands in thread A.
- Record in overview, open thread, Send or wait for upload. Verify message remains room-level.
- Record, pause, navigate, resume, Send. Verify original target.

## 8. Risks / Fallbacks

- `MediaRecorder.pause()` / `resume()` support varies.
  - Feature-detect. Disable pause/resume gracefully if unsupported. Do not fake pause by stopping and restarting.
- `AudioContext` may fail or be throttled.
  - Recording still works. Send duration-only voice metadata and render fallback waveform.
- iOS Safari/PWA may have MIME and backgrounding quirks.
  - Keep current MIME helper initially. Validate on device before changing MIME preference.
- Duration units can regress.
  - Keep Matrix duration in milliseconds. UI displays formatted seconds/minutes. Tests must lock pause-excluded duration.
- Waveform metadata can be malformed or absent.
  - Sanitize everything. Fallback visualization must never block playback.
- Encrypted media loading duplication can drift from `AudioContent`.
  - Prefer a tiny shared source hook if duplication becomes non-trivial, but keep extraction scoped.
- Hiding download/open inline controls removes a visible affordance for voice messages.
  - This is intentional for the inline UI. Verify message-level context actions still cover normal file operations where available; otherwise document as an accepted v1 tradeoff.
- Long recordings may hit screen sleep or background throttling.
  - Implementation should consider optional `navigator.wakeLock.request('screen')`, fail-soft, and document behavior.
- Upload cancellation on discard after Send is ambiguous.
  - Once Send is clicked, treat it as sending. Discard is only available before send processing starts unless existing upload cancellation is verified and intentionally wired.
- The biggest regression risk is CINNY-052.
  - The implementation must use recording-start capture and tests must fail if a future refactor reads live thread state at Send or upload completion.

## 9. Estimated Scope

Production scope:
- `src/app/utils/audioWaveform.ts`: about 120-180 LOC.
- `src/app/features/room/useVoiceRecorder.ts`: about 220-340 LOC.
- `src/app/features/room/VoiceRecordingCapsule.tsx`: about 120-200 LOC.
- `src/app/features/room/VoiceRecordingCapsule.css.ts`: about 80-140 LOC.
- Shared `VoiceWaveform` component and styles: about 120-220 LOC.
- `src/app/components/message/content/VoiceAudioContent.tsx`: about 180-280 LOC.
- `src/app/components/message/content/VoiceAudioContent.css.ts`: about 80-140 LOC.
- Targeted edits to `VoiceRecorderDialog.tsx`, `RoomInput.tsx`, `MsgTypeRenderers.tsx`, and possibly `msgContent.ts` / `voiceMessage.ts`: about 150-350 touched lines total.

Test scope:
- New and extended focused Vitest coverage across waveform utilities, recorder hook, recording capsule, RoomInput send safety, message content metadata, voice playback, renderer branching, and non-voice audio unchanged behavior.
- Rough estimate: 700-1100 test LOC.

Implementation cadence:
1. Waveform utilities and shared SVG waveform component.
2. Recorder hook with pause/resume, active duration, cleanup, and live waveform sampling.
3. Compact recording capsule and `VoiceRecorderComposer` integration.
4. CINNY-052 explicit recording-start context ref and metadata pass-through tests.
5. Voice-only playback capsule with metadata waveform/fallback/progress/seek.
6. Responsive/accessibility polish and live-test evidence.
7. Independent review, full validation, Runbook update, and focused implementation commits.

Out of scope:
- Playback speed UI.
- Audio trimming/editing.
- Transcription/captions.
- New waveform/runtime dependencies.
- Worker-based peak decoding.
- Generic non-voice audio redesign.
- Folds theme-token additions.
- Large-file rewrites unrelated to the voice UI.
