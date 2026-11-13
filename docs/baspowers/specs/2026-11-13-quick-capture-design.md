# Quick Capture

Bas Nijholt asked on 2026-11-13 for a way to make the Mac app more powerful: a shortcut that shows "a little floating todo app like thing", with a default room the entries post to, where new threads are added "easily with like keyboard shortcuts". He chose the design from mockups (a small widget that floats over the browser or any other app, "for quick notes and questions") and added: share a screenshot of the current app or of the entire screen. Build and test the Mac app on his MacBook M2.

## Understanding

- An entry is a new message in the chosen room, which becomes the root of a new thread. The list in the widget is that room's threads: a thread is a task, resolving it marks it done.
- The widget is small, stays above other apps, and is reached and driven from the keyboard.
- An agent's answer shows in the widget, so a quick question needs no switch to the main window.

Assumptions (not said, chosen here):

- Whether an agent answers an entry is the room's business (the backend's `!reply_mode`): the client cannot post a note that agents are sure to ignore, so there is one send key, not a "note" key and an "ask" key as in the mockup. A typed `@Name` reaches an agent as it does in the composer's plain text.
- Picking a room changes the default. There is no "use once".
- The global shortcut is fixed at Option+Space in this version.
- The widget is one fixed size, 360 by 460 points.

## Scope

In:

- The widget page (`/quick-capture/`): input, the room's threads with their state, peek at the newest reply, reply, resolve, open in the main window, room picker.
- A host in the signed-in app that serves the widget over a `BroadcastChannel`, so the widget runs no Matrix client.
- Image attachments in an entry: pasted images, and on the Mac a screenshot of the front window of the app that was in front, or of the whole screen.
- The Mac shell: a second window for the widget that floats above other apps, the global shortcut, a menu item, the screenshot capture.

Out:

- The pill, the menu bar item, the per-app default room, grabbing the selected text or the page link of another app, dictation, one thread per pasted line. Each is a follow-up; the last three need Accessibility or Automation permission.
- Approvals and agent questions answered in the widget. A row says that the thread needs you, and Enter opens it in the main window, where Activity answers both.
- A setting for the shortcut. Follow-up, with a recorder for the keys.
- Markdown rendering of the reply in the peek. It shows the reply's plain text; the thread shows the rest.
- The widget on iOS, iPadOS, Android and as a browser popup. The page works in a browser tab beside an open app tab, which is how the e2e spec drives it, and is not linked from the web app.
- A capture queue for when the main window is closed. The widget says that MindRoom is not open and offers to open it.

## Behavior

### Widget

- **Header:** the room's name as a button (`Tab` in an empty input, or a click, opens the room picker).
- **Input:** a multi-line text field with the caret in it whenever the widget shows. `Enter` sends, `Shift+Enter` adds a line, `Cmd+Enter` (`Ctrl+Enter` off Apple platforms) sends and opens the new thread in the main window. After a send the input empties and keeps the focus, so entries can follow one another.
- **Attachments:** up to 4 images, shown as chips above the input, each with a remove button. A pasted image becomes one. On the Mac two buttons add a screenshot: the front window of the app that was in front before the widget (`Cmd+Shift+A`), and the whole screen the widget is on (`Cmd+Shift+S`). The widget's own window is never in the picture.
- **Send:** text alone is one message, built like the composer builds it (Markdown as the `isMarkdown` setting says, typed `@Name` left as text). With images, the first image is the root, the other images and then the text follow in its thread: MindRoom takes a media batch as one turn and closes it on the trailing text.
- **List:** the room's unresolved threads, newest activity first, at most 30, then the threads resolved in the last 24 hours, dimmed. A root nobody answered yet is a thread too. Each row: the title (the AI title, else the root's text), one line under it (the newest reply as "Sender: text", else "Sent"), and at most one chip: `working` while an agent streams, `needs you` for a pending approval or question, `new` while unread.
- **Keys in the list:** `ArrowDown` in the input's last line moves into the list; `ArrowUp` on the first row moves back. `ArrowUp`/`ArrowDown` or `k`/`j` move, `Space` opens and closes the peek, `x` resolves or reopens, `r` replies, `c` copies the peeked reply, `Enter` opens the thread in the main window, `n` returns to the input. Typing any other character returns to the input with it.
- **Peek:** under the row, the newest reply's sender and its plain text, up to 600 characters, with Copy, Open and Done buttons and a one-line reply field. `Enter` in the field sends the reply into the thread.
- **Room picker:** replaces the list. A search field over the joined rooms that are not spaces, most recently active first, at most 50 shown; `ArrowUp`/`ArrowDown` move, `Enter` picks, `Escape` closes. The pick is stored per account (`quickCaptureRoom:<user id>` in `localStorage`) by the host.
- **No room yet:** the picker is open.
- **Escape:** closes the picker, else the peek, else hides the widget (on the Mac; nothing in a browser).
- **States without a list:** "MindRoom is not open" with an Open button (no host answered in 1.5 s; the button shows the main window on the Mac), and "Sign in to MindRoom" when the app has no session.
- **Errors:** a failed send keeps the text and the images in the input and shows the error under it; a failed resolve or reply shows in its row.

