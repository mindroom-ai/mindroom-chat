# Floating call window (desktop)

## Understanding

Bas asked for a different call experience on desktop: a floating window that can be dragged around and resized. Three mockups (A window, B picture-in-picture, C voice) led to a hybrid he approved: A's window and its full control bar, C's voice stage, B's speaker view, camera inset and corner snap. He wants every control kept, and the people on video visible when their camera is on.

Assumptions (not said, chosen here):

- The floating window replaces the call side panel on desktop by default. The side panel stays as a choice ("Dock"), per account.
- Phones keep today's full-screen call panel, unchanged.
- The window stays on screen while the person moves between rooms and threads.

## Scope

In:

- A floating call window on desktop (every screen size but `ScreenSize.Mobile`): drag, resize from every edge and corner, minimize to a one-line bar, dock into the side column and float again, kept inside the viewport, remembered per account.
- The hybrid layout inside the call view, on desktop and phones alike: video tiles while any camera or screen share is on, a voice stage while none is; speaker view with the own camera as an inset; a speaker or grid switch.
- Every control in every call: agent calls get the camera and screen share buttons too (today they hide them).
- Title bar buttons: speaker or grid view, open the conversation an agent call started from, dock or float, minimize, close.

Out, with reasons:

- **Live transcript.** The mockups showed one; nothing can feed it today. MindRoom's voice agent starts its LiveKit session with `text_output=False` and keeps the transcript private until it posts the transcript card after the call (`src/mindroom/matrix_rtc/voice_agent.py`, `call_writeback.py`). Publishing it over LiveKit's `lk.transcription` text streams would hand the words to the call service outside Matrix encryption, so the channel is a backend decision (a Matrix event in the call room keeps encryption). Follow-up: agree the channel, then add the panel (under the stage, beside it once wide, a subtitle when short, as mocked).
- **Pop out** (Document Picture-in-Picture). Chromium only; folds draws menus and tooltips into the main document, and the styles would have to be copied into the new one. Follow-up.
- Dragging a docked panel out to float it. The docked panel gets a Float button instead.
- A level meter driven by audio levels. The call state carries `speaking` only; the voice stage animates while someone speaks.

## Behavior

### Where the call view shows

`callPanelRoomAtom` keeps its meaning: the room whose call view is open (a call's room, or an agent call's origin room). A per-account mode decides where that view shows on desktop:

| Mode | Desktop | Phone |
|---|---|---|
| `floating` (default) | the floating window, over every page, whatever the route | side panel, as today |
| `docked` | the room's side panel, as today (only while that room is open) | side panel, as today |

- The header call buttons, a ring's Answer, a started call and the rail's call button set `callPanelRoomAtom` as today, so they open the window in floating mode.
- Close (X, "Close call view") clears `callPanelRoomAtom` as today: the call goes on, the rail's call button brings the window back.
- The rail's call button in floating mode opens the window and expands it when minimized; it does not navigate. In docked mode it navigates as today.
- Dock (in the window) sets `docked` and navigates to the call view's room (and the agent call's origin thread) when another route is open, so the docked panel is seen. Float (in the docked panel) sets `floating`; the window opens at its remembered place.
- A room that is gone (`mx.getRoom` answers null) shows no window.

### The window

- `position: fixed`, above the page, below modal dialogs and the incoming-call ring.
- Default 400 by 480 px, 16 px from the bottom and end edges. Minimum 340 by 220 px expanded; the bar is 56 px tall.
- **Move:** pointer drag on the title bar (not on its buttons). The window stays 8 px inside the viewport and sticks to an edge within 16 px of it.
- **Resize:** pointer drag on any of 4 edges or 4 corners. Resizing below 120 px tall turns the window into the bar; dragging the bar's bottom edge down expands it again.
- **Minimize** (title bar button) turns it into the bar in place, keeping the height to return to. The bar shows up to three avatars of the others (the speaking one ringed), the title and status, while joined the microphone and leave buttons, then Expand (which gives the height back) and Close. Once the call failed or ended, the status says why (the problem, or that the call ended) and Close, the expanded view's Dismiss, takes the place of the microphone and leave buttons, so a failed call can be dropped from the bar. A moved bar drops into the nearest corner on release. When the call shown in a floating window ends on this device, the window closes; the focus it had (or the End button's, gone with the call) goes to the room's call button on the page, else to the page's main content where the skip link lands.
- **Keyboard:** the title bar takes focus ("Move call window"); arrows move it 16 px, Shift+arrows resize it 16 px.
- **Viewport changes:** the window keeps its distance to the nearer horizontal and vertical edges, shrinks to fit when the viewport is smaller than it, and stays 8 px inside.
- **Remembered** per account in `localStorage` key `mindroom.callWindow:<user id>`: mode, position, size and the height to expand to. A stored rectangle is fitted to the viewport when read.
- Physical `left` and `top` place the window (it is positioned by coordinates, not by a side); everything inside follows the logical-side rules.

### Inside the call view

The joined call's body is a stage over the control bar, with the notices above the stage as today.

