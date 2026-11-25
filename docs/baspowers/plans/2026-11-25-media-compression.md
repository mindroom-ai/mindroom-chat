# Client-Side Media Compression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with the skill named in **Execution**. Steps use checkbox (`- [ ]`) syntax.

**Execution:** `baspowers:subagent-driven-development` (using `gemini4_neon@xhigh` for implementation and `opus` + `astra` for whole-PR review per `AGENTS.md`).

**Goal:** Compress attached images, screenshots, and videos/screen recordings client-side before encryption and upload across the composer, Home Ask, and Quick Capture, with a configurable quality preset and per-attachment original override.

**Architecture:** Pure Layer 0 compression modules (`src/app/lib/media/compressImage.ts`, `compressVideo.ts`) are dynamically imported only when needed so they add zero bytes to the initial bundle. Layer 1 (`src/app/preferences/mediaCompression.ts`) owns the preset enum and numeric targets, synced as a roaming setting and exposed in Settings -> Chats. Layer 8 (`src/app/composer/useMediaCompression.ts` + `useRoomInputAttachments.tsx`) runs fast image compression inline on stage and slow video compression asynchronously with progress, cancellation, E2EE safety, and a per-card Use original override.

**Tech Stack:** React 19.3, TypeScript 6.0, Vite 8.3 (Rolldown), Jotai 3.0, matrix-js-sdk 45.2, folds UI, `mediabunny` 1.66.4 (MPL-2.0, WebCodecs), Vitest, Playwright.

**Spec:** `docs/baspowers/specs/2026-11-25-media-compression-design.md`

## Global Constraints

- Follow `mindroom-chat/AGENTS.md`: no copyleft code, strict TypeScript (`just typecheck` + `just strict`), type-aware lint (`just lint`), layer rules in `eslint.config.mjs`, no barrel files, no em dashes in docs/comments/commits, add files by explicit path, unsigned commits (`git -c commit.gpgsign=false commit`).
- Every commit includes `--trailer "Assisted-by: MindRoom DevAgent:<model-id> <https://github.com/mindroom-ai/mindroom>"`.
- Both `compressImage.ts` and `compressVideo.ts` (and `mediabunny`) MUST be dynamically imported so they contribute 0 bytes to `$initial` and startup precache.
- No module-level Jotai atoms for compression jobs (keep `src/app/account/__tests__/accountState.test.ts` green).
- Never allow an unencrypted compressing placeholder to upload in an encrypted room, never mutate `SendSession.orderedFiles` after enrollment, and never block an upload when compression fails (graceful fallback to original).
- Soft size target: ~550-750 prod LOC, ~1:1 unit test LOC.

## Review Focus

1. **WebKit silent PNG fallback**: `canvas.toBlob('image/webp')` on Safari/WKWebView can return `image/png` with a huge payload; verify `supportsWebpEncode()` and `blob.type` checks fall back to JPEG (opaque) or PNG (alpha) and reject larger outputs.
2. **Animated PNG / Animated WebP preservation**: a single-frame canvas draw would freeze animations; verify APNG (`acTL` before `IDAT`) and animated WebP (`VP8X` animation bit / `ANIM`) are skipped untouched, including malformed headers.
3. **Odd-dimension macOS screen recordings & microphone audio preservation**: H.264 encoders reject odd width/height and iOS 16.4-18/Linux Chrome often lack `AudioEncoder`; verify even-dimension rounding, AAC/MP3/Opus packet passthrough, and fallback to original if an audio track is discarded.
4. **E2EE & Send-while-compressing safety**: a compressing placeholder has `encInfo: undefined`; verify it cannot auto-upload, cannot be grabbed by voice sends, and pressing Send while compressing waits cleanly then encrypts and sends without dropping the video.
5. **Collapsed board & account switch**: collapsing `UploadBoard` unmounts `UploadCardRenderer`, and switching accounts clears composer state; verify jobs live in `useMediaCompression` (surviving board collapse) and `forgetComposerStateOfSession` aborts active transcodes cleanly.

---

### Task 1: Media Compression Preferences, Roaming, and Settings UI

