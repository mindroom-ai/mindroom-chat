# Shared Voice & Dictation Live Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with the skill named in **Execution**. Steps use checkbox (`- [ ]`) syntax.

**Execution:** baspowers:subagent-driven-development — this spans 4 coupled architectural layers (shared live owner + shell UI, shared IndexedDB journal + dictation checkpointing, dictation session/recovery + composer integration, and multi-composer/handoff/cleanup wiring) where fresh subagent execution + full-diff dual review prevents drift across layers.

**Goal:** Unify account-wide live audio capture, browser IndexedDB journaling/recovery, discard confirmation, and floating shell indicator across voice recording and dictation so dictation survives switching rooms, threads, Settings, and page reloads via shared code.

**Architecture:** Extract shared live capture ownership (`liveCapture.ts`), IndexedDB + Web Locks journaling (`captureJournal.ts`), floating pill (`LiveCaptureIndicator.tsx`), discard confirmation (`DiscardCaptureDialog.tsx`), and visibility counting (`useLiveCaptureCapsuleVisible.ts`) into `src/app/composer/capture/`. Hydrate recovered dictations directly into `liveCaptureAtom` as paused `DictationSession`s (`recovered: true`) while preserving the strict shell bundle-split boundary and `mindroom-voice-journal` v1 IndexedDB compatibility.

**Tech Stack:** TypeScript, React 19, Jotai, Slate, IndexedDB (`idb`), Web Locks API (`navigator.locks`), vanilla-extract, Vitest, Playwright.

**Spec:** `docs/baspowers/specs/2026-11-24-shared-voice-dictation-capture-design.md`

## Global Constraints

- `src/app/composer/capture/liveCapture.ts` must import **only `jotai` at runtime**; `VoiceCaptureSession` and `DictationSession` must be `import type` only (no React, Matrix SDK, Slate, AudioWorklet, Silero VAD, or `idb`).
- `src/app/composer/capture/LiveCaptureIndicator.tsx` must NOT import `useVoiceRecorder.ts` or any capture engine at runtime (use local `useSyncExternalStore` + `import type`).
- Keep IndexedDB database `'mindroom-voice-journal'` at version 1 and lock prefix `'mindroom-voice-recording:'`; untagged legacy rows default to `kind: 'voice'`; store `ArrayBuffer` (never `Blob`) in IndexedDB for WebKit private-mode safety.
- Never delete a dictation journal entry until its text is safely inserted/persisted into a draft, accepted/completed by `startSendSession`, explicitly confirmed discarded, or wiped on sign-out.
- Never silently send recovered dictation audio to a different/untrusted room server; validate `originApiUrl` against trusted origins.
- Preserve all existing voice recording behaviors, architecture guards, and `accountState.test.ts` invariants; never leave `activeDictationAtom` behind.
- Every commit includes `--trailer "Assisted-by: MindRoom <display name>:<model id> <https://github.com/mindroom-ai/mindroom>"`.

## Review Focus

1. **Crash mid-utterance before first VAD segment (and across hard cuts):** raw PCM frames buffered before VAD scores or splits must flush every ~1 s to IndexedDB and recover cleanly without losing speech or duplicating hard-cut overlap frames.
2. **Text-only recovery after locked WAV pruning:** when `releaseGroupWavs` deletes locked WAV chunks from IndexedDB, a recovered dictation with `completed` text and 0 remaining WAV rows must still recover (not be deleted as empty).
3. **Switching rooms mid-Finish (✓) or during Finish & Send:** navigating away while finishing must deliver text into the originating `draftKey` (never the newly opened room), and `abort()` on account switch must call `session.reset()` (preserving disk copy), never `session.discard()`.
4. **Multi-composer races (`Mod+Shift+D`, two Send/Finish presses, `HOME_ASK_VIEW` visibility):** single-winner resolver + synchronous `claimLiveDictation(store, expected)` prevents double insertion/send; `HOME_ASK_VIEW` must not falsely report out-of-sight and duplicate the floating pill.
5. **Reloading in Settings or a room without a dictation server:** signed-in shell recovery surfaces the recovered dictation pill/capsule immediately, lets already-transcribed text finish/insert offline, and binds the validated origin `DictationClient` without leaking tokens to untrusted URLs.

---

### Task 1: Shared Capture Core (`src/app/composer/capture/`) & Voice Wiring