- **Video stage** while any participant shares video or a screen: the tile grid. `fitTiles(count, width, height, gap)` picks the column count that makes tiles biggest at 4:3 and lets each tile stretch between 1:1 and 16:9 to fill the stage. Speaker view replaces the grid when the person picks it, when a screen is shared, or when grid tiles would be under 100 px wide: the shared screen (else the most recent remote speaker, else the first remote participant) fills the stage, the others show as a row of small avatars at the top end edge (the speaking one ringed; five circles at most, the fifth a filled "+n" circle counting the rest past the first four), and the own camera shows as an inset at the bottom end corner when it is on and not the one in focus.
- **Voice stage** while nobody shares video: the other participants' avatars (64 px when one, 48 px when more) with a ring on the speaking one, three animated bars while anyone speaks, and a status line: who speaks ("Mind is speaking"), else "You are muted" while the own microphone is off, else "Listening" when every other participant is an agent that is connected (not while the call still waits for its agent); quiet people get no line. Alone in the call, "Waiting for others to join" takes the place of the bars and the status line. One other participant shows without a name under the avatar (the title names the call). Shorter stages drop the status line, then the names, then the bars.
- The awaited agent of an agent call shows on the voice stage as it shows as a tile today, waiting until it joins.
- **Controls** in every call: microphone, camera, screen share (where the browser shares screens), sound, devices, leave. Agent calls gain camera and screen share.
- **Title bar buttons:** speaker or grid (video stage only), open conversation (agent calls with an origin), dock or float (desktop), minimize (floating), close. A title bar narrower than its buttons drops the speaker switch first.
- Prescreen (before Join): unchanged content in the same frame; the bar shows only the title, Expand and Close.
- A failed chunk load shows the existing "This couldn't load" view with End and Close, in the window as in the panel.

## Architecture

New and changed files (all in `src/app/calls/` unless named):

| File | Role |
|---|---|
| `window/callWindowGeometry.ts` (+ test) | Pure rectangle math: move with margin and edge stick, resize from an edge or corner with minimums, bar threshold, corner snap, keyboard steps, fit to a new viewport, default rectangle. |
| `window/callWindowState.ts` (+ test) | Per-account atom of `{ mode, rect, expandedHeight }` in `localStorage` (`atomWithLocalStorage`, as `ResizablePanel` does), with `setMode`, `expand` and `minimize` helpers. |
| `window/FloatingCallWindow.tsx`, `.css.ts` (+ test) | The frame: fixed position, pointer drag and resize (pointer capture), the 8 handles, bar mode, keyboard, viewport fitting, persistence. Renders the call view as its child. |
| `window/CallWindowHost.tsx` (+ test) | Mounted in `CallFeatures`: on desktop in floating mode with `callPanelRoomAtom` set and its room known, renders the window with the lazy call view inside `PowerLevelsContextProvider`. |
| `CallPanelPart.tsx` | The lazy `CallPanel` part and its `CallPanelUnavailable` fallback, moved out of `room/Room.tsx` so the room and the window share them. |
| `stageLayout.ts` (+ test) | `fitTiles` and the speaker-view choice. |
| `CallStage.tsx`, `CallStage.css.ts` (+ test) | Video stage (grid, speaker view, inset, faces row) and voice stage. |
| `CallPanel.tsx`, `CallPanel.css.ts` | Uses `CallStage`; title bar buttons; bar content; camera and screen share in agent calls. |
| `ActiveCallTab.tsx` | Floating mode: open and expand without navigating. |
| `room/Room.tsx` | The call side panel opens only on phones or in docked mode; imports the part from `calls/CallPanelPart.tsx`. |
| `i18n/locales/additions/*.json` | New `featureUi.calls.window.*` and stage strings in every app language. |
| `e2e/calls/call-window.spec.ts`, `e2e/calls/calls.spec.ts` | Window behavior; the chunk-failure test finds the fallback in the window. |

Data flow: `callPanelRoomAtom` (which room) and the window atom (where and how big) are independent. `CallWindowHost` reads both and the screen size; `Room.tsx` reads both for the side panel. The call state (`useCallState`) feeds `CallStage`, the bar and the controls as today.

Layers: everything new is in `calls` (layer 6); it imports `navigation`, `matrix`, `ui`, `lib` and `preferences`, all lower.

## Error handling

- Pointer capture lost (`pointercancel`, `lostpointercapture`) ends a drag where it stands and saves.
- `localStorage` unreadable or holding junk: defaults; writes that fail are ignored (`setLocalStorageItem`).
- A viewport smaller than the minimum size: the window takes the viewport less the margins.
- Account sign-out or switch: `forgetCallState` clears `callPanelRoomAtom`, so no window shows; the geometry key is per account.

## Testing

Unit (vitest; DOM tests with `// @vitest-environment jsdom`, a `PointerEvent` stub and `setPointerCapture` stubs):

- geometry: move clamp and edge stick, every edge and corner resize with minimums, bar threshold, corner snap, viewport fit, keyboard steps;
- state: defaults, junk in storage, mode switch, minimize then expand returns the height;
- `fitTiles`: one to six tiles in wide, tall and tiny stages, the speaker-view threshold;
- `FloatingCallWindow`: drag moves and saves, resize, minimize and expand, keyboard, viewport resize;
- `CallWindowHost`: shows on desktop in floating mode, not on phones or when docked, stays when the route changes;
- `CallStage`: voice stage without video, grid with a camera on, speaker view with a screen share and the inset, the speaker switch;
- `CallPanel`: agent calls show camera and screen share; title bar buttons per mode;
- `Room.tsx` side panels: the call panel opens only on phones or docked.

e2e (`e2e/calls/call-window.spec.ts`, homeserver only, no call service): the header call button opens the window with the prescreen; drag moves it; a corner resize sizes it; minimize then expand; dock shows the side panel and Float brings the window back; the window stays while another room opens; a reload keeps its place and size. `calls.spec.ts` runs with the call service (`--rtc`) to confirm the joined call in the window.
