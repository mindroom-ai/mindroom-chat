# Quick Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with the skill named in **Execution**. Steps use checkbox (`- [ ]`) syntax.

**Execution:** baspowers:subagent-driven-development for Tasks 1 to 9 (the plan is long, and a wrong send posts into real rooms); Tasks 10 to 13 run on the MacBook M2 through a delegated agent there, since they need Xcode and a screen.

**Goal:** A small widget page that posts notes and questions as new threads into a default room, lists that room's threads and shows their answers, and a Mac window for it that floats above other apps behind Option+Space, with screenshots as attachments.

**Architecture:** The widget (`/quick-capture/`) runs no Matrix client. A host mounted in the signed-in app serves it over a `BroadcastChannel`: it pushes the state and runs the widget's requests on the one client. On the Mac the widget page loads in a second Capacitor web view in a second scene, whose window native code floats, shows and hides.

**Tech Stack:** TypeScript, React 18, jotai, folds, vanilla-extract, matrix-js-sdk, vitest, Playwright; Swift, Capacitor 8, Mac Catalyst, ScreenCaptureKit, Carbon hot keys.

**Spec:** `docs/baspowers/specs/2026-11-13-quick-capture-design.md`

## Global Constraints

- Every command runs in `nix develop -c`, from the repository root. `node_modules` is installed.
- Before each commit: `just typecheck`, `just strict`, `just lint`, `just test <the task's test files>` all pass, and `just format <the files you wrote>` was run.
- New code is Lane C: no unused names, no unchecked index access, no floating promises, exhaustive switches.
- Never open or fetch anything outside this repository except library documentation and type definitions in `node_modules`. No new dependencies.
- Styles: vanilla-extract `Name.css.ts` beside `Name.tsx`, folds tokens (`color.*`, `config.space.*`, `config.radii.*`, `toRem`), logical sides only (`paddingInlineStart`, `insetInlineEnd`, no four-part `padding`). `PopOut` and `TooltipProvider` come from `src/app/ui/directional.tsx`; menus and dialogs from `src/app/ui/glass/GlassPrimitives.tsx`. Avoid three consecutive lines of generic style declarations that any stylesheet would have in the same order.
- No barrel files. Tests sit beside their subject; DOM tests start with `// @vitest-environment jsdom`.
- Module-level state uses `atom` from `'jotai'` (the storage factories are banned by lint).
- Visible strings come from `featureUi.quickCapture.*` (Task 7 defines every key). A string a task finds missing is added to English and all 16 other overlays in that task.
- No em dashes in code comments, documents or commit messages.
- Commits: `git -c commit.gpgsign=false commit`, files added by explicit path, on the current branch. Do not push.
- Numbers from the spec: 4 images at most, 30 list rows, resolved rows for 24 hours, 600 characters of reply text, 50 picker rows, hello every 10 s, host counted present for 30 s, absent after 1.5 s, state at most every 250 ms, request timeout 20 s (60 s with images), window 360 by 460 points.

## Review Focus

1. **Text over 40,000 bytes** (a pasted log): it goes out as the composer's long-text sidecar, not as a failed send. Test in Task 3.
2. **The stored default room is gone** (left, archived, replaced): the state carries `roomId: null`, so the picker opens, and a request for that room answers `no-room`. Test in Task 6.
3. **A second Enter while a send is in flight:** one thread, not two. Test in Task 8.
4. **The list reorders under the cursor** (a state push while a row is selected): the selection follows its thread, not its position. Test in Task 8.
5. **Input that is not an entry:** whitespace-only text with no image sends nothing; a pasted file that is not an image, and a fifth image, are not attached. Test in Task 8.

---

### Task 1: Protocol, channel and the domain's layer

**Files:**
- Create: `src/app/quick-capture/captureProtocol.ts`, `src/app/quick-capture/captureChannel.ts`
- Test: `src/app/quick-capture/captureProtocol.test.ts`, `src/app/quick-capture/captureChannel.test.ts`
- Modify: `.eslintrc.cjs` (`LAYERS`: add `'quick-capture'` to the row `['account', 'activity', 'spaces', 'timeline']`), `docs/architecture.md` (the layer table row and one line in the Layout tree: `quick-capture/  the floating note widget's page and its host in the signed-in app`)

**Interfaces:**
- Produces, in `captureProtocol.ts`:

```ts
export const CAPTURE_CHANNEL_NAME = 'mindroom.quickCapture';
export type CaptureChip = 'working' | 'needs-you' | 'new';
export type CaptureRoom = { id: string; name: string; direct: boolean };
export type CaptureItem = {
  threadId: string;
  title: string;
  /** The newest reply on one line; empty for a root nobody answered. */
  line: string;
  lineSender?: string;
  /** The newest reply's plain text, at most 600 characters. */
  replyText?: string;
  chip?: CaptureChip;
  resolved: boolean;
  ts: number;
};
export type CaptureState = {
  userId: string;
  roomId: string | null;
  rooms: CaptureRoom[];
  items: CaptureItem[];
};
export type CaptureErrorCode = 'no-room' | 'upload-failed' | 'send-failed' | 'forbidden' | 'timeout';
export type CaptureAction =
  | { kind: 'send'; roomId: string; text: string; images: File[]; open: boolean }
  | { kind: 'reply'; roomId: string; threadId: string; text: string }
  | { kind: 'resolve'; roomId: string; threadId: string; resolved: boolean }
  | { kind: 'selectRoom'; roomId: string }
  | { kind: 'open'; roomId: string; threadId?: string };
export type CaptureResult = { ok: true; threadId?: string } | { ok: false; error: CaptureErrorCode };
export type CaptureMessage =
  | { v: 1; type: 'hello' }
  | { v: 1; type: 'request'; id: string; hostId: string; action: CaptureAction }
  | { v: 1; type: 'state'; hostId: string; state: CaptureState }
  | { v: 1; type: 'response'; id: string; hostId: string; result: CaptureResult }
  | { v: 1; type: 'gone'; hostId: string };
export const isCaptureMessage: (value: unknown) => value is CaptureMessage;
```

