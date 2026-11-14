# Quick Capture

Bas Nijholt asked on 2026-11-13 for a way to make the Mac app more powerful: a shortcut that shows "a little floating todo app like thing", with a default room the entries post to, where new threads are added "easily with like keyboard shortcuts". He chose the design from mockups (a small widget that floats over the browser or any other app, "for quick notes and questions") and added: share a screenshot of the current app or of the entire screen. Build and test the Mac app on his MacBook M2.

## Understanding

- An entry is a new message in the chosen room, which becomes the root of a new thread. The list in the widget is that room's threads: a thread is a task, resolving it marks it done.
- The widget is small, stays above other apps, and is reached and driven from the keyboard.
- An agent's answer shows in the widget, so a quick question needs no switch to the main window.

Assumptions (not said, chosen here):

- Whether an agent answers an entry is the room's business (the backend's `!reply_mode`): the client cannot post a note that agents are sure to ignore, so there is one send key, not a "note" key and an "ask" key as in the mockup. A typed `@Name` reaches an agent as it does in the composer's plain text.
- Picking a room changes the default. There is no "use once".
- The global shortcut is fixed at Control+Option+Space in this version. (Option+Space, the first choice, is the default of Raycast and Alfred; on the MacBook M2 both opened on it.)
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

- **Look:** a Mac panel, not a page of the app. The system font; the Mac's label, fill and separator colors in the system's light or dark appearance, whatever theme the app has, with MindRoom's purple as the accent; an arrow for a pointer and labels that cannot be selected (fields and the peeked answer can); no highlight under the mouse; the selected row and the highlighted room on a rounded fill set in from the window's edges (the room on the accent, as a menu item); push buttons with a bezel; the keyboard focus as a soft ring of the accent.
- **Header:** the window's title bar, with the room as its title: a button (`Tab` in an empty input, or a click, opens the room picker).
- **Input:** a multi-line text field with the caret in it whenever the widget shows. `Enter` sends, `Shift+Enter` adds a line, `Cmd+Enter` (`Ctrl+Enter` off Apple platforms) sends and opens the new thread in the main window. After a send the input empties and keeps the focus, so entries can follow one another.
- **Attachments:** up to 4 images, shown as chips above the input, each with a remove button. A pasted image becomes one. On the Mac two buttons add a screenshot: the front window of the app that was in front before the widget (`Cmd+Shift+A`), and the whole screen the widget is on (`Cmd+Shift+S`). The widget's own window is never in the picture.
- **Send:** text alone is one message, built like the composer builds it (Markdown as the `isMarkdown` setting says, typed `@Name` left as text). With images, the first image is the root, the other images and then the text follow in its thread: MindRoom takes a media batch as one turn and closes it on the trailing text.
- **List:** the room's unresolved threads, newest activity first, at most 30, then the threads resolved in the last 24 hours, dimmed. A root of the user's own that nobody answered yet is a thread too; other people's messages nobody answered are not, or in a chat room every message would be a row. Each row: a leading circle that resolves the thread on a click (and reopens a resolved one, which shows a check), the title (the AI title, else the root's text), one line under it (the newest reply as "Sender: text", else "Sent"), and at the title's end what the thread is doing and when it last moved: a spinner while an agent streams, `Needs you` for a pending approval or question (both in place of the time), a dot while unread, and the time as the app's lists write it (`now`, `5m`, `2h`, `3d`, then the date). A resolved row says "Resolved" to a screen reader only.
- **Keys in the list:** `ArrowDown` with the caret at the end of the input moves into the list (before that it moves the caret, also through the lines a paragraph wraps into); `ArrowUp` on the first row moves back. `ArrowUp`/`ArrowDown` or `k`/`j` move, `Space` opens and closes the peek, `x` resolves or reopens, `r` replies, `c` copies the peeked reply, `Enter` opens the thread in the main window, `n` returns to the input. Typing any other character returns to the input with it.
- **Peek:** under the row, scrolled into view, the newest reply's sender and its plain text as the app's previews clean it (tool calls counted, Markdown dropped) with its lines kept, up to 600 characters (an ellipsis where it is cut; Copy copies the whole reply as its sender wrote it), in place of the row's one line, with Copy, Open and Done buttons (each with its key in its tooltip) and a one-line reply field. `Enter` in the field sends the reply into the thread. A peek that opens on a `new` row reads the thread.
- **Room picker:** replaces the list. A search field over the joined rooms that are not spaces, most recently active first, at most 50 shown; `ArrowUp`/`ArrowDown` move, `Enter` picks, `Escape` closes. The pick is stored per account (`quickCaptureRoom:<user id>` in `localStorage`) by the host.
- **No room yet:** the picker is open.
- **Keys shown:** one line at the window's foot, for the part that has the focus (the input, the list or the picker), each key as the platform's menus write it (`⌘↵`, `⇥`, `Space`, `R`). The list's arrows, `j`, `k`, `c` and `n` go unsaid.
- **Escape:** closes the picker, else the peek, else hides the widget (on the Mac; nothing in a browser).
- **States without a list:** "MindRoom is not open" (no host answered in 1.5 s), with an Open button on the Mac that shows the main window (a browser has none to show), and "Sign in to MindRoom" when the app has no session. The text and the images of the entry stay while the widget waits for a host.
- **Errors:** a failed send keeps the text and the images in the input and shows the error under it; a failed resolve or reply shows in its row.