**Files:**
- Create: `src/app/preferences/mediaCompression.ts`
- Create: `src/app/preferences/mediaCompression.test.ts`
- Modify: `src/app/preferences/settings.ts`
- Modify: `src/app/preferences/roamingSettings.ts`
- Modify: `src/app/preferences/settingsRegistry.ts`
- Modify: `src/app/settings/pages/Chats.tsx`
- Modify: `src/app/i18n/locales/additions/en.json`
- Modify: `src/app/preferences/settings.test.ts`, `src/app/preferences/settings.roaming.test.ts`, `src/app/preferences/settingsRegistry.test.ts` (or `settingsRegistry.pages.test.ts` if assertions check full lists)

**Interfaces:**
- Produces (`src/app/preferences/mediaCompression.ts`):
  - `export const MEDIA_COMPRESSION_PRESETS = ['off', 'balanced', 'small'] as const;`
  - `export type MediaCompressionPreset = (typeof MEDIA_COMPRESSION_PRESETS)[number];`
  - `export const DEFAULT_MEDIA_COMPRESSION: MediaCompressionPreset = 'balanced';`
  - `export const isMediaCompressionPreset = (value: unknown): value is MediaCompressionPreset`
  - `export type ImageCompressionSpec = { maxLongEdge: number; quality: number };`
  - `export type VideoCompressionSpec = { maxLongEdge: number; maxFps: number; videoBitrate: number };`
  - `export const getImageCompressionSpec = (preset: MediaCompressionPreset): ImageCompressionSpec | undefined`
  - `export const getVideoCompressionSpec = (preset: MediaCompressionPreset): VideoCompressionSpec | undefined`
- Produces (`Settings`): `mediaCompression: MediaCompressionPreset` (default `'balanced'`, roaming under `ROAMING_SETTINGS.mediaCompression`).

- [ ] **Step 1: Write failing tests in `src/app/preferences/mediaCompression.test.ts` and extend roaming/settings tests**
  - Assert `DEFAULT_MEDIA_COMPRESSION === 'balanced'`.
  - Assert `isMediaCompressionPreset` accepts `'off' | 'balanced' | 'small'` and rejects unknown strings/numbers.
  - Assert `getImageCompressionSpec`: `'off' -> undefined`, `'balanced' -> { maxLongEdge: 2048, quality: 0.84 }`, `'small' -> { maxLongEdge: 1280, quality: 0.72 }`.
  - Assert `getVideoCompressionSpec`: `'off' -> undefined`, `'balanced' -> { maxLongEdge: 1920, maxFps: 30, videoBitrate: 2_500_000 }`, `'small' -> { maxLongEdge: 1280, maxFps: 30, videoBitrate: 1_200_000 }`.
  - Assert `sanitizeSettings` defaults invalid/missing `mediaCompression` to `'balanced'` and preserves valid presets; assert `readRoamingSettings` accepts valid `mediaCompression` and drops invalid values.
- [ ] **Step 2: Run tests to verify failure**
  - Run: `nix develop --command just test src/app/preferences/mediaCompression.test.ts src/app/preferences/settings.test.ts src/app/preferences/settings.roaming.test.ts`
- [ ] **Step 3: Implement `mediaCompression.ts`, update `settings.ts`, `roamingSettings.ts`, `settingsRegistry.ts`, `Chats.tsx`, and `en.json`**
  - Follow `midTurnModes.ts` + `MidTurnSendTile` (`SettingTile` + `ChoiceButton`) conventions exactly.
  - Add `mediaCompression` entry to `settingsRegistry.ts` under page `chats` with `scope: 'account'` and search keywords covering screenshots, screen recordings, images, videos, compression, size.
- [ ] **Step 4: Verify tests, typecheck, and lint**
  - Run: `nix develop --command just test src/app/preferences/ src/app/settings/` and `nix develop --command just typecheck`
- [ ] **Step 5: Commit**
  - `feat(settings): add media compression preset setting`

---

### Task 2: Image Compression, WebP Thumbnails, and Quick Capture

**Files:**
- Modify: `src/app/lib/dom.ts` (add cached `supportsWebpEncode(): boolean` + reset hook for tests if needed)
- Create: `src/app/lib/media/compressImage.ts`
- Create: `src/app/lib/media/compressImage.test.ts`
- Modify: `src/app/matrix/send/msgContent.ts`
- Modify: `src/app/matrix/send/msgContent.thumbnail.test.ts`
- Modify: `src/app/quick-capture/QuickCaptureHost.tsx`
- Modify: `src/app/quick-capture/sendCapture.ts`
- Modify: `src/app/quick-capture/sendCapture.test.ts`

