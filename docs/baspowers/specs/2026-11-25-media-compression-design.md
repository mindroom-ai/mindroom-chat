# Client-Side Media Compression Design

## Goal

Reduce Matrix homeserver disk usage (and avoid upload and LLM media size limits) by compressing attached photos, screenshots, and videos/screen recordings client-side before encryption and upload.

- Works across Web, macOS Electron, and iOS/Android Capacitor with zero extra confirmation clicks in the normal flow.
- Covers composer attachments (standard rooms, E2EE rooms, Home Ask deferred uploads) and Quick Capture images.
- Configurable quality preset (`Off`, `Balanced` default, `Small`) in **Settings -> Chats**, plus a per-attachment **Use original** override and size/progress feedback on upload cards.
- Graceful fallback: any unsupported format, codec, or compression error silently keeps the original file without blocking the upload.

## Presets and Settings

Create `src/app/preferences/mediaCompression.ts` (Layer 1, same pattern as `midTurnModes.ts` so `settings.ts` and `roamingSettings.ts` share it without circular imports):

- `MEDIA_COMPRESSION_PRESETS = ['off', 'balanced', 'small'] as const`
- `DEFAULT_MEDIA_COMPRESSION: MediaCompressionPreset = 'balanced'`

| Preset               | Images (max long edge / quality) | Videos (max long edge / max fps / target bitrate) |
| :------------------- | :------------------------------- | :------------------------------------------------ |
| `off`                | Unchanged original               | Unchanged original                                |
| `balanced` (default) | 2048 px / 0.84                   | 1920 px (1080p) / 30 fps / 2.5 Mbps H.264 MP4     |
| `small`              | 1280 px / 0.72                   | 1280 px (720p) / 30 fps / 1.2 Mbps H.264 MP4      |

Why `balanced` defaults to 2048 px for images and 1080p for videos:

- 2048 px matches MindRoom backend's image cap (`media_delivery.py`), keeps Retina screenshot text crisp, and shrinks 3-10 MB macOS PNG screenshots by 80-95%.
- 1080p H.264 VBR at 2.5 Mbps target (screen recordings typically settle at 0.5-1.5 Mbps) keeps screen-recorded UI text readable while cutting 40-100 MB Retina `.mov` recordings by 60-90%.
- Small synthetic files in existing unit/E2E tests stay untouched because of the minimum size floors (32 KiB for images, 1 MiB for videos) and the savings guard.

Wiring:

- Add `mediaCompression: MediaCompressionPreset` to `Settings` in `src/app/preferences/settings.ts` with validation in `sanitizeSettings`.
- Add `mediaCompression` to `ROAMING_SETTINGS` in `src/app/preferences/roamingSettings.ts` (`scope: 'account'`) so protecting homeserver disk space follows the user across devices.
- Register the setting in `src/app/preferences/settingsRegistry.ts` on page `chats` with search keywords for screenshots, screen recordings, images, videos, compression, and upload size.
- Render a `SettingTile` + `ChoiceButton` in `src/app/settings/pages/Chats.tsx` in the Editor section (matching `MidTurnSendTile`).

## Image Compression (`src/app/lib/media/compressImage.ts`)

Pure Layer 0 module with zero app imports and zero new npm dependencies, loaded only via dynamic `import()` when `preset !== 'off'` and `file.type.startsWith('image/')`.

1. **Skip rules (return original untouched)**:
   - Explicit image MIME allowlist (`image/png`, `image/jpeg`, `image/webp`, `image/heic`, `image/heif`); all other formats (`image/svg+xml`, `image/gif`, `image/avif`, `image/tiff`, `image/bmp`, `image/x-icon`, `image/heic-sequence`, `image/heif-sequence`, unknown/non-image MIME types) stay untouched.
   - Files smaller than `32 KiB` (unless over `maxUploadSize`).
   - **APNG**: scan PNG chunks (first 64 KiB) until `IDAT`/`IEND`; if an `acTL` chunk appears before `IDAT` (or the header is malformed), skip.
   - **Animated WebP**: inspect the first 64 bytes (`RIFF....WEBP`); if `VP8X` has the animation flag `(byte[20] & 0x02) !== 0` or an `ANIM` chunk is present (or malformed), skip.
   - **HEIC/HEIF**: allow `loadImageElement` to decode natively (works in Safari/WKWebView); if decoding fails (Chrome/Firefox), catch and return original untouched.