### Mac shell

- `Control+Option+Space` anywhere: shows the widget above the app in front with the caret in the input. Pressed while the widget has the keyboard, it hides it and gives the keyboard back to the app that had it; so does Escape. That app, also the one the window screenshot takes, is MindRoom itself when the shortcut showed the widget over it, else the last other app that came forward, also when a click brought the widget forward. The main window stays where it is.
- The widget's window: 360 by 460 points, no title bar, movable by its header, above other apps' windows, on the Space in front as it shows. Over another app's full-screen window it opens on a desktop Space instead: only a non-activating panel can show over a full-screen app, and a UIKit scene's window cannot be one. Its place is remembered. It has a panel's rounded corners and shadow, and the system's material behind it: the web view is transparent and the page paints no background there, so what is under the window shows through, blurred. The page does not bounce as a whole, cannot be zoomed, and a right click shows no web menu (Reload, Inspect) outside a text field.
- The app's Window menu has "Quick Capture" with the same shortcut shown.
- Closing the main window closes the widget too, so that the Dock opens the main window again; an activation of the app with no main window (the Dock, or a launch that restored only the widget) opens one. A widget restored at launch starts hidden.
- Opening a thread from the widget brings the main window forward and hides the widget.
- The first screenshot makes macOS ask for Screen Recording permission for MindRoom.chat, and then whether the app may capture without the system's window picker; the permission applies after a relaunch. Refused, the widget says so with a button that opens that pane of System Settings.
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

**Protocol.** Every message carries `v: 1`. Widget to host: `hello`, and `request` with an `id`, the `hostId` it addresses and one action: `send` (`roomId`, `text`, `images: Blob[]`, `open`), `reply` (`roomId`, `threadId`, `text`), `resolve` (`roomId`, `threadId`, `resolved`), `selectRoom` (`roomId`), `open` (`roomId`, `threadId?`), `read` (`roomId`, `threadId`). Host to widget: `state` (`hostId`, `CaptureState`), `response` (`id`, `hostId`, and a result: `ok` with an optional `threadId`, or an error code), and `gone` when the host unmounts or its page goes away (`pagehide`: a reload or a sign-out unmounts nothing). A host has a random `hostId`; the widget follows the first host that answers its hello and ignores the others, so two app tabs in a browser cannot both run a request.

**State.** `CaptureState` is `{ userId, roomId, rooms, items }`: `rooms` are `{ id, name, direct }`, `items` are `{ threadId, title, line, lineSender?, replyText?, chip?, resolved, ts }`. The host builds it from `crossRoomThreadIndexAtom`, `getThreadSignalsReader`, `navigationRoomsAtom` and the room's live timeline (`isZeroReplyStandaloneThreadRootEvent`), and posts it on hello and, while a widget said hello in the last 30 s (the widget repeats it every 10 s while visible, every 1.5 s while no host answers, and at once when it shows again or its window gets the focus), on each change, at most 4 times a second: at once when the last state is 250 ms old, else at the 250 ms mark.

**Data flow of a send.** Widget `request` with `send`; the host uploads each image (`encryptFile` in an encrypted room, `mx.uploadContent`, `getImageMsgContent`), sends the root with `mx.sendMessage`, then the thread events with `getMessageRelation`, answers `response` with the root's id, and for `open` navigates with `useRoomNavigate().navigateRoomThread`; on the Mac the widget then calls `showMainWindow`.