### Mac shell

- `Option+Space` anywhere: shows the widget above the app in front with the caret in the input. Pressed while the widget has the keyboard, it hides it. The main window stays where it is.
- The widget's window: 360 by 460 points, no title bar, movable by its background, above other apps' windows, on every Space and over full-screen apps. Its place is remembered.
- The app's Window menu has "Quick Capture" with the same shortcut shown.
- Opening a thread from the widget brings the main window forward and hides the widget.
- The first screenshot makes macOS ask for Screen Recording permission for MindRoom.chat. Refused, the widget says so with a button that opens that pane of System Settings.
- The widget's web view loads once and stays loaded while hidden.
- A second main window cannot be opened: the "New Window" command is removed and a second main scene is closed as it connects.

## Architecture

The widget is a page of the same web app with no Matrix client. The signed-in app in the main window is the only client; it serves the widget. On the Mac the widget page runs in a second web view in a second window.

| File | Role |
|---|---|
| `src/app/quick-capture/captureProtocol.ts` | The messages between widget and host, their guards (`isCaptureMessage`), the state shape (`CaptureState`, `CaptureRoom`, `CaptureItem`), error codes |
| `src/app/quick-capture/captureChannel.ts` | `openCaptureChannel()`: the `BroadcastChannel` named `mindroom.quickCapture`; `createCaptureClient(channel)`: hello, state subscription, requests with ids and a timeout |
| `src/app/quick-capture/captureItems.ts` | Pure: the room's list from thread index entries, their signals and the room's unanswered roots |
| `src/app/quick-capture/captureRooms.ts` | Pure: the picker's rooms from the joined rooms |
| `src/app/quick-capture/sendCapture.ts` | `sendCapture(mx, room, entry)` and `sendCaptureReply(mx, room, threadId, text)` |
| `src/app/preferences/quickCaptureRoom.ts` | The per-account default room atom (in `preferences`, so sign-out can clear it) |
| `src/app/quick-capture/QuickCaptureHost.tsx` | Mounted in `ClientNonUIFeatures`: answers hello, pushes state while a widget listens, runs requests |
| `src/app/quick-capture/QuickCapturePage.tsx`, `.css.ts` | The widget page: connects, shows the states, owns the keys |
| `src/app/quick-capture/CaptureInput.tsx`, `CaptureList.tsx`, `CaptureRoomPicker.tsx` | The page's three parts |
| `src/app/quick-capture/captureKeys.ts` | Pure: key event and focus zone to action |
| `src/app/native/nativeQuickCapture.ts` | The `MindRoomQuickCapture` plugin: `hide`, `showMainWindow`, `captureScreenshot`, `openScreenRecordingSettings`, and whether it is there |
| `ios/App/App/QuickCaptureSceneDelegate.swift` | The widget's scene: a `QuickCaptureViewController` (a bridge controller that starts at `/quick-capture/`) |
| `ios/App/App/MindRoomQuickCapturePlugin.swift` | The plugin's native side |
| `ios/App/App/MacWindowing.swift` | Mac only: AppKit reached through the Objective-C runtime (window level, chrome, show and hide, front app), and the Carbon hot key |
| `ios/App/App/MacScreenshot.swift` | Mac only: ScreenCaptureKit capture to a PNG file |

**Protocol.** Every message carries `v: 1`. Widget to host: `hello`, and `request` with an `id`, the `hostId` it addresses and one action: `send` (`roomId`, `text`, `images: Blob[]`, `open`), `reply` (`roomId`, `threadId`, `text`), `resolve` (`roomId`, `threadId`, `resolved`), `selectRoom` (`roomId`), `open` (`roomId`, `threadId?`). Host to widget: `state` (`hostId`, `CaptureState`), `response` (`id`, `hostId`, and a result: `ok` with an optional `threadId`, or an error code), and `gone` when the host unmounts. A host has a random `hostId`; the widget follows the first host that answers its hello and ignores the others, so two app tabs in a browser cannot both run a request.

**State.** `CaptureState` is `{ userId, roomId, rooms, items }`: `rooms` are `{ id, name, direct }`, `items` are `{ threadId, title, line, lineSender?, replyText?, chip?, resolved, ts }`. The host builds it from `crossRoomThreadIndexAtom`, `getThreadSignalsReader`, `navigationRoomsAtom` and the room's live timeline (`isZeroReplyStandaloneThreadRootEvent`), and posts it on hello and, while a widget said hello in the last 30 s (the widget repeats it every 10 s while visible), on each change, at most 4 times a second.