2. **Decode, orient, and resize**:
   - Decode with `loadImageElement(URL.createObjectURL(file))` from `src/app/lib/dom.ts` and draw once onto an `HTMLCanvasElement` (`imageSmoothingEnabled = true; imageSmoothingQuality = 'high'`). Using `<img>` -> `<canvas>` respects EXIF orientation reliably across iOS 16.4+, Safari, Electron, Chrome, and Firefox without iOS 16 `createImageBitmap` orientation bugs.
   - Never upscale: `scale = Math.min(1, maxLongEdge / Math.max(width, height))`.
   - Always revoke the object URL and zero canvas dimensions (`canvas.width = 0; canvas.height = 0`) in `finally` to release GPU/WebKit backing memory promptly.

3. **Format choice and WebKit fallback**:
   - Cache a one-time `supportsWebpEncode()` check (`1x1` canvas `toDataURL('image/webp').startsWith('data:image/webp')`) and also verify the produced `blob.type` matches the requested MIME (Safari/WKWebView can silently return `image/png` when asked for WebP).
   - On WebP-capable browsers (Chrome, Electron macOS, Firefox, Android): encode as `image/webp` at the preset quality. WebP handles both opaque and transparent screenshots (including macOS window shadows).
   - On Safari / iOS WKWebView (`!supportsWebpEncode()`): scan alpha pixels on the resized canvas only when the source MIME can carry transparency (`image/png`, `image/webp`), short-circuiting on the first pixel with `alpha < 255`. Encode opaque images as `image/jpeg` at preset quality; encode transparent images as `image/png` (kept only if resizing shrank the file).

4. **Savings guard and filename**:
   - Keep the compressed file only if `blob.size > 0` and either `blob.size < file.size * 0.95` (at least 5% smaller) or `maxUploadSize !== undefined && file.size > maxUploadSize && blob.size <= maxUploadSize`.
   - Replace the file extension using `getFileNameWithoutExt` (`src/app/lib/mimeTypes.ts`) to match the actual output MIME (`.webp`, `.jpg`, `.png`) and preserve `file.lastModified`.

5. **Thumbnail alignment (`src/app/matrix/send/msgContent.ts`)**:
   - In `getImageMsgContent`, encode thumbnails for `image/webp` attachments as `image/webp` when `supportsWebpEncode()` is true (instead of `image/png`), avoiding oversized PNG thumbnails alongside compressed WebP images.

## Video Compression (`src/app/lib/media/compressVideo.ts`)

Pure Layer 0 module loaded only via dynamic `import()` when `preset !== 'off'` and `file.type.startsWith('video/')`.

1. **Dependency**:
   - Add `mediabunny` (`1.66.4`, MPL-2.0 unmodified, zero runtime deps, permitted by `scripts/license-check.mjs`).
   - Import only `[MP4, QTFF, WEBM, MATROSKA]` plus `Input`, `BlobSource`, `Output`, `BufferTarget`, `Mp4OutputFormat`, `Conversion` (never `ALL_FORMATS`) so the lazy video chunk stays compact and initial bundle impact is 0 bytes.

2. **Skip and concurrency**:
   - Skip if `typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined'` or if `file.size < 1 MiB` (unless over `maxUploadSize`).
   - Run at most one video transcode at a time via a simple serialized promise queue so multi-file drops do not exhaust GPU/WebKit memory.