**Screenshot.** The widget calls `captureScreenshot({ target: 'window' | 'screen' })`. Native writes a PNG into the app's temporary folder and resolves `{ path, name }`; the widget fetches `Capacitor.convertFileSrc(path)` into a `File`, and the temporary file is deleted on the next capture and at launch.

**Mac windowing.** `UIApplicationSupportsMultipleScenes` becomes true on the Mac only: the plist value is the build setting `MINDROOM_SUPPORTS_MULTIPLE_SCENES` (`YES` for `sdk=macosx*`, else `NO`), and UIKit honors the string. `AppDelegate` gives the "Quick Capture" configuration to a scene requested with the activity type `chat.mindroom.quick-capture` and `Default Configuration` to any other. The widget's `NSWindow` is the one of `NSApp.windows` whose `uiWindows` holds the scene's `UIWindow`, set up through key-value coding: titled with a transparent, empty title bar and hidden buttons (so it keeps a window's corners, shadow and keyboard), the floating level, an `NSVisualEffectView` (popover material, behind the window) below the scene's content, and a frame autosave name. UIKit sets its own title bar again as the scene comes forward, so the widget's goes back on in `sceneDidBecomeActive`. The Carbon functions (`RegisterEventHotKey`, `InstallEventHandler`, `GetEventDispatcherTarget`) are looked up with `dlsym`. Everything Mac-specific is inside `#if targetEnvironment(macCatalyst)`, since the iOS routing test host compiles every file of `ios/App/App/`.

**The page in the window.** The bridge starts at the app's root, which `loadWebView` insists exists as a file, and the widget's controller loads `/quick-capture/` in its place before the root answers. Its web view is made transparent before that first load (Capacitor restores the opacity it finds). The app is scaled to match iPad, so a UIKit point is 0.77 of the Mac's: the window is sized in the Mac's points, and the native side sets `--mac-point-scale` on the document (a user script, so a reload keeps it), which the page's stylesheet scales its rem by; `WKWebView.pageZoom` left the page's viewport units at the unzoomed size. The page marks itself `data-native` when the plugin is there: no background on the page or the document, no safe area under the hidden title bar, no web menu on a right click outside a field or a selection.

### Settled on the Mac

Checked on the MacBook M2 (macOS 26.5.2, Xcode 26.6), driving its screen over Screen Sharing:

1. A `BroadcastChannel` message crosses between the two `CAPBridgeViewController` web views of the process; an 8 MB `File` arrives in 4 ms as a `File`. No relay.
2. The scene's window is raised to the floating level, shown over Safari and given the keyboard through AppKit reached at run time, with the main window left behind it; the Carbon hot key fires while another app is in front. Over another app's full-screen Space it does not show (see the Mac shell above). Dragging by the header works through the hidden title bar, whose clicks still reach the room button.
3. ScreenCaptureKit builds for Mac Catalyst 18.2 and captures the front window of another app and the display without the app's own windows, at the display's pixel scale.
4. Ordered out, the widget's page reports `document.visibilityState` `hidden`; it gets `focus` when shown. With the main window closed, its web view lives on unless stopped: the app now blanks that page as its scene disconnects (past Capacitor's navigation policy, which would hand `about:blank` to a browser), so its host says `gone`, its client stops, and a widget opened then says MindRoom is not open until the main window opens again. The widget closes with the main window (see the Mac shell above).

## Error handling

- Requests time out in the widget after 20 s (60 s for a send with images) with `timeout`; the host answers every request once.
- Host errors are codes, shown as text in the widget: `no-room` (the room is not listed any more: left, archived or replaced), `upload-failed`, `send-failed`, `forbidden` (no permission to resolve), `timeout`.
- An image that fails to upload fails the whole send before any event is sent, so no thread is left without its picture.
- A send that fails after it started its thread says so with `posted` (the thread and how many images went out): the widget drops those images from the entry and sends the rest into that thread, so a retry repeats nothing. An entry emptied by hand starts a new thread.
- A message that is not a valid protocol message, or names another `hostId`, is ignored.
- Native rejections: `PERMISSION_DENIED`, `NO_WINDOW` (the front app has no window), `UNSUPPORTED` (not a Mac, or macOS older than ScreenCaptureKit on Catalyst), `CAPTURE_FAILED`.
- A widget whose host goes away (`gone`, or no state for 30 s while it shows, or for 1.5 s after the hello it says as it shows again) says hello again at once and falls back to "MindRoom is not open".

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