**Data flow of a send.** Widget `request` with `send`; the host uploads each image (`encryptFile` in an encrypted room, `mx.uploadContent`, `getImageMsgContent`), sends the root with `mx.sendMessage`, then the thread events with `getMessageRelation`, answers `response` with the root's id, and for `open` navigates with `useRoomNavigate().navigateRoomThread`; on the Mac the widget then calls `showMainWindow`.

**Screenshot.** The widget calls `captureScreenshot({ target: 'window' | 'screen' })`. Native writes a PNG into the app's temporary folder and resolves `{ path, name }`; the widget fetches `Capacitor.convertFileSrc(path)` into a `File`, and the temporary file is deleted on the next capture and at launch.

**Mac windowing.** `UIApplicationSupportsMultipleScenes` becomes true on the Mac only: the plist value is the build setting `MINDROOM_SUPPORTS_MULTIPLE_SCENES` (`YES` for `sdk=macosx*`, else `NO`). `AppDelegate` gives the "Quick Capture" configuration to a scene requested with the activity type `chat.mindroom.quick-capture` and `Default Configuration` to any other. The widget's `NSWindow` is found by its scene's title and set up through key-value coding; the Carbon functions (`RegisterEventHotKey`, `InstallEventHandler`, `GetEventDispatcherTarget`) are looked up with `dlsym`. Everything Mac-specific is inside `#if targetEnvironment(macCatalyst)`, since the iOS routing test host compiles every file of `ios/App/App/`.

**Layers:** `quick-capture` is a new domain at layer 10 (it imports `threads`, `composer`, `navigation`, `matrix`, `native`, `preferences`, `ui`, `i18n`); `shell` (14) mounts the host and routes the page. `nativeQuickCapture.ts` sits in `native` (2).

### To settle on the Mac first

Three facts decide details above and are checked in a throwaway spike before the native code is written:

1. A `BroadcastChannel` message crosses between two `CAPBridgeViewController` web views of one process. If not: the plugin relays (`postToHost`, and a `message` event), behind the same `openCaptureChannel()`.
2. A scene's window can be raised to the floating level, shown over another app and given the keyboard without the main window coming forward, with AppKit reached through the runtime. If not: an AppKit bundle target embedded in the Mac app does the windowing.
3. ScreenCaptureKit builds and captures from a Mac Catalyst target, and the string build setting is honored for `UIApplicationSupportsMultipleScenes`. If not: `CGWindowListCreateImage` looked up with `dlsym`, and a Mac-only Info.plist (`INFOPLIST_FILE[sdk=macosx*]`).

## Error handling

- Requests time out in the widget after 20 s (60 s for a send with images) with `timeout`; the host answers every request once.
- Host errors are codes, shown as text in the widget: `no-room` (the room is not joined any more), `upload-failed`, `send-failed`, `forbidden` (no permission to resolve), `timeout`.
- An image that fails to upload fails the whole send before any event is sent, so no thread is left without its picture.
- A message that is not a valid protocol message, or names another `hostId`, is ignored.
- Native rejections: `PERMISSION_DENIED`, `NO_WINDOW` (the front app has no window), `UNSUPPORTED` (not a Mac, or macOS older than ScreenCaptureKit on Catalyst), `CAPTURE_FAILED`.
- A widget whose host goes away (`gone`, or no state for 30 s) says hello again and falls back to "MindRoom is not open".

## Testing

Unit (vitest, beside each module):

- `captureProtocol`: guards accept each message and reject wrong versions, kinds and shapes.
- `captureChannel`: hello and first-host-wins, request and response matching, timeout, `gone`, with a fake channel pair.
- `captureItems`: order, the 30 and 24-hour limits, chips for streaming, needs you and unread, unanswered roots merged without duplicates.
- `captureRooms`: spaces left out, order, the direct flag.
- `sendCapture`: text alone; images first then text in the thread; an upload failure sends nothing; encrypted rooms encrypt; the reply relation.
- `quickCaptureRoom`: per account, cleared at sign-out.
- `captureKeys`: every key in both zones.
- `QuickCaptureHost` (jsdom): answers hello with state, runs each action against a fake client, ignores other hosts' requests, posts `gone`.
- `QuickCapturePage` (jsdom): each state, send clears the input, a failed send keeps it, the picker flow, peek and reply, resolve.
- `nativeQuickCapture`: availability, and each method's call.
- `Router`: `/quick-capture/` renders without a session and without `ClientRoot`.
- Native source contracts: the scene manifest, the plugin's methods and error codes, the Mac-only guards.

e2e (`e2e/quick-capture/quick-capture.spec.ts`, disposable homeserver): a signed-in app page and a `/quick-capture/` page in one browser context; pick a room, send an entry and see its thread in the app, paste an image and see image then text in the thread, resolve from the widget and see it resolved in the app, `Cmd+Enter` opens the thread in the app page.

Mac (by hand on the MacBook M2, with screenshots for the pull request): the shortcut over a browser, send, the answer in the peek, both screenshots, the permission refusal, the main window staying put, relaunch.