**Interfaces:**
- Consumes: `ImageCompressionSpec`, `getImageCompressionSpec` from `preferences/mediaCompression.ts`; `loadImageElement`, `supportsWebpEncode` from `lib/dom.ts`; `getFileNameWithoutExt` from `lib/mimeTypes.ts`.
- Produces (`src/app/lib/media/compressImage.ts`):
  - `export type CompressImageOptions = { maxLongEdge: number; quality: number; maxUploadSize?: number };`
  - `export type CompressedImageResult = { file: File; originalSize: number; compressedSize: number };`
  - `export const compressImage = async (file: File, options: CompressImageOptions): Promise<CompressedImageResult | undefined>`
  - Returns `undefined` when skipped (non-raster, SVG/GIF/ICO, APNG, animated WebP, `< 32 KiB` unless over `maxUploadSize`), when decode/encode fails, or when savings guard rejects (`compressedSize >= file.size * 0.95` and does not bring an oversized file under `maxUploadSize`).

- [ ] **Step 1: Write failing tests for `compressImage.ts`, WebP thumbnails in `msgContent.thumbnail.test.ts`, and Quick Capture compression in `sendCapture.test.ts`**
  - Test static PNG/JPEG resize without upscaling, WebP output + `.webp` extension when `supportsWebpEncode()` is true, Safari fallback (`!supportsWebpEncode()`) picking JPEG for opaque and PNG for transparent images, WebKit returning `image/png` blob when asked for WebP, APNG (`acTL` before `IDAT`) and animated WebP (`VP8X` bit 0x02 and `ANIM`) skipped, malformed headers skipped, GIF/SVG/tiny files skipped, 5% savings guard and `maxUploadSize` override, object URL revocation and canvas cleanup on success and error.
  - Test `getImageMsgContent` requests `'image/webp'` thumbnail for WebP images when WebP encoding is supported.
  - Test `sendCapture` compresses images before `createRoomUploadItems` when `mediaCompression !== 'off'` and skips when `'off'`.
- [ ] **Step 2: Run tests to verify failure**
  - Run: `nix develop --command just test src/app/lib/media/compressImage.test.ts src/app/matrix/send/msgContent.thumbnail.test.ts src/app/quick-capture/sendCapture.test.ts`
- [ ] **Step 3: Implement `supportsWebpEncode`, `compressImage.ts`, `msgContent.ts` thumbnail update, and Quick Capture wiring**
  - `sendCapture.ts` dynamically imports `../lib/media/compressImage` only when `options.mediaCompression` yields a spec (`preset !== 'off'`) and `entry.images.length > 0`.
  - Pass `mediaCompression` from `settingsAtom` in `QuickCaptureHost.tsx`.
- [ ] **Step 4: Run tests and typecheck**
  - Run: `nix develop --command just test src/app/lib/media/compressImage.test.ts src/app/matrix/send/msgContent.thumbnail.test.ts src/app/quick-capture/` and `nix develop --command just typecheck`
- [ ] **Step 5: Commit**
  - `feat(media): add client-side image compression and Quick Capture support`

---

### Task 3: Video Compression with Mediabunny (WebCodecs)

**Files:**
- Modify: `package.json`, `package-lock.json`, `NOTICE` (if required by `scripts/third-party-notices.mjs`)
- Create: `src/app/lib/media/compressVideo.ts`
- Create: `src/app/lib/media/compressVideo.test.ts`

**Interfaces:**
- Produces (`src/app/lib/media/compressVideo.ts`):
  - `export type CompressVideoOptions = { maxLongEdge: number; maxFps: number; videoBitrate: number; maxUploadSize?: number; signal?: AbortSignal; onProgress?: (progress: number) => void };`
  - `export type CompressedVideoResult = { file: File; originalSize: number; compressedSize: number };`
  - `export const compressVideo = async (file: File, options: CompressVideoOptions): Promise<CompressedVideoResult | undefined>`
  - Returns `undefined` when skipped (`< 1 MiB` unless over `maxUploadSize`, missing `VideoEncoder`/`VideoDecoder`), aborted, invalid/audio-discarded, over memory cap (`64 MiB`), failed, or failing the 5% / `maxUploadSize` savings guard.