**Files:**
- Create: `src/app/composer/capture/liveCapture.ts`
- Create: `src/app/composer/capture/captureJournal.ts`
- Create: `src/app/composer/capture/useLiveCaptureCapsuleVisible.ts`
- Create: `src/app/composer/capture/DiscardCaptureDialog.tsx`
- Create: `src/app/composer/capture/LiveCaptureIndicator.tsx`
- Create: `src/app/composer/capture/LiveCaptureIndicator.css.ts`
- Create: `src/app/composer/capture/__tests__/captureOwnership.architecture.test.ts`
- Modify: `src/app/navigation/conversationView.ts` (fix `HOME_ASK_VIEW` in `useConversationOutOfSightAtom`)
- Modify: `src/app/composer/voice/startLiveVoiceRecording.ts`, `useVoiceRecorder.ts`, `VoiceRecorderDialog.tsx`, `savedVoiceDraft.ts`, `voiceSendDraftController.ts`
- Modify: `src/app/composer/useRoomInputVoice.tsx`, `src/app/composer/roomInputDrafts.ts`
- Modify: `src/app/shell/App.tsx`, `src/app/shell/clientPages.tsx`, `src/app/account/auth/AuthLayout.tsx`, `src/app/account/lifecycle/sessionCleanup.ts`, `src/app/room/RoomViewHeader.tsx`
- Modify: `src/app/i18n/locales/additions/en.json` (add dictation indicator/discard/recovered keys)
- Remove (replaced by `capture/`): `src/app/composer/voice/liveVoiceRecording.ts`, `voiceRecordingJournal.ts`, `LiveVoiceRecordingIndicator.tsx`, `LiveVoiceRecordingIndicator.css.ts`, `DiscardVoiceRecordingDialog.tsx`, `__tests__/voiceOwnership.architecture.test.ts`
- Test: `src/app/composer/capture/captureJournal.test.ts`, `src/app/composer/capture/LiveCaptureIndicator.test.tsx`, `src/app/composer/capture/__tests__/captureOwnership.architecture.test.ts`, `src/app/shell/accountState.test.ts`

**Interfaces:**
- Produces in `src/app/composer/capture/liveCapture.ts`:
  - `LiveCapture`, `LiveCaptureError`, `liveCaptureAtom`, `liveCaptureErrorAtom`, `liveCaptureCapsulesShownAtom`, `captureDiscardsInFlightAtom`
  - `beginLiveCapture(store, kind, createSession)`, `restoreLiveCapture(store, entry)`, `claimLiveVoice(store, expected?)`, `claimLiveDictation(store, expected?)`, `clearLiveCapture(store, expected)`, `discardLiveCapture(store, expected?)`, `parkLiveCapture(store)`, `endLiveCapturesOfAccount(store)`, `captureAccountGuard(store)`
- Produces in `src/app/composer/capture/captureJournal.ts`:
  - Existing voice functions (`beginVoiceRecording`, `recoverVoiceRecording`, `holdVoiceRecording`, `releaseVoiceRecording`, `deleteVoiceRecording`, `clearCaptureJournal`) PLUS shared primitives for dictation (`beginDictationJournal`, `recoverDictationJournal`, `hasDictationJournalRecord`, `deleteCapture`, `releaseCapture`) using `'mindroom-voice-journal'` v1 + `TAIL_SEQ_OFFSET = 1_000_000`.
- Produces in `src/app/composer/capture/useLiveCaptureCapsuleVisible.ts`:
  - `useLiveCaptureCapsuleVisible(showingLive: boolean): void`
- Produces in `src/app/composer/capture/DiscardCaptureDialog.tsx`:
  - `DiscardCaptureDialog({ kind, open, onCancel, onDiscard })`

- [ ] **Step 1: Implement `src/app/composer/capture/` shared modules and migrate voice callers + shell wiring**
  - Move and generalize `liveVoiceRecording.ts` -> `liveCapture.ts` (strictly `jotai` + `import type`), `voiceRecordingJournal.ts` -> `captureJournal.ts` (supporting both `'voice'` and `'dictation'` records + tail PCM chunks + atomic commit/prune), `DiscardVoiceRecordingDialog.tsx` -> `DiscardCaptureDialog.tsx`, `LiveVoiceRecordingIndicator.tsx` -> `LiveCaptureIndicator.tsx` (with local `useSyncExternalStore` + `import type`, supporting voice + dictation labels/states), and extract `useLiveCaptureCapsuleVisible.ts`.
  - Fix `useConversationOutOfSightAtom()` in `src/app/navigation/conversationView.ts` to return `phoneNavDrawerOpenAtom` when `view === HOME_ASK_VIEW`.
  - Update all voice & shell imports (`App.tsx`, `clientPages.tsx`, `AuthLayout.tsx`, `sessionCleanup.ts`, `RoomViewHeader.tsx`, `roomInputDrafts.ts`, `useRoomInputVoice.tsx`, `voice/*`, `accountState.test.ts`, `reloadWouldLoseWork.test.ts`) and add the new locale keys in `en.json` (plus check locale tests).