- Produces, in `captureChannel.ts`:

```ts
export type CaptureChannel = {
  post(message: CaptureMessage): void;
  listen(onMessage: (message: CaptureMessage) => void): () => void;
  close(): void;
};
/** The page's channel, or undefined where `BroadcastChannel` is missing. Drops invalid messages. */
export const openCaptureChannel: () => CaptureChannel | undefined;
export type CaptureClientSnapshot = {
  status: 'connecting' | 'connected' | 'absent';
  state?: CaptureState;
};
export type CaptureClient = {
  /** Says hello now and every 10 s. */
  start(): void;
  stop(): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): CaptureClientSnapshot;
  request(action: CaptureAction): Promise<CaptureResult>;
};
export const createCaptureClient: (channel: CaptureChannel) => CaptureClient;
```

- [ ] **Step 1: Write the failing tests.** `captureProtocol.test.ts`: `isCaptureMessage` accepts one sample of each of the five message types and of each action kind; rejects `v: 2`, an unknown `type`, a `request` without `hostId`, a `send` whose `images` holds a string, a `state` whose `items` is not an array, `null` and a string. `captureChannel.test.ts`, with `vi.useFakeTimers()` and an in-memory `CaptureChannel` pair:
  - `start()` posts `hello`; the snapshot is `connecting`, and `absent` 1,500 ms later with no state.
  - a `state` from host `a` makes it `connected` with that state; a later `state` from host `b` is ignored; `subscribe` listeners run on each change and `getSnapshot()` keeps its identity between changes.
  - `hello` repeats every 10,000 ms; `stop()` ends it.
  - `request(action)` posts a `request` with host `a`'s id and a fresh `id`, and resolves with the `result` of the `response` that has that `id`; a response with another `id` or `hostId` does not resolve it.
  - `request` resolves `{ ok: false, error: 'timeout' }` after 20,000 ms, after 60,000 ms for a `send` with images, and at once while not `connected`.
  - `gone` from host `a`, or 30,000 ms without a `state`, makes it `absent` and the next `state` from any host is followed.
- [ ] **Step 2: Run** `just test src/app/quick-capture`. Expected: FAIL, modules not found.
- [ ] **Step 3: Implement both modules.** `isCaptureMessage` checks every field of every variant by hand (no schema library). `openCaptureChannel` wraps `new BroadcastChannel(CAPTURE_CHANNEL_NAME)`. Request ids come from `crypto.randomUUID()`.
- [ ] **Step 4: Add the layer** (`.eslintrc.cjs`, `docs/architecture.md`) and run `just test src/app/quick-capture src/test/layering.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(quick-capture): protocol and channel between the widget and its host`.

### Task 2: The list and the picker's rooms

**Files:**
- Create: `src/app/quick-capture/captureItems.ts`, `src/app/quick-capture/captureRooms.ts`
- Test: `src/app/quick-capture/captureItems.test.ts`, `src/app/quick-capture/captureRooms.test.ts`

**Interfaces:**
- Consumes: `CaptureItem`, `CaptureRoom` (Task 1).
- Produces:

```ts
// captureItems.ts
export const MAX_CAPTURE_ITEMS = 30;
export const RESOLVED_SHOWN_MS = 24 * 60 * 60 * 1000;
export const MAX_REPLY_TEXT = 600;
export type CaptureThread = {
  threadId: string;
  title: string;
  replyText?: string;
  replySender?: string;
  streaming: boolean;
  needsYou: boolean;
  unread: boolean;
  resolved: boolean;
  resolvedTs?: number;
  ts: number;
};
export const buildCaptureItems: (threads: CaptureThread[], now: number) => CaptureItem[];

// captureRooms.ts
export const MAX_CAPTURE_ROOMS = 500;
export const MAX_PICKER_ROWS = 50;
export type CaptureRoomSource = { id: string; name: string; direct: boolean; space: boolean; lastActiveTs: number };
export const buildCaptureRooms: (rooms: CaptureRoomSource[]) => CaptureRoom[];
/** The picker's rows for a query: a case-insensitive match anywhere in the name, at most 50. */
export const filterCaptureRooms: (rooms: CaptureRoom[], query: string) => CaptureRoom[];
```