- [ ] **Step 1: Install `mediabunny@1.66.4` and verify `just license-check`**
  - Run: `nix develop --command npm install --save-exact mediabunny@1.66.4 && nix develop --command just license-check`
  - Check whether `scripts/third-party-notices.mjs` / `NOTICE` needs updating (`just script-tests`).
- [ ] **Step 2: Write failing unit tests in `src/app/lib/media/compressVideo.test.ts`**
  - Mock `mediabunny` cleanly (`Input`, `BlobSource`, `Output`, `BufferTarget`, `Mp4OutputFormat`, `Conversion`, `MP4`, `QTFF`, `WEBM`, `MATROSKA`).
  - Test: skips when `VideoEncoder`/`VideoDecoder` absent; skips `< 1 MiB` unless over `maxUploadSize`; computes even dimensions (`Math.max(2, Math.round(dim / 2) * 2)`) for odd-sized screen recordings without upscaling; caps fps at `maxFps` without upscaling lower source fps; keeps MP4-compatible audio (`aac`/`mp3`/`opus`) as passthrough without requesting audio bitrate/transcode; returns `undefined` if `conversion.isValid === false` or an audio track is in `conversion.discardedTracks`; wires `onProgress` (clamped 0..1) and `AbortSignal` -> `conversion.cancel()`; serializes concurrent calls one at a time; applies 5% savings guard + `maxUploadSize` override; updates extension to `.mp4`; disposes `Input` in `finally`; catches errors and returns `undefined`.
- [ ] **Step 3: Run tests to verify failure**
  - Run: `nix develop --command just test src/app/lib/media/compressVideo.test.ts`
- [ ] **Step 4: Implement `src/app/lib/media/compressVideo.ts`**
  - Import only `[MP4, QTFF, WEBM, MATROSKA]` from `mediabunny` (never `ALL_FORMATS`).
  - Enforce serialized queue, even dimensions, audio passthrough + discarded-audio check, `64 MiB` output cap, throttled progress (~100 ms), `AbortSignal` handling, and `input.dispose()` in `finally`.
- [ ] **Step 5: Run tests, license check, and typecheck**
  - Run: `nix develop --command just test src/app/lib/media/compressVideo.test.ts && nix develop --command just license-check && nix develop --command just typecheck`
- [ ] **Step 6: Commit**
  - `feat(media): add WebCodecs video compression with mediabunny`

---

### Task 4: Composer Upload Lifecycle, UploadCardRenderer UI, and Send/Voice/Home Ask Integration

**Files:**
- Modify: `src/app/matrix/state/upload.ts`
- Create: `src/app/composer/useMediaCompression.ts`
- Create: `src/app/composer/useMediaCompression.test.ts`
- Modify: `src/app/composer/roomInputDrafts.ts`
- Modify: `src/app/composer/useRoomInputAttachments.tsx`
- Modify: `src/app/composer/RoomInput.tsx`
- Modify: `src/app/composer/useRoomInputSendSessionController.ts`
- Modify: `src/app/composer/useRoomInputVoice.tsx`
- Modify: `src/app/composer/upload/UploadCard.tsx`
- Modify: `src/app/composer/upload/UploadCardRenderer.tsx`
- Modify: `src/app/composer/upload/UploadBoard.tsx`
- Modify: `src/app/i18n/locales/additions/en.json`
- Modify/add tests: `src/app/composer/upload/UploadCardRenderer.test.ts`, `src/app/composer/useRoomInputAttachments.test.ts`, `src/app/composer/__tests__/RoomInput.test.ts`, `src/app/composer/roomInputDrafts.test.ts`

**Interfaces:**
- Produces (`src/app/matrix/state/upload.ts`):
  - `export type UploadCompression = { status: 'compressing'; progressAtom: Atom<number>; cancel: () => void; done: Promise<TUploadItem | undefined> } | { status: 'compressed'; sourceFile: File; originalSize: number } | { status: 'original' };`
  - `TUploadItem.compression?: UploadCompression`
  - `export const isUploadItemReady = (item: TUploadItem): boolean`
- Produces (`src/app/composer/useMediaCompression.ts`):
  - `export const abortAllMediaCompressions = (): void`
  - `export const useMediaCompression = (...)` returning `{ compressInlineImages, startVideoCompression, useOriginal, waitForCompression }`