- [ ] **Step 2: Write/update tests for `captureJournal.ts`, `LiveCaptureIndicator.tsx`, `captureOwnership.architecture.test.ts`, and voice suite**
  - Pin v1 voice backward compatibility, dictation journal write/prune/tail/clear/lock semantics, indicator pill for both voice & dictation states, and shell bundle boundary.
- [ ] **Step 3: Run targeted tests and commit Task 1**
  - Run `npx vitest run src/app/composer/capture src/app/composer/voice src/app/composer/useRoomInputVoice*.test.tsx src/app/shell/accountState.test.ts src/app/composer/roomInputDrafts.test.ts` and verify all pass.
  - Commit with `Assisted-by` trailer.

---

### Task 2: Dictation Checkpointing, Recovery Hydration & Session Lifecycle

**Files:**
- Modify: `src/app/composer/dictation/dictationSegmenter.ts`
- Modify: `src/app/composer/dictation/dictationRefinement.ts`
- Modify: `src/app/composer/dictation/dictationSession.ts`
- Create: `src/app/composer/dictation/startLiveDictation.ts`
- Test: `src/app/composer/dictation/dictationSegmenter.test.ts`, `dictationRefinement.test.ts`, `dictationSession.test.ts`, `startLiveDictation.test.ts`

**Interfaces:**
- Consumes: `liveCapture.ts` (`beginLiveCapture`, `restoreLiveCapture`, `liveCaptureAtom`, `captureAccountGuard`), `captureJournal.ts` (`beginDictationJournal`, `recoverDictationJournal`, `hasDictationJournalRecord`, `deleteCapture`, `releaseCapture`).
- Produces in `dictationSession.ts`:
  - Extended `DictationSnapshot` (`recovered: boolean`, `hasClient: boolean`)
  - Extended `DictationFinishResult` (`{ status: 'completed'; text: string; journalId?: string }`, etc.)
  - Extended `DictationSession` (`park(): void`, `reset(): void`, `discard(): Promise<void>`, `takePartialText(): { text: string; journalId?: string }`, `attachClient(client, roomId): void`, `hasClient(): boolean`, `getJournalId(): string | undefined`)
  - `createDictationSession` supporting optional `journal` and `recovered` initial state.
- Produces in `startLiveDictation.ts`:
  - `startLiveDictation(store, opts)` (sole production caller of `createDictationSession`)
  - `dictationRestoresAtom`, `useRecoverDictation(mx, enabled?)` (hydrating recovered dictation directly into `liveCaptureAtom` with validated `originApiUrl` / `originRoomId` or lazy client attachment).

- [ ] **Step 1: Add segmenter continuity (`initialSegmentIndex`, `initialActiveFrames`, unemitted frame-position tracking) and `releaseGroupWavs` pruned-indices return**
  - Update `dictationSegmenter.ts` and `dictationRefinement.ts` with focused unit tests for hard-cut tail preservation, `initialSegmentIndex`, and returned pruned indices.
- [ ] **Step 2: Add journal checkpointing, recovery hydration, `park()`, `reset()`, async `discard()`, and `attachClient()` to `dictationSession.ts`**
  - Flush raw 16 kHz Int16 PCM tail frames roughly every 1 s (~10 frames) while frames are buffered/unscored; commit emitted WAV + prune consumed tail + metadata snapshot atomically; prune locked WAVs in the same checkpoint tx as `releaseGroupWavs`; return `journalId` from `finish()` and `takePartialText()` without deleting it.
  - Ensure `park()` pauses & checkpoints active recording (leaves `paused` with lock held), cancels initial `requesting` with 0 audio (deleting journal), returns resume-`requesting` to `paused`, and does not abort in-flight `finishing`.
  - Ensure `reset()` releases lock without deleting disk rows; `discard()` awaits disk deletion.
- [ ] **Step 3: Implement `startLiveDictation.ts` (live start + account-scoped recovery + validated origin server binding)**
  - Hydrate recovered dictation (including tail PCM flushing via `DictationSegmenter` RMS fallback, keeping text-only records with 0 remaining WAVs, dropping truly empty records) into `liveCaptureAtom` via `restoreLiveCapture`.
  - Validate `originApiUrl` via `resolveComputerApiUrl` + `trustedServerOrigins`; verify `isJoined(mx.getRoom(originRoomId))`; support `client: undefined` fallback when unavailable.
- [ ] **Step 4: Run dictation unit tests and commit Task 2**
  - Run `npx vitest run src/app/composer/dictation/dictationSegmenter.test.ts src/app/composer/dictation/dictationRefinement.test.ts src/app/composer/dictation/dictationSession.test.ts src/app/composer/dictation/startLiveDictation.test.ts`.
  - Commit with `Assisted-by` trailer.