- [ ] **Step 1: Write the failing tests.**
  - `buildCaptureItems`: unresolved threads come first, newest `ts` first, and only the first 30 of them; resolved threads follow, newest `resolvedTs` first, only those with `now - resolvedTs < RESOLVED_SHOWN_MS` (one at exactly 24 h is left out, one without `resolvedTs` is left out).
  - Duplicated `threadId`s keep the first occurrence.
  - `chip`: `working` when `streaming`, else `needs-you` when `needsYou`, else `new` when `unread`, else absent; a resolved thread has none.
  - `line` is `replyText` with every run of white space as one space; `replyText` is cut to 600 characters without splitting a surrogate pair; no reply gives `line: ''` and no `replyText`; `lineSender` is `replySender`.
  - `buildCaptureRooms`: spaces left out, newest `lastActiveTs` first, at most 500, `direct` kept. `filterCaptureRooms`: `''` gives the first 50; `'re'` matches `Research` and `Core`; no match gives `[]`.
- [ ] **Step 2: Run** `just test src/app/quick-capture/captureItems.test.ts src/app/quick-capture/captureRooms.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(quick-capture): the widget's list and its rooms`.

### Task 3: Send, reply, resolve

**Files:**
- Create: `src/app/quick-capture/sendCapture.ts`
- Test: `src/app/quick-capture/sendCapture.test.ts`

**Interfaces:**
- Consumes: `CaptureErrorCode` (Task 1); `composeTextMessage` (`src/app/composer/composeTextMessage.ts`), `withInlineElements` and `createParagraphElement` (`src/app/editor/utils.ts`), `createRoomUploadItems` (`src/app/matrix/send/roomInputUploadPreparation.ts`), `getImageMsgContent` (`src/app/matrix/send/msgContent.ts`), `getMessageRelation` (`src/app/matrix/send/composeMessageRelation.ts`), `uploadLongTextSidecar` (`src/app/matrix/send/longTextSidecarUpload.ts`), `MAX_EVENT_CONTENT_BYTES` and the long-text helpers of `src/app/matrix/protocol/longText.ts`, `MINDROOM_THREAD_TAGS_EVENT`, `RESOLVED_TAG`, `buildPerTagStateKey`, `buildPerTagEventContent` (`src/app/event-store/threads/threadTags.ts`).
- Produces:

```ts
export type CaptureSendOptions = { markdown: boolean; linkSchemes?: readonly string[] };
export class CaptureError extends Error {
  constructor(readonly code: CaptureErrorCode, cause?: unknown);
}
/** Posts a new thread: text alone, or the first image as its root with the rest and the text in it. */
export const sendCapture: (
  mx: MatrixClient,
  room: Room,
  entry: { text: string; images: File[] },
  options: CaptureSendOptions
) => Promise<{ threadId: string }>;
export const sendCaptureReply: (
  mx: MatrixClient,
  room: Room,
  threadId: string,
  text: string,
  options: CaptureSendOptions
) => Promise<void>;
export const setCaptureResolved: (
  mx: MatrixClient,
  room: Room,
  threadId: string,
  resolved: boolean
) => Promise<void>;
```

- [ ] **Step 1: Write the failing tests** with a fake client (`sendMessage`, `uploadContent`, `sendStateEvent`, `getUserId` as `vi.fn`) and `vi.mock` for `getImageMsgContent` (returns `{ msgtype: 'm.image', body: name, url: mxc }`):
  - text alone: one `sendMessage(roomId, content)` whose content has `msgtype: 'm.text'`, the text as `body`, no `m.relates_to`; resolves the returned `event_id` as `threadId`.
  - `markdown: true` and `**bold**` gives a `formatted_body` with `<strong>`; `markdown: false` gives none.
  - two lines of text keep their line break in `body`.
  - two images and text: both uploads finish before the first `sendMessage`; then the first image with no relation, then the second image and last the text, each with `getMessageRelation(undefined, undefined, rootId)` under `m.relates_to`.
  - images and empty text: the images only.
  - an upload that rejects: `CaptureError` with code `upload-failed`, and `sendMessage` was never called; a `prepError` on an item does the same.
  - an encrypted room (`hasEncryptionStateEvent: () => true`): the uploaded file's type is `application/octet-stream` and `includeFilename` is false.
  - `sendMessage` rejecting gives `send-failed`.
  - text of 50,000 `a`s: the event sent is the result of `uploadLongTextSidecar` (mocked), not the text content.
  - `sendCaptureReply`: one `sendMessage` with the thread relation; empty text sends nothing.
  - `setCaptureResolved(…, true)`: `sendStateEvent(roomId, 'com.mindroom.thread.tags', buildPerTagEventContent(userId), buildPerTagStateKey(threadId, 'resolved'))`; `false` sends `{}` with the same key; a rejection with `errcode: 'M_FORBIDDEN'` gives `forbidden`, any other `send-failed`.
- [ ] **Step 2: Run** `just test src/app/quick-capture/sendCapture.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The text content comes from `composeTextMessage(editor, options.markdown, mx.getUserId() ?? undefined, options.linkSchemes)` on a headless editor (`withInlineElements(createEditor())` with one `createParagraphElement` per line as `children`). Long text follows `sendSessionText` in `src/app/composer/useRoomInputSendSessionController.ts` (the `contentBytes` test and `uploadLongTextSidecar`). Uploads follow `uploadReportFile` in `src/app/bug-reports/sendBugReport.ts` (`mx.uploadContent(item.file, { name, type, includeFilename: !item.encInfo })`).
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(quick-capture): post an entry as a new thread, reply and resolve`.

### Task 4: The default room

