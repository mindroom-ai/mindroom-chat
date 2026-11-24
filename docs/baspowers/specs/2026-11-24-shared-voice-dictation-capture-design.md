# Shared Voice & Dictation Live Capture and Browser Recovery Design

## Goal

Give streaming dictation the same cross-navigation continuity, browser persistence, crash/reload recovery, discard confirmation, and floating shell indicator that voice message recording already has — by **sharing one unified capture infrastructure** across voice recording and dictation instead of duplicating atoms, locks, IndexedDB code, dialogs, or shell indicators.

## Intended Outcomes & Constraints

- Start dictating in room A, navigate to room B, another thread, Settings, Threads, Usage, phone drawer, or Canvas/side panels: dictation continues uninterrupted with the same live preview, waveform, and timer.
- Pressing **Finish (✓)** or **Send** in any composer delivers the dictated text into **that** composer (insert for ✓; Finish & Send for Send), even if that room itself cannot start a new dictation (the active session retains the server chosen when dictation started).
- When no composer showing the live capture is in sight (Settings, Threads, phone nav drawer, covered by a large dialog), the **shared** floating pill (`LiveCaptureIndicator`) appears in the notice slot (`coverNoticeSlotAtom ?? pageNoticeSlotAtom`) with elapsed time, status, and confirmed Discard.
- Dictation audio (both emitted segment WAVs and in-progress mid-utterance PCM frames, flushed about every 1 second) and already-transcribed segment/refinement text are persisted per account in the **shared** IndexedDB + Web Locks journal (`mindroom-voice-journal`). Reloading, crashing, or updating the app brings the dictation back **paused** (`recovered: true`) in the shared live slot — never auto-starting the microphone and never auto-sending — ready to **Resume**, **Finish (✓)**, **Send**, or **Discard** (confirmed).
- Preserve the hard shell bundle-split boundary: the initial shell chunk (`App.tsx`, `AuthLayout.tsx`, `roomInputDrafts.ts`) and `LiveCaptureIndicator.tsx` import only `jotai` and `import type` session contracts — zero `MediaRecorder`, `AudioWorklet`, Silero VAD, `idb`, or `MatrixClient`.
- Sign-out deletes all persisted voice and dictation journal rows for that account (`sessionCleanup.ts`); account switch releases locks without deleting disk copies so switching back recovers them.

## Architecture

### 1. Shared Capture Core (`src/app/composer/capture/`)

Move and generalize the shared voice capture infrastructure into `src/app/composer/capture/`:

| Module                                            | Role                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `liveCapture.ts`                                  | Single account-wide live capture owner (replaces `voice/liveVoiceRecording.ts` and `roomInputDrafts.ts`'s `activeDictationAtom`). Runtime import: **`jotai` only**; `VoiceCaptureSession` and `DictationSession` are `import type`.                                                                                                                                                                                    |
| `captureJournal.ts`                               | Generalized browser journal (replaces `voice/voiceRecordingJournal.ts`). Same IndexedDB database `'mindroom-voice-journal'` (v1, no migration — untagged rows default to `'voice'`), same `navigator.locks` prefix (`mindroom-voice-recording:${id}`), strict durability transactions, serialized per-id write tail, `ArrayBuffer` storage (WebKit private-mode safe), and `clearCaptureJournal(userId)` for sign-out. |
| `LiveCaptureIndicator.tsx` + `.css.ts`            | Generalized floating pill + capture error modal (replaces `voice/LiveVoiceRecordingIndicator.tsx`), mounted once in `SignedInChrome` (`clientPages.tsx`). Subscribes directly via local `useSyncExternalStore` + `import type` (no runtime import of `useVoiceRecorder.ts`).                                                                                                                                           |
| `DiscardCaptureDialog.tsx`                        | Generalized confirmation modal (replaces `voice/DiscardVoiceRecordingDialog.tsx`), taking `kind: 'voice'                                                                                                                                                                                                                                                                                                               | 'dictation'`and counting against`captureDiscardsInFlightAtom` so reloads wait until IndexedDB deletion completes. |
| `useLiveCaptureCapsuleVisible.ts`                 | Shared visibility hook checking `useConversationOutOfSightAtom()` and `coverNoticeSlotAtom !== null` to ref-count `liveCaptureCapsulesShownAtom`. Used by both `VoiceRecorderDialog` and `DictationCapsule` when rendering the live capture.                                                                                                                                                                           |
| `__tests__/captureOwnership.architecture.test.ts` | Replaces `voiceOwnership.architecture.test.ts`, enforcing the bundle boundary and single factory sites (`startLiveVoiceRecording.ts` and `startLiveDictation.ts`) for both voice and dictation.                                                                                                                                                                                                                        |

#### Live Capture Contract (`liveCapture.ts`)

```ts
export type LiveCapture =
  | { readonly kind: 'voice'; readonly session: VoiceCaptureSession }
  | { readonly kind: 'dictation'; readonly session: DictationSession };

export type LiveCaptureError = {
  readonly kind: 'voice' | 'dictation';
  readonly message: string;
};
```

- `liveCaptureAtom`: single slot making voice recording and dictation structurally mutually exclusive.
- `liveCaptureErrorAtom`, `liveCaptureCapsulesShownAtom`, `captureDiscardsInFlightAtom`: shared across both kinds.
- `beginLiveCapture(store, kind, createSession)`: rejects if occupied, installs synchronously before awaiting `start()`, subscribes for spontaneous return to `idle` -> sets `liveCaptureErrorAtom`.
- `restoreLiveCapture(store, entry)`: installs an already-paused recovered session without calling `start()`, subscribing for `idle`.
- `claimLiveVoice(store, expected?)` / `claimLiveDictation(store, expected?)`: synchronously removes the matching session from `liveCaptureAtom` and tracks it in `claimedCaptures` so `endLiveCapturesOfAccount` still calls `.reset()` on in-flight sends.
- `discardLiveCapture(store, expected?)`: removes matching session and `await`s `session.discard()` (which deletes the journal row before resolving).
- `parkLiveCapture(store)`: calls `live.session.park()`, clearing `liveCaptureAtom` if `phase === 'idle'` synchronously after `park()`. Wired in `App.tsx` (`watchDesktopWindowHidden`) and `AuthLayout.tsx` (Add Account).
- `endLiveCapturesOfAccount(store)`: increments account generation (`captureAccountGuard`), calls `.reset()` on live and claimed sessions (releasing mic and journal locks without deleting disk rows), clears `liveCaptureErrorAtom`. Wired in `forgetComposerStateOfSession`.

### 2. Shared Journal & Dictation Checkpointing (`captureJournal.ts`)

Store both kinds in `'mindroom-voice-journal'` (`recordings` indexed by `userId`, `chunks` keyed by `[id, seq]`):

- **Voice rows**: `{ id, kind?: 'voice', userId, startedAt, mimeType }` + chunks `seq = 0, 1, ...` (`ArrayBuffer`). Fully backward-compatible with v1 rows.
- **Dictation rows**:
  - `recordings` row: `{ id, kind: 'dictation', userId, startedAt, elapsedMs, capReached, originApiUrl?, originRoomId?, segments: PersistedDictationSegment[], groups: PersistedRefinementGroup[] }`.
    - `PersistedDictationSegment`: segment metadata (`index`, `seconds`, `overlapped`, `cutReason`, `leadingQuietFrames`, `trailingQuietFrames`, `pauseBeforeMs`), normalized `status` (`'uploading'` -> `'queued'`), `text?`, `error?`, `retryable`, `hasWav`.
    - `PersistedRefinementGroup`: `startIndex`, `endIndex`, normalized `state` (`'uploading'` -> `'queued'`), `refinedText?`, `refinedEndIndex?`.
  - `chunks` rows:
    - Emitted segment WAVs: `ArrayBuffer` at `seq = segment.index` (`0 .. 999_999`).
    - In-progress mid-utterance 16 kHz Int16 PCM tail chunks: `ArrayBuffer` at `seq = TAIL_SEQ_OFFSET + tailSeq` (`TAIL_SEQ_OFFSET = 1_000_000`), flushed roughly every 1 s (~10 frames = 960 ms) while frames are buffered or awaiting VAD scoring, carrying `elapsedMs` and `startFramePos`/`endFramePos` so partial consumption on hard-cut or unconsumed suffix never drops or duplicates audio.
- **Atomic checkpoint operations** (all serialized through the per-id write tail and guarded by `recordings.getKey(id)` so sign-out cannot be resurrected):
  1. **Append PCM tail**: writes `[id, TAIL_SEQ_OFFSET + seq]` with `Int16Array` buffer, `elapsedMs`, and frame bounds.
  2. **Commit emitted segment**: single strict tx writes `[id, segment.index]` WAV `ArrayBuffer`, deletes consumed tail chunks (retaining/re-writing any unconsumed overlap/suffix tail frames if present), and updates the `recordings` metadata snapshot captured synchronously at call time.
  3. **Commit state update + WAV pruning**: single strict tx updates `recordings` metadata (`segments`, `groups`, `elapsedMs`, `capReached`) and deletes `[id, idx]` for every index returned by `releaseGroupWavs(...)`, optionally clearing all tail chunks on flush/pause.
  4. **Recovery**: loads unlocked `kind === 'dictation'` rows for `userId` (oldest first), holds the Web Lock, reassembles persisted `segments` + WAVs + `groups`, feeds any leftover tail PCM chunks (`seq >= TAIL_SEQ_OFFSET`) through `DictationSegmenter` (`initialSegmentIndex`, `initialActiveFrames`, RMS fallback) + `flush()`, seals open groups, and drops the record only if **both** `segments.length === 0` and no transcribed text exists.

### 3. Dictation Session, Recovery, and Transcriber Binding

- **`dictationSegmenter.ts`**: add `initialSegmentIndex` and `initialActiveFrames` options (so resumed recovered sessions never collide on `segment.index` or reset the 5:00 cap) plus frame-position tracking (`getUnemittedFrameRange` / `consumedThroughPos`) for exact tail pruning across hard cuts.
- **`dictationRefinement.ts`**: `releaseGroupWavs` returns `number[]` of newly pruned segment indices so `dictationSession.ts` deletes the exact corresponding WAV rows in IndexedDB.
- **`dictationSession.ts`**:
  - Implements the full shared session interface: `start()`, `pause()`, `resume()`, `finish()`, `retryFailed()`, `takePartialText()`, `park()`, `reset()`, `discard(): Promise<void>`, `clearError()`, plus `attachClient(client, roomId)` and `hasClient()`.
  - `DictationSnapshot` adds `recovered: boolean` (cleared on `resume()`).
  - `DictationFinishResult` (`completed` / `takePartialText`) returns `{ journalId?: string }` and **does not** delete the journal itself — the caller deletes the journal only after text is safely inserted/persisted (or sends handoff completes).
  - `createRecoveredDictationSession(...)` (or hydration option on `createDictationSession`) starts in `phase: 'paused'` with `recovered: true`, restored `records`, `groups`, `elapsedMs`, `capReached`, and journal handle; pumps queued WAVs once a client is bound.
  - `park()`: if `recording`, stops mic, flushes & seals to journal, stays `paused` with lock held; if initial `requesting` (0 audio), cancels to `idle` and deletes journal; if resume-`requesting`, returns to `paused`; if `paused` / `finishing` / `failed`, leaves state intact.
  - `reset()`: aborts active capture/uploads and calls `journal.release()` (waits for pending write tail, releases Web Lock, preserves disk rows).
  - `discard(): Promise<void>`: aborts active capture/uploads and `await journal.remove()` (deletes disk rows and unlocks).
- **`startLiveDictation.ts`**:
  - Sole production caller of `createDictationSession` (mirrors `startLiveVoiceRecording.ts`).
  - Starts live dictation via `beginLiveCapture(store, 'dictation', ...)` with journal creation (`beginDictationJournal(userId, ...)`).
  - Exports `useRecoverDictation` (deduplicated per account lifetime in `dictationRestoresAtom` and coordinated with `voiceDraftRestoresAtom` so neither start button races recovery). Mounted in `ClientNonUIFeatures` (behind a cheap IDB existence check so the shell only lazy-imports dictation recovery when a dictation record exists) and in `useRoomInputDictation` for standalone tests.
  - **Transcriber binding on recovery**: validates `originApiUrl` against trusted server origins (`resolveComputerApiUrl` + `trustedServerOrigins`), checks `isJoined(mx.getRoom(originRoomId))`, and builds `new DictationClient(clientSessions(mx, validOriginApiUrl))` directly — working even in Settings. Falls back to configured deployment/preference server if `originApiUrl` was unset and allowed. Never silently uploads leftover audio to an untrusted or different room's server; if unavailable, hydrates with `client: undefined` so `previewText` is still immediately insertable or discardable.

### 4. Delivery, Multi-Composer UI, and Shortcuts

- **Every `RoomInput`** (Room, Thread, Fork draft, Home ask field) renders `DictationCapsule` whenever `liveCaptureAtom?.kind === 'dictation'` (unless that specific composer is rendering its own `detachedEntry`). `available`/`confirmed` gates **starting** a new dictation, not displaying, pausing, resuming, finishing, or sending an active one.
- **Finish (✓) mid-navigation**: keeps the session in `liveCaptureAtom` during `finishing` (blocking duplicate clicks), captures `{ sendKey, draftKey, savedSelection, sameAccount }` at click time. On completion: if `sameAccount()` is false, releases journal; if source composer is still mounted (`getMountedOwner`), inserts via `insertDictatedText` + `saveDraft()`; if unmounted, merges **only** into `roomIdToMsgDraftAtomFamily(draftKey)` (preserving any text typed elsewhere) via `mergeDictatedDoc`; **then** calls `deleteCapture(journalId)` and clears `liveCaptureAtom`.
- **Finish & Send (`dictationSendHandoff.ts`)**: synchronously claims the live dictation via `claimLiveDictation(store, expectedSession)`. Keeps the journal locked during transcription and retries. Deletes the journal only once `startSendSession` completes under `sameAccount()` (or `restoreDraftAndCleanup` saves fallback / `insertPartial` inserts). On account switch, `abort()` calls `session.reset()` (not `discard()`), preserving disk recovery for that account.
- **Discard confirmation**: every discard of spoken audio (capsule X, failed recovery bar Discard for both live and detached-failed, shell indicator pill Discard, and `Escape` in focused composer) opens `DiscardCaptureDialog` (`kind="dictation"`). Only initial `requesting` with 0 audio cancels directly.
- **`Mod+Shift+D`**: single-winner resolver (`resolveDictationComposer`, reusing `shown(root)` from `voiceHoldShortcut.ts`): when live dictation is `recording` or `paused`, finishes in focused visible composer -> visible thread composer -> first visible composer (no-op in Settings/Threads where 0 composers are visible); when idle, starts only in focused visible composer with `confirmed === true`.
- **Remove composer-bound auto-pause effects**: remove `conversationHidden` and `ResizeObserver` pause `useEffect`s from `useRoomInputDictation.tsx`.
- **Fix `HOME_ASK_VIEW` visibility**: in `src/app/navigation/conversationView.ts`, `useConversationOutOfSightAtom()` returns `phoneNavDrawerOpenAtom` when `view === HOME_ASK_VIEW` (matching `useConversationHidden()`), so Home's ask field never shows both the inline capsule and the shell floating pill simultaneously.

## Verification & Testing Strategy

- Architecture test (`captureOwnership.architecture.test.ts`): verifies shell bundle boundary (`liveCapture.ts` runtime deps = `['jotai']`, `LiveCaptureIndicator.tsx` pulls no capture engine), single factory sites (`startLiveVoiceRecording.ts`, `startLiveDictation.ts`).
- Journal & checkpoint tests (`captureJournal.test.ts`, `dictationSession.test.ts`): voice v1 backward compatibility, mid-utterance PCM tail persistence & recovery before first VAD pause, atomic cut + tail pruning across hard cuts, locked WAV pruning on `releaseGroupWavs`, text-only recovery with 0 remaining WAVs, `initialSegmentIndex` continuity on Resume, `park()`/`reset()`/`discard()` semantics, sign-out wipe vs account-switch preservation.
- Hook, handoff & shell tests (`useRoomInputDictation.test.tsx`, `dictationSendHandoff.test.tsx`, `LiveCaptureIndicator.test.tsx`, `accountState.test.ts`, `reloadWouldLoseWork.test.ts`): cross-room/thread/Settings navigation, multi-composer `Mod+Shift+D` single-winner, Finish (✓) while navigating away, Finish & Send journal retention until sent, Discard confirmation dialog, reload recovery in Settings and in rooms without a dictation server.
- Full verification gates: `vitest`, `npx vite build`, `just typecheck`, `just lint`, plus before/after Playwright screenshots of dictation continuing across room switch + Settings indicator pill + recovered dictation capsule.