---

### Task 3: Cross-Navigation Composer Hook, Capsule UI, Handoff & Shell Recovery

**Files:**
- Modify: `src/app/composer/dictation/useRoomInputDictation.tsx`
- Modify: `src/app/composer/dictation/DictationCapsule.tsx`
- Modify: `src/app/composer/dictation/dictationSendHandoff.ts`
- Modify: `src/app/composer/RoomInput.tsx`
- Modify: `src/app/composer/roomInputDrafts.ts` (remove `activeDictationAtom`)
- Modify: `src/app/shell/ClientNonUIFeatures.tsx` (mount lazy dictation recovery trigger)
- Test: `src/app/composer/dictation/useRoomInputDictation.test.tsx`, `src/app/composer/dictation/RoomInput.dictation.test.tsx`, `src/app/composer/dictation/dictationSendHandoff.test.tsx`

**Interfaces:**
- Consumes: `liveCapture.ts`, `startLiveDictation.ts`, `useLiveCaptureCapsuleVisible.ts`, `DiscardCaptureDialog.tsx`, `captureJournal.ts` (`deleteCapture`, `releaseCapture`).

- [ ] **Step 1: Refactor `useRoomInputDictation.tsx` to read account-wide `liveCaptureAtom`**
  - Delete per-composer `sessionBoxRef`, `detachedSessionsRef`, unmount-discard effect, `conversationHidden` auto-pause effect, and `ResizeObserver` auto-pause effect.
  - Show `DictationCapsule` whenever `liveCaptureAtom?.kind === 'dictation'` (regardless of current room's `available`/`confirmed`, and in Room, Thread, Fork, and Home ask). Gate only the Mic button / `start()` on `confirmed` + no active capture + restores settled.
  - Attach `DictationClient` via `session.attachClient(...)` if a recovered session lacks a client and the current composer has a trusted matching/fallback server.
  - Wire `Finish (✓)` to keep session in `liveCaptureAtom` during `finishing`, capture `{ sendKey, draftKey, savedSelection, sameAccount }` at click time, deliver into mounted editor or persisted `draftKey` if user navigated away, and `deleteCapture(journalId)` + `clearLiveCapture` ONLY after text is placed/saved.
  - Wire `Discard` (capsule X, failed recovery bar Discard for live and detached-failed, and `Escape` in focused composer) through `DiscardCaptureDialog` (`kind="dictation"`), keeping the dialog mounted while `discarding` even after `liveCaptureAtom` clears. Only initial `requesting` with 0 audio cancels without confirmation.
  - Implement single-winner `Mod+Shift+D` composer resolution (`focused -> thread -> first visible` for finishing; focused + confirmed for starting).
- [ ] **Step 2: Update `DictationCapsule.tsx` and `dictationSendHandoff.ts`**
  - `DictationCapsule.tsx`: call `useLiveCaptureCapsuleVisible(showingLive)` (false for `detachedEntry` / `localNotice`), show `Recovered · {{time}}` when `snapshot.recovered`, disable Resume when `!snapshot.hasClient` (showing helpful status note if needed).
  - `dictationSendHandoff.ts`: use `captureAccountGuard`, keep journal locked during transcription/retries, delete journal only after `startSendSession` succeeds under `sameAccount()` (or `restoreDraftAndCleanup` / `insertPartial` saves draft), and change `abort()` to call `session.reset()` instead of `session.discard()`.
  - `RoomInput.tsx`: pass `draftKey` / `thread` info to `useRoomInputDictation` as needed, drop `conversationHidden` prop from dictation hook, update `detachForSend` to use `claimLiveDictation`.
  - `ClientNonUIFeatures.tsx`: mount lightweight `DictationRecoveryFeature` that checks `hasDictationJournalRecord(userId)` and lazy-imports `startLiveDictation.ts` to hydrate recovered dictation even when landing in Settings/Threads.
- [ ] **Step 3: Update and add comprehensive tests**
  - Update existing tests in `useRoomInputDictation.test.tsx`, `RoomInput.dictation.test.tsx`, `dictationSendHandoff.test.tsx`, `captureOwnership.architecture.test.ts`, `accountState.test.ts`, `reloadWouldLoseWork.test.ts`.
  - Add explicit tests for all 5 Review Focus items.
- [ ] **Step 4: Run full targeted test suite, typecheck, build, and lint; commit Task 3**
  - Run `npx vitest run`, `npx vite build`, `just typecheck`, `NODE_OPTIONS=--max-old-space-size=6144 just lint`.
  - Commit with `Assisted-by` trailer.