3. **Transcode recipe**:
   - Stream input via `BlobSource(file)` (avoids loading the full raw `.mov` into JS memory).
   - Target `Mp4OutputFormat({ fastStart: false })` into `BufferTarget()` with H.264 (`avc`) video for universal playback across Matrix clients, Safari, iOS, Electron, Chrome, and MindRoom backend; `fastStart: false` streams incremental writes so the live 64 MiB cap can abort early without duration pre-flight estimates.
   - Compute scaled dimensions without upscaling, preserving display aspect ratio and rotation metadata, and round both width and height to **even integers** (`Math.max(2, Math.round(dim / 2) * 2)`) because macOS region/window screen recordings frequently have odd pixel dimensions that H.264 encoders reject.
   - Cap frame rate at 30 fps only when the source exceeds 30 fps (never upscale lower frame rates).
   - **Audio passthrough**: if an audio track is already MP4-compatible (`aac`, `mp3`, `opus`), copy packets untouched without invoking `AudioEncoder`. This is critical because iOS 16.4-18.x WKWebView and Linux Chrome often lack `AudioEncoder`, while macOS/iOS screen recordings carry AAC audio or no audio. Transcode incompatible audio only if supported.
   - Check both `conversion.isValid` and `conversion.discardedTracks`: if the input had an audio track that was discarded (not preserved), abort and keep the original so microphone audio is never silently stripped.
   - Guard against memory spikes: abort/fallback if the output buffer grows beyond a safe cap (64 MiB or the source file size, whichever is smaller when source is under `maxUploadSize`).
   - Wire `conversion.onProgress` (throttled to ~10 Hz) and `AbortSignal` -> `conversion.cancel()`. Dispose `Input` in `finally`.
   - Apply the same savings guard (at least 5% smaller, or brings an oversized file under `maxUploadSize`), update extension to `.mp4` (`video/mp4`), and preserve `file.lastModified`. Any failure logs a warning and returns `undefined` (caller uses original).

4. **Native iOS Swift plugin (out of scope for v1)**:
   - macOS desktop runs Electron (Chromium + VideoToolbox WebCodecs), so it uses the `mediabunny` path natively.
   - On iOS Capacitor, passing 50-100 MB videos across the JSON/base64 plugin bridge is worse in RAM and latency than `mediabunny`'s `BlobSource` streaming inside WKWebView (iOS 16.4+ ships hardware H.264 WebCodecs, and audio passthrough avoids the missing `AudioEncoder`). Revisit a native `AVAssetExportSession` + native file-picker pipeline only if real iPhone testing shows unacceptable fallback rates on HDR `.mov` recordings.

## Upload Lifecycle, UI, and Quick Capture

### Data Model (`src/app/matrix/state/upload.ts`)

Keep `item.originalFile` as the effective plaintext file to send (compressed when ready) and `item.file` as the upload payload (`originalFile` or encrypted blob). Add one optional field on `TUploadItem`:

```ts
export type UploadCompression =
  | {
      status: 'compressing';
      progressAtom: Atom<number>;
      cancel: () => void;
      done: Promise<TUploadItem | undefined>;
    }
  | {
      status: 'compressed';
      sourceFile: File;
      originalSize: number;
    }
  | { status: 'original' };
```

Export `isUploadItemReady = (item: TUploadItem): boolean => !item.prepError && item.compression?.status !== 'compressing'`.

### Composer Flow (`src/app/composer/useMediaCompression.ts` + `useRoomInputAttachments.tsx`)

- **Images (fast, ~40-150 ms)**: compress inline inside `stageFiles` (concurrency 2) before `createRoomUploadItems`, including when `deferUpload` is true (Home Ask). If shrank, attach `compression: { status: 'compressed', sourceFile: rawFile, originalSize: rawFile.size }`.
- **Videos (slow, 2-10+ s)**: immediately stage a placeholder `TUploadItem` with `compression: { status: 'compressing', progressAtom, cancel, done }` and run transcoding in `useMediaCompression` inside `useRoomInputAttachments` (never inside `UploadCardRenderer`, because collapsing `UploadBoard` unmounts cards). When transcoding completes:
  - Locate the live item in `store.get(targetAtom)` (if removed or session switched, discard the result).
  - Encrypt with `createRoomUploadItems([effectiveFile], room, () => liveItem.metadata)` when `!deferUpload`, preserving any spoiler toggle set during compression.
  - Replace the placeholder in `targetAtom` (`type: 'REPLACE'`), preserving draft ownership, and remove the old placeholder key from `roomUploadAtomFamily`.