**Files:**
- Create: `src/app/preferences/quickCaptureRoom.ts` (not in `quick-capture`: `account` is in the same layer and must clear it at sign-out)
- Test: `src/app/preferences/quickCaptureRoom.test.ts`
- Modify: `src/app/account/lifecycle/sessionCleanup.ts` (`clearUserUiState` calls `clearQuickCaptureRoomStore(userId)`)

**Interfaces:**
- Produces:

```ts
export const getQuickCaptureRoomAtom: (userId: string) => WritableAtom<string | null, [string | null], void>;
export const clearQuickCaptureRoomStore: (userId: string) => void;
```

- [ ] **Step 1: Write the failing test** (jsdom): the atom of `@a:x` starts `null`; set to `!r:x` it reads back, and `localStorage['quickCaptureRoom:@a:x']` holds it; the atom of `@b:x` stays `null`; a stored value that is not a string reads as `null`; `clearQuickCaptureRoomStore('@a:x')` removes the key and a fresh atom reads `null`.
- [ ] **Step 2: Run** `just test src/app/preferences/quickCaptureRoom.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** after `src/app/preferences/recentlyOpenedPanelHeight.ts` and `src/app/threads/page/threadsScope.ts` (`createUserScopedAtomRegistry`, `atomWithLocalStorage`), and call the clear function from `clearUserUiState`.
- [ ] **Step 4: Run** `just test src/app/preferences/quickCaptureRoom.test.ts src/app/shell/accountState.test.ts src/app/account`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(quick-capture): the default room, kept per account`.

### Task 5: The native plugin's TypeScript side

**Files:**
- Create: `src/app/native/nativeQuickCapture.ts`
- Test: `src/app/native/nativeQuickCapture.test.ts`

**Interfaces:**
- Produces (the Swift side in Task 12 implements exactly this plugin):

```ts
/** Plugin `MindRoomQuickCapture`: hide(), showMainWindow(), openScreenRecordingSettings(),
 *  captureScreenshot({ target }) resolving { path, name }; rejections carry `code`. */
export type ScreenshotTarget = 'window' | 'screen';
export type ScreenshotErrorCode = 'PERMISSION_DENIED' | 'NO_WINDOW' | 'UNSUPPORTED' | 'CAPTURE_FAILED';
export class ScreenshotError extends Error {
  constructor(readonly code: ScreenshotErrorCode);
}
export const isNativeQuickCaptureAvailable: () => boolean;
export const hideQuickCapture: () => Promise<void>;
export const showMainWindow: () => Promise<void>;
export const openScreenRecordingSettings: () => Promise<void>;
/** The capture as a PNG `File` named by the native side. */
export const captureScreenshot: (target: ScreenshotTarget) => Promise<File>;
```

- [ ] **Step 1: Write the failing test**, mocking `@capacitor/core` as `src/app/diagnostics/nativeDiagnostics.test.ts` does: available only when `isNativePlatform()`, `getPlatform() === 'ios'` and `isPluginAvailable('MindRoomQuickCapture')`; each function calls its plugin method once; `captureScreenshot('window')` calls `captureScreenshot({ target: 'window' })`, fetches `Capacitor.convertFileSrc(path)` (stub `fetch`) and resolves a `File` with the native `name` and type `image/png`; a rejection with `code: 'PERMISSION_DENIED'` becomes `ScreenshotError` with that code, an unknown code becomes `CAPTURE_FAILED`; the three void functions resolve without calling anything when the plugin is not available, and `captureScreenshot` rejects `UNSUPPORTED`.
- [ ] **Step 2: Run** `just test src/app/native/nativeQuickCapture.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** after `src/app/native/nativeFileSave.ts` (lazy `registerPlugin`).
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(native): the quick capture plugin's web side`.

### Task 6: The host

**Files:**
- Create: `src/app/quick-capture/captureThreads.ts`, `src/app/quick-capture/QuickCaptureHost.tsx`
- Test: `src/app/quick-capture/captureThreads.test.ts`, `src/app/quick-capture/QuickCaptureHost.test.tsx`
- Modify: `src/app/shell/ClientNonUIFeatures.tsx` (render `<QuickCaptureHost />` last, and name it in the doc comment)

**Interfaces:**
- Consumes: Tasks 1 to 4 (`getQuickCaptureRoomAtom` from `src/app/preferences/quickCaptureRoom.ts`); nothing from `account`, `activity`, `spaces` or `timeline`, which share this domain's layer; `crossRoomThreadIndexAtom` (`src/app/threads/cross-room/crossRoomThreadIndex.ts`), `getThreadSignalsReader` (`threadSignalsReader.ts`), `threadTitleText`, `threadPreviewText`, `threadActorName`, `threadIndexReplyPreview` (`threadText.ts`), `isZeroReplyStandaloneThreadRootEvent` and `getCompactThreadRootPreviewInfo` (`src/app/event-store/threads/compactThreadRootData.ts`), `navigationRoomsAtom` (`src/app/matrix/state/archivedRooms.ts`), `mDirectAtom`, `roomToUnreadAtom`, `useRoomNavigate` (`src/app/navigation/useRoomNavigate.ts`), `useRoomViewMode`'s reader for one room, `useSetting(settingsAtom, 'isMarkdown')`, `useOptionalClientConfig`.
- Produces:

```ts
// captureThreads.ts
/** The room's threads for the widget: the index's entries of the room and, from the room's live
 *  timeline, the roots nobody answered that the index does not hold. */
export const readCaptureThreads: (
  mx: MatrixClient,
  room: Room,
  entries: Iterable<CrossRoomThreadIndexEntry>,
  t: TFunction,
  now: number
) => CaptureThread[];

// QuickCaptureHost.tsx
export function QuickCaptureHost(props: { channel?: CaptureChannel }): null;
```

- [ ] **Step 1: Write the failing tests.**
  - `captureThreads.test.ts` (light fakes for `Room` and entries): only entries whose `roomId` is the room's; `title` from `threadTitleText`; `streaming` from `threadRecord.status.isStreaming`; `needsYou` when the signals hold `pendingApproval` or `pendingQuestion`; `unread` from `isUnread`; `resolved` and `resolvedTs` from the entry; `ts` is `lastActivityTs`; `replyText` is the body of the event `signals.lastReply.eventId` when it is a text message, else the preview's text, and `replySender` is `threadActorName` of its sender; a text message in the live timeline that passes `isZeroReplyStandaloneThreadRootEvent` and is no entry's root becomes a thread with its body as title, no reply, and its `getTs()`; one that is an entry's root is not doubled.
  - `QuickCaptureHost.test.tsx` (jsdom, fake channel pair, jotai `Provider`, `vi.mock` of `useMatrixClient`, `useRoomNavigate`, `sendCapture`, `sendCaptureReply`, `setCaptureResolved`):
    - `hello` gets a `state` with the user's id, the rooms, `roomId` and the items of the stored room.
    - no stored room, and a stored room that `mx.getRoom` does not return, both give `roomId: null` and no items.
    - a `request` with another `hostId` is ignored: nothing is called and nothing posted.
    - `selectRoom` stores the room and posts a fresh `state`.
    - `send` calls `sendCapture(mx, room, { text, images }, { markdown, linkSchemes })` and posts the `response` with its `threadId`; with `open: true` it then calls `navigateRoomThreadDirect(roomId, threadId)`.
    - `send` for a room `mx.getRoom` does not return answers `{ ok: false, error: 'no-room' }`; a thrown `CaptureError('upload-failed')` answers that code; any other throw answers `send-failed`.
    - `reply` and `resolve` call their functions; `open` navigates (`navigateRoom(roomId, threadId)` when the room's view mode is `classic`, as `src/app/sidebar/threads/ThreadNavItem.tsx` does).
    - an index change within 30,000 ms of a `hello` posts a `state`, at most one per 250 ms; after 30,000 ms without `hello` it posts none.
    - unmounting posts `gone`.
    - with `openCaptureChannel` returning `undefined` and no `channel` prop, it renders and does nothing.
- [ ] **Step 2: Run** `just test src/app/quick-capture`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** The host's id is `crypto.randomUUID()`. It also listens to the selected room's `RoomEvent.Timeline` and `RoomEvent.LocalEchoUpdated`, since a root nobody answered is not in the index. Mount it in `ClientNonUIFeatures`.
- [ ] **Step 4: Run** `just test src/app/quick-capture src/app/shell`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(quick-capture): the host that serves the widget from the signed-in app`.

### Task 7: Strings

**Files:**
- Modify: `src/app/i18n/locales/additions/en.json` and the 16 other files of `src/app/i18n/locales/additions/`

**Interfaces:**
- Produces: the keys under `featureUi.quickCapture`, with this English text:

| Key | English |
|---|---|
| `title` | Quick Capture |
| `input.placeholder` | Note or question |
| `input.label` | New entry |
| `input.send` | Send |
| `input.sending` | Sending |
| `attach.window` | Screenshot of the front window |
| `attach.screen` | Screenshot of the whole screen |
| `attach.remove` | Remove {{name}} |
| `room.choose` | Choose a room |
| `room.change` | Posting to {{room}}. Change room |
| `room.search` | Search rooms |
| `room.none` | No rooms match |
| `list.label` | Threads in {{room}} |
| `list.empty` | Nothing open here |
| `list.sent` | Sent |
| `list.resolved` | Resolved |
| `chip.working` | working |
| `chip.needsYou` | needs you |
| `chip.new` | new |
| `peek.copy` | Copy |
| `peek.copied` | Copied |
| `peek.open` | Open |
| `peek.done` | Done |
| `peek.reopen` | Reopen |
| `peek.reply` | Reply in this thread |
| `hint.send` | send |
| `hint.sendOpen` | send and open |
| `hint.room` | room |
| `hint.list` | list |
| `hint.move` | move |
| `hint.peek` | peek |
| `hint.done` | done |
| `hint.reply` | reply |
| `hint.open` | open |
| `absent.title` | MindRoom is not open |
| `absent.open` | Open MindRoom |
| `signedOut.title` | Sign in to MindRoom |
| `error.noRoom` | This room is no longer available |
| `error.uploadFailed` | The image could not be uploaded |
| `error.sendFailed` | Not sent |
| `error.forbidden` | You cannot resolve threads in this room |
| `error.timeout` | MindRoom did not answer |
| `screenshot.denied` | MindRoom needs the Screen Recording permission to take screenshots |
| `screenshot.openSettings` | Open System Settings |
| `screenshot.noWindow` | The app in front has no window |
| `screenshot.failed` | The screenshot failed |

- [ ] **Step 1: Add the English keys**, then translate each into the 16 other overlays (same keys, same `{{name}}` and `{{room}}` placeholders, "MindRoom", "Quick Capture" as the product's feature name translated as the file's other feature names are).
- [ ] **Step 2: Run** `just test src/app/i18n`. Expected: PASS.
- [ ] **Step 3: Commit** `feat(quick-capture): strings`.

### Task 8: The widget page

**Files:**
- Create: `src/app/quick-capture/captureKeys.ts`, `CaptureInput.tsx`, `CaptureList.tsx`, `CaptureRoomPicker.tsx`, `QuickCapturePage.tsx`, `QuickCapturePage.css.ts` (all in `src/app/quick-capture/`)
- Test: `captureKeys.test.ts`, `QuickCapturePage.test.tsx` beside them; `src/app/shell/Router.quickCapture.test.tsx`
- Modify: `src/app/routes/paths.ts` (`export const QUICK_CAPTURE_PATH = '/quick-capture/';`), `src/app/shell/Router.tsx` (a route beside `CONNECT_PATH`, outside `ProtectedRoutes` and `AuthLayout`, lazy like the other pages)

**Interfaces:**
- Consumes: Tasks 1, 2 (`filterCaptureRooms`), 5 and 7; `useActiveSession` (`src/app/matrix/session/useSessionStore.ts`); `isMacOS` (`src/app/lib/user-agent.ts`).
- Produces:

```ts
// captureKeys.ts
export type CaptureZone = 'input' | 'list' | 'reply' | 'picker';
export type CaptureKeyAction =
  | { kind: 'send'; open: boolean }
  | { kind: 'toList' }
  | { kind: 'toInput'; text?: string }
  | { kind: 'move'; by: 1 | -1 }
  | { kind: 'peek' }
  | { kind: 'resolve' }
  | { kind: 'reply' }
  | { kind: 'copy' }
  | { kind: 'open' }
  | { kind: 'pick' }
  | { kind: 'picker' }
  | { kind: 'escape' }
  | { kind: 'screenshot'; target: 'window' | 'screen' };
export const captureKeyAction: (
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
  context: { zone: CaptureZone; inputEmpty: boolean; caretOnLastLine: boolean; firstRow: boolean; apple: boolean }
) => CaptureKeyAction | undefined;

// QuickCapturePage.tsx
export function QuickCapturePage(props: { channel?: CaptureChannel }): JSX.Element;
```

- Keys (`mod` is `metaKey` when `apple`, else `ctrlKey`):

| Zone | Key | Action |
|---|---|---|
| input | `Enter` | `send`, `open: false` |
| input | `mod+Enter` | `send`, `open: true` |
| input | `Shift+Enter` | none (a new line) |
| input | `Tab` while `inputEmpty` | `picker` |
| input | `ArrowDown` while `caretOnLastLine` | `toList` |
| input | `mod+Shift+A`, `mod+Shift+S` | `screenshot` `window`, `screen` |
| list | `ArrowDown`, `j` / `ArrowUp`, `k` | `move` 1 / -1; `ArrowUp` or `k` on `firstRow` is `toInput` |
| list | `Space` `x` `r` `c` `Enter` `n` | `peek` `resolve` `reply` `copy` `open` `toInput` |
| list | any other single character without `mod` or `alt` | `toInput` with that `text` |
| reply | `Enter` | `send`, `open: false` |
| picker | `ArrowDown` / `ArrowUp`, `Enter` | `move`, `pick` |
| every zone | `Escape` | `escape` |

- [ ] **Step 1: Write the failing tests.**
  - `captureKeys.test.ts`: every row of the table, for `apple` true and false; `Enter` with `altKey` gives none; `mod+j` in the list gives none.
  - `Router.quickCapture.test.tsx`, after `src/app/shell/Router.connect.test.tsx`: `/quick-capture/` renders the page with no stored session and never renders `ClientRoot`.
  - `QuickCapturePage.test.tsx` (jsdom, a fake channel pair acting as the host, `vi.mock` of `nativeQuickCapture` and `useActiveSession`):
    - no host answer in 1,500 ms and no session: "Sign in to MindRoom"; with a session: "MindRoom is not open" and its button calls `showMainWindow`.
    - a state with `roomId: null` shows the picker; typing filters; `Enter` posts `selectRoom` with the first row.
    - a state with a room shows its name in the header, the input focused, and the items with their titles, lines (`Sender: text`, "Sent" for an empty line) and chips.
    - `Enter` with text posts `send` with the room, the text, `open: false`; on `{ ok: true }` the input empties and keeps the focus; on `{ ok: false, error: 'send-failed' }` the text stays and "Not sent" shows.
    - a second `Enter` before the response posts nothing more.
    - white space alone posts nothing.
    - `mod+Enter` posts `open: true`, and after `{ ok: true }` calls `showMainWindow` and `hideQuickCapture`.
    - pasting two image files shows two chips and `send` carries both; a pasted PDF adds none; a fifth image adds none; a chip's remove button drops it.
    - with `isNativeQuickCaptureAvailable` true the two screenshot buttons show, and a click adds the `File` `captureScreenshot` resolves; `PERMISSION_DENIED` shows the permission text and a button that calls `openScreenRecordingSettings`; without the plugin the buttons are absent.
    - `ArrowDown` from the input selects the first row; `Space` shows its `replyText` and the Copy, Open and Done buttons; `x` posts `resolve` with `resolved: true` (`false` on a resolved row); `Enter` posts `open` and then calls `showMainWindow` and `hideQuickCapture`; `r` focuses the reply field and `Enter` there posts `reply`.
    - with the second row selected, a new state that puts that thread first keeps it selected.
    - `Escape` closes the peek, then calls `hideQuickCapture`; with the picker open it closes the picker first.
    - a window `focus` event focuses the input.
- [ ] **Step 2: Run** `just test src/app/quick-capture src/app/shell/Router.quickCapture.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** The page creates its client from `props.channel ?? openCaptureChannel()` and reads it with `useSyncExternalStore`. The page fills its window (no outer card): header with the room button, the attachment chips, the input with the two screenshot buttons, the list or the picker, and a footer of key hints for the zone that has the focus (`ShortcutKeys` from `src/app/shortcuts/ShortcutKeys.tsx` if it fits a key that is not in the registry, else a `<kbd>` styled the same). The header is the window's drag area on the Mac: `WebkitAppRegion` does nothing in a WKWebView, so leave the header free of handlers that swallow `mousedown`; Task 11 makes the window movable by its background. The selected row is tracked by `threadId`. The page sets `document.title` to the `title` string.
- [ ] **Step 4: Run** `just test src/app/quick-capture src/app/shell`, then `just typecheck`, `just strict`, `just lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(quick-capture): the widget page`.

### Task 9: End-to-end

**Files:**
- Create: `e2e/quick-capture/quick-capture.spec.ts`

**Interfaces:**
- Consumes: `disposableHomeserverIsUp`, `registerDisposableUser` (`e2e/helpers/disposableAccounts.ts`), `createPrivateRoom` (`e2e/helpers/matrix.ts`), `loginWithPassword` (`e2e/helpers/auth.ts`); a second page from `page.context().newPage()` as in `e2e/shell/startup-frames.spec.ts`.

- [ ] **Step 1: Write the spec.** One user, two rooms ("Inbox", "Other"), the app page signed in, a second page at `/quick-capture/`:
  - the picker shows both rooms; picking "Inbox" shows its name in the header, and after a reload of the widget page it is still the room.
  - an entry "Buy oat milk" sent with `Enter` appears as a row in the widget and as a message in "Inbox" on the app page.
  - a pasted PNG with the text "What is this?" gives a thread in "Inbox" whose root is the image and whose reply is the text (read with the helpers' Matrix API calls).
  - `x` on the row marks it resolved in the widget, and the room's `com.mindroom.thread.tags` state holds the tag.
  - `Control+Enter` on a new entry makes the app page's URL carry `threadId=`.
- [ ] **Step 2: Run** `just hs-up`, then `just e2e e2e/quick-capture/quick-capture.spec.ts`. Expected: PASS. Fix the product code, not the spec, when the product is wrong.
- [ ] **Step 3: Commit** `test(quick-capture): the widget against a signed-in app`.

---

Tasks 10 to 13 run on the MacBook M2 (Xcode, a checkout of this branch). Build and run the Debug Mac app with: `npm ci`, `npm run build:ios`, `npx cap sync ios`, then `xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug -destination 'platform=macOS,variant=Mac Catalyst' build` (signed with the machine's development identity, or `CODE_SIGNING_ALLOWED=NO` if the entitlements allow the app to start unsigned), and open the built `MindRoom.chat.app`.

### Task 10: Spike (throwaway, not committed)

- [ ] **Step 1:** In a scratch branch, with the fewest lines that answer each question, check the three facts of the spec's "To settle on the Mac first": a `BroadcastChannel` message between two `CAPBridgeViewController` web views; a second scene's window raised to the floating level, shown over Safari and given the keyboard through runtime-reached AppKit while the main window stays behind, plus a Carbon hot key (`RegisterEventHotKey`, key code 49, modifier `optionKey`) firing while another app is in front; ScreenCaptureKit (`SCShareableContent`, `SCScreenshotManager`) building and capturing from the Catalyst target, and `UIApplicationSupportsMultipleScenes` honored as the string of a build setting.
- [ ] **Step 2:** Report each as works or does not, with the fallback of the spec taken where it does not, and amend the spec's Architecture section to what holds (commit `docs: quick capture, what the Mac spike settled`).

### Task 11: The Mac shell

**Files:**
- Create: `ios/App/App/QuickCaptureSceneDelegate.swift`, `ios/App/App/MacWindowing.swift`
- Modify: `ios/App/App/AppDelegate.swift`, `ios/App/App/SceneDelegate.swift`, `ios/App/App/MindRoomBridgeViewController.swift` (`routeRoots` gains `quick-capture`, `threads` and `activity`), `ios/App/App/Info.plist`, `ios/App/App.xcodeproj/project.pbxproj` (the new files in all four places; `MINDROOM_SUPPORTS_MULTIPLE_SCENES`)
- Test: `src/app/native/iosSceneLifecycle.test.ts`, `src/app/native/macCatalystShell.test.ts`, `ios/Tests/AssetRoutingTests.swift`, `ios/Tests/RoomRouteReloadTests.swift`

**Interfaces:**
- Produces: the scene configuration `Quick Capture` (delegate `QuickCaptureSceneDelegate`), requested with an `NSUserActivity` of type `chat.mindroom.quick-capture`; `QuickCaptureViewController`, a `MindRoomBridgeViewController` subclass that starts at `/quick-capture/`; and in `MacWindowing.swift`, inside `#if targetEnvironment(macCatalyst)`:

```swift
enum MacWindowing {
    /** Registers Option+Space once; the handler toggles the widget. */
    static func installHotKey(_ toggle: @escaping () -> Void)
    /** Floating level, no title bar or buttons, movable by its background, every Space,
        360 by 460, frame remembered as "MindRoomQuickCapture". */
    static func styleWidgetWindow(of scene: UIWindowScene)
    static func showWidget()
    static func hideWidget()
    static var widgetIsKey: Bool { get }
    static func showMainWindow()
    /** The process id of the app that was in front before MindRoom, for the window screenshot. */
    static var lastFrontProcess: pid_t? { get }
}
```

- [ ] **Step 1: Extend the TypeScript contract tests first** (they read the native sources): the manifest's `UIApplicationSupportsMultipleScenes` is `$(MINDROOM_SUPPORTS_MULTIPLE_SCENES)`, the setting is `YES` only for `sdk=macosx*` in both configurations, there are two scene configurations and the first is still `Default Configuration`; `MacWindowing.swift` and `QuickCaptureSceneDelegate.swift` compile their AppKit and Carbon use only inside `#if targetEnvironment(macCatalyst)`; `routeRoots` holds `quick-capture`. Run `just test src/app/native`. Expected: FAIL.
- [ ] **Step 2: Implement.** `AppDelegate`: the configuration by activity type; `buildMenu(with:)` removes `.newScene` and adds "Quick Capture" (Option+Space) to the Window menu; at launch, `installHotKey`. The toggle: no widget scene yet, request one; widget key, hide; else show. `SceneDelegate`: a second main scene asks for its own destruction. A widget scene restored at launch starts hidden.
- [ ] **Step 3: Run** `just test src/app/native` (PASS), build, and check by hand: Option+Space over Safari shows the widget with the caret in the input, the main window stays behind, again hides it, it sits above a full-screen app, its place survives a relaunch, there is no "New Window".
- [ ] **Step 4: Commit** `feat(mac): a floating window for Quick Capture behind Option+Space`.

### Task 12: The plugin and the screenshots

**Files:**
- Create: `ios/App/App/MindRoomQuickCapturePlugin.swift`, `ios/App/App/MacScreenshot.swift`
- Modify: `ios/App/App/MindRoomBridgeViewController.swift` (register the plugin), `ios/App/App.xcodeproj/project.pbxproj`
- Test: `src/app/native/nativeQuickCaptureIOSContract.test.ts` (new, after `nativeFileSaveIOSContract.test.ts`), `ios/Tests/RoomRouteReloadTests.swift` (`checkNativePlugins`)

**Interfaces:**
- Consumes: the plugin contract of Task 5; `MacWindowing` (Task 11).
- Produces: plugin `MindRoomQuickCapture` with `hide`, `showMainWindow`, `openScreenRecordingSettings`, `captureScreenshot` (`target`: `window` or `screen`; resolves `path`, `name`; rejects `PERMISSION_DENIED`, `NO_WINDOW`, `UNSUPPORTED`, `CAPTURE_FAILED`). Off the Mac every method rejects `UNSUPPORTED`.

- [ ] **Step 1: Write the contract test** (the Swift source declares the four methods and the four codes, and matches the TypeScript names). Run `just test src/app/native`. Expected: FAIL.
- [ ] **Step 2: Implement.** `window`: the frontmost on-screen layer-0 window of `MacWindowing.lastFrontProcess`, as `SCContentFilter(desktopIndependentWindow:)`. `screen`: the display the widget is on, with this app's windows excluded. Both at the display's pixel scale, written as PNG to `FileManager.default.temporaryDirectory/quick-capture/`, named `Screenshot <app or Screen> <yyyy-MM-dd HH.mm.ss>.png`; earlier files there are deleted first, and at launch. `openScreenRecordingSettings` opens `x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture`.
- [ ] **Step 3: Run** `just test src/app/native` (PASS), build, and check by hand: both buttons attach a picture without the widget in it; with the permission refused the widget shows the text and the button opens the pane; sending posts the picture then the text into the room.
- [ ] **Step 4: Commit** `feat(mac): screenshots of the front window or the screen as Quick Capture attachments`.

### Task 13: Acceptance on the Mac and documentation

- [ ] **Step 1:** Run the spec's Mac checklist end to end against a real account: the shortcut over a browser, an entry, an agent's answer in the peek, a reply, resolve, both screenshots, the permission refusal, `Cmd+Enter` bringing the main window forward, relaunch. Take screenshots of the widget over a browser (list, peek, picker, attachment) for the pull request.
- [ ] **Step 2:** `docs/development.md` "Native shells": how to build and run the Debug Mac app, the widget's scene, the hot key, the Screen Recording permission. `README.md`: one line under the Mac app.
- [ ] **Step 3:** Run `scripts/build-macos-app.sh` (unsigned) to prove the Release archive still builds, and `scripts/test-ios-routing.sh` if a simulator is installed.
- [ ] **Step 4: Commit** `docs: Quick Capture on the Mac`.