- [ ] **Step 1: Write failing unit tests for `useMediaCompression`, `UploadCardRenderer`, `useRoomInputAttachments`, `RoomInput` send-while-compressing, voice exclusion, and `forgetComposerStateOfSession`**
  - Verify compressing placeholder suppresses `unencryptedError` and `tooLargeError`, blocks auto-upload in encrypted rooms, renders progress + `"Compressing..."` + `Use original`, and transitions cleanly to encrypted upload on completion.
  - Verify clicking `Use original` while compressing aborts transcode and stages raw file; clicking `Use original` after compression cancels in-flight upload, encrypts `sourceFile` if needed, and replaces with `status: 'original'`.
  - Verify `Use original` is hidden/disabled once enrolled in an active send session.
  - Verify `UploadCardRenderer` displays `originalSize -> compressedSize` when compressed.
  - Verify `UploadBoardHeader` shows spinner when any staged item is compressing.
  - Verify pressing Send while compressing waits for compression to settle (both normal rooms and Home Ask `deferUpload`/`prepareForSend`) without dropping the video or sending caption ahead of it.
  - Verify voice send ignores compressing placeholders (`isUploadItemReady`).
  - Verify `forgetComposerStateOfSession` calls `abortAllMediaCompressions()` and `accountState.test.ts` passes.
- [ ] **Step 2: Run tests to verify failure**
  - Run: `nix develop --command just test src/app/composer/useMediaCompression.test.ts src/app/composer/upload/UploadCardRenderer.test.ts`
- [ ] **Step 3: Implement Task 4 files cleanly**
  - Keep `compressImage` and `compressVideo` behind dynamic `import('../lib/media/compressImage')` and `import('../lib/media/compressVideo')` inside `useMediaCompression.ts`.
  - Track active `AbortController`s in a plain module-level `Set<AbortController>` (no module-level Jotai atoms).
  - Preserve spoiler/metadata edits made while a video is compressing when replacing the placeholder.
  - Remove stale placeholder key from `roomUploadAtomFamily` on `REPLACE` so raw video `File` handles are not retained.
- [ ] **Step 4: Run composer, account-state, layering, and typecheck tests**
  - Run: `nix develop --command just test src/app/composer/ src/app/account/__tests__/accountState.test.ts src/test/layering.test.ts` and `nix develop --command just typecheck`
- [ ] **Step 5: Commit**
  - `feat(composer): wire client-side media compression into upload flow and cards`

---

### Task 5: Full Verification, Bundle Budget, Playwright E2E, and PR Screenshots

**Files:**
- Modify: `scripts/perf/bundle-budget.json` (only if `just bundle-report` exceeds current headroom; document exact measured delta)
- Create: `e2e/composer/media-compression.spec.ts`

- [ ] **Step 1: Run full local verification suite**
  - `just typecheck`, `just strict`, `just lint`, `just test`, `just license-check`, `just script-tests`, `just build`, `just bundle-report dist --budget scripts/perf/bundle-budget.json`.
  - Verify `mediabunny` and `compressImage` / `compressVideo` are in lazy chunks with 0 bytes in `$initial` and startup precache.
- [ ] **Step 2: Write and run Playwright E2E spec (`e2e/composer/media-compression.spec.ts`)**
  - Test against real Chromium + Tuwunel (`just e2e-slot`):
    1. Settings -> Chats shows the Media compression selector (`Balanced` default) and switching to `Small` / `Off` persists.
    2. Attaching a large synthetic uncompressed PNG screenshot (> 100 KiB, e.g. 2600x1600 noisy/UI canvas PNG) compresses it in real Chromium to a much smaller WebP (`<= 2048 px`), shows the size reduction and `Use original` button on the upload card, and clicking `Use original` swaps back to the original PNG size.
    3. Attaching a real synthetic MP4/WebM video (> 1 MiB) exercises the real browser `mediabunny` WebCodecs pipeline cleanly (compressing or gracefully falling back if software Chromium lacks hardware encoder, without blocking send).
  - Capture clean placeholder-data screenshots of (a) Settings -> Chats with the Media compression setting and (b) the composer upload board showing compressed image size (`original -> compressed`) and the `Use original` action, for PR attachment.
- [ ] **Step 3: Commit E2E spec (and budget update if needed)**
  - `test(e2e): add media compression end-to-end coverage`