- **Use original override**:
  - Available on `UploadCardRenderer` while `status === 'compressing'` (aborts compression and immediately prepares/uploads `rawFile` with `compression: { status: 'original' }`) or while `status === 'compressed'` and the item is not enrolled in an active send session (cancels any in-flight upload of the compressed blob, prepares `sourceFile`, and replaces the item with `compression: { status: 'original' }`).
  - Hidden/disabled once enrolled in a send session so `SendSession.orderedFiles` identity is never mutated mid-send.
- **Upload card & board UI (`UploadCardRenderer.tsx`, `UploadBoard.tsx`)**:
  - While `status === 'compressing'`: suppress premature `unencryptedError` and `tooLargeError`, skip auto-upload, pass a defense-in-depth `blockUploadError` to `useBindUploadAtom`, render `"Compressing..."` + progress bar (`useAtomValue(progressAtom)`), **Use original** chip, and Cancel (`x`).
  - `UploadBoardHeader` counts compressing items alongside loading uploads so its spinner stays active when the board is collapsed.
  - When `status === 'compressed'`: display `originalSize -> compressedSize` (e.g. `4.8 MB -> 290 KB`) and a **Use original** button next to the spoiler toggle.
- **Send, voice, and session-switch safety**:
  - `RoomInput.submit` awaits any compressing staged items before enrolling them in `startSendSession`, preserving editor snapshot/reset/fallback ordering.
  - `prepareForSend` awaits compressing items before encrypting/returning ready items (covering Home Ask and dictation handoff).
  - `useRoomInputSendSessionController` and `useRoomInputVoice` filter staged items with `isUploadItemReady` so unencrypted compressing placeholders are never enrolled or grabbed as voice companions.
  - `useMediaCompression.ts` tracks active `AbortController`s in a plain module-level `Set` (not a Jotai atom, keeping `accountState.test.ts` green) and exports `abortAllMediaCompressions()`, called from `forgetComposerStateOfSession`.

### Quick Capture (`src/app/quick-capture/QuickCaptureHost.tsx` + `sendCapture.ts`)

- Leave `electron/native/helper.swift` writing lossless PNGs (so `off` stays lossless).
- Pass `mediaCompression` from `settingsAtom` in `QuickCaptureHost.tsx` through `CaptureSendOptions` into `sendCapture.ts:prepareImages`, compressing `entry.images` via `compressImage` before `createRoomUploadItems`.

## Placement, Bundle Budget, and Verification

- **Layers (`eslint.config.mjs`)**: no new domain needed (`preferences` L1, `lib/media` L0, `matrix/send` L3, `composer` L8, `quick-capture` L10, `settings` L13).
- **Bundle budget**: both `compressImage.ts` and `compressVideo.ts` (+ `mediabunny`) are dynamically imported (0 bytes in `$initial`). Verify with `just build && just bundle-report dist --budget scripts/perf/bundle-budget.json`; bump `scripts/perf/bundle-budget.json` only if the small settings/UI/i18n wiring exceeds the remaining ~1 KiB headroom, documenting the measured delta.
- **Third-party notices & licenses**: run `just license-check` and update notices if required by `scripts/third-party-notices.mjs`.
- **Tests**:
  - Unit tests beside each new/changed module: image compression (resize, WebP vs Safari JPEG/alpha fallback, APNG/animated WebP/GIF/SVG skip, size-regression & `maxUploadSize` override, extension update), video compression (mocked `mediabunny`, even dimensions, fps cap, audio passthrough vs discarded-track fallback, cancellation, error fallback), settings/roaming validation, `msgContent` WebP thumbnail, `UploadCardRenderer` compressing + size delta + Use original, send-while-compressing, voice companion exclusion, account-switch abort, and Quick Capture compression.
  - Full checks: `just typecheck`, `just strict`, `just lint`, `just test`, `just license-check`, `just build`, `just bundle-report`, plus Playwright E2E verifying real browser Canvas image compression, real browser WebCodecs video compression, settings UI, and PR screenshots.
