# Inline canvases: HTML pages shown in the thread

## Why

Bas wants HTML mockups, charts and diagrams to appear in the middle of a thread, the way T3 Code's `html_render` tool shows a page inline above the final reply.
Today every `show_canvas` page opens the Canvas side panel, and the timeline shows only a notice with the canvas title and an open button.
For a mockup in the flow of a conversation, the panel pops open, covers the conversation on phones, and the page is gone from the thread once another canvas opens.

## What T3 Code does (read from source, pingdotgg/t3code @ 506a0438)

- Tool `html_render(html | path, title, height)`: "Show a finished HTML page (chart, diagram, mockup) inline in this thread, above your final reply."
- The frame is as wide as the reply column (728px desktop, about 360px phones) and sits on the thread background: the page must leave `html` and `body` without background, outer card, banner title or side padding.
- The page reports its height with a `ResizeObserver` and `postMessage`; the client fits the frame to it (minimum 80px, at most 20000px), so the page never scrolls inside the thread. `vh` units and `height:100%` on `html`/`body` are rejected because they loop.
- Theme CSS variables of the app are injected before paint and updated when the theme changes.
- Sandbox `allow-scripts allow-forms`, opaque origin. A hover button opens the page full screen.
- Extras we skip: `html_preview` (screenshot for the agent; MindRoom agents have a browser), keyboard shortcut forwarding, image gallery, link routing (canvas CSP blocks navigation already), server-side height measuring at several widths.

## What MindRoom already has

`show_canvas` (backend `src/mindroom/custom_tools/chat_ui.py`) already carries an agent-written page in the event (or as an uploaded file up to 4 MB), edits a canvas in place, and Chat renders it in a sandboxed wrapper frame with a strict CSP, theme variables (`--mr-*`), answers (`window.mindroom.submit`), saved state and versions (`src/app/messages/canvas/canvasDocument.ts`, `src/app/canvas/CanvasPanel.tsx`).
The missing piece is only where the page is shown.

## Design

### Protocol

`show_canvas` gains `inline: bool = False`.
With `inline=True` the request's `io.mindroom.chat_ui` data carries `"inline": true` beside `share_state`.
Like `share_state`, it is fixed when the canvas is first shown: an update (`canvas_event_id`) copies the original request's value, and Chat counts `inline` as an authority field, so an edit cannot flip it.
Without the flag nothing changes: panel canvases behave exactly as today.

### Chat: rendering

For an inline canvas, the canvas notice in the timeline shows the page itself, below the title and above the existing open button.
The open button stays: it opens the same canvas in the side panel, which is MindRoom's "full screen" (the panel can fill the room) and the place where answers, saved state and versions work.

The inline frame:
- reuses `buildCanvasDocument` (wrapper frame, CSP, sandbox, theme variables, libraries setting) with an `inline` option;
- the inline page's base style has a transparent background and an 8px padding instead of 16px, so it sits on the thread background like T3's;
- the bridge reports the page's height (`mindroom.canvas.size`, `{ height }`) from a `ResizeObserver` on `document.documentElement`, also after `load`, posting to `parent.parent` like its other messages; the bridge posts it in every canvas, and only the inline host reads it;
- the host accepts a size message only from its own canvas frame (`canvasFrameWindow`, origin `null`), and sets the frame height to `clamp(ceil(height), 80, 20000)` px; before the first message it is 160px;
- is as wide as the message body;
- is display only: it ignores submit, error and state messages, and builds the page with no saved state. The tool docs tell the agent that answers and saved state need the panel;
- shows the latest revision: an update of an inline canvas replaces the page in the thread;
- loads an uploaded page with `useCanvasPage`, showing a small loading line and a failed line with a retry like the panel does;
- shows nothing extra when canvases are disabled for the deployment: the notice then renders as today.

### Chat: no auto open

An inline canvas request does not open the side panel by itself (the auto-open in `useChatUiActions`). Opening from the button, the room header's canvas list and the Canvases page work as for any canvas.

### Backend: tool guidance

The `show_canvas` docstring and the `_FUNCTION_INSTRUCTIONS["show_canvas"]` line gain T3's guidance, adapted:
"With `inline=True` the page appears in the conversation at the width of a reply (about 700px on desktop, about 360px on phones) instead of the panel: use it for mockups, diagrams, charts and previews the user should see in the flow. Leave `html` and `body` without a background, outer card, title banner or side padding; give charts fixed pixel heights; let content set the height and do not use `vh` units or `height:100%` on `html` or `body`. An inline page cannot send answers or save state; for that, show a panel canvas."

## Out of scope

- A new tool name: `inline` is a parameter of `show_canvas`, which already has the page pipeline.
- Inline answers and saved state.
- Changing the default: panel stays the default, so existing agents behave the same.
- Height measuring on the server, `html_preview`, image gallery, shortcut forwarding.

## Testing

- Backend: `show_canvas(inline=True)` puts `"inline": true` in the request; an update keeps the original's value and ignores a different one; the chat UI contract fixture includes an inline canvas.
- Chat unit tests: protocol parses `inline` and rejects an edit that changes it; the bridge posts a size message; the inline host fits the height within bounds and ignores messages from other windows; inline requests do not auto open; panel canvases still do.
- Playwright screenshot spec (throwaway) on desktop and phone widths, light and dark, for the PR.

## Page mode: accurate previews (added 2026-11-16)

Bas mostly previews work that has nothing to do with MindRoom, such as elements of a website he is building, so the page must render as a browser would show it, not in MindRoom's style.

### Protocol

Each canvas revision may carry two presentation fields inside `canvas`, beside `title` and `html` or `document`:
- `raw: true`: Chat injects no style: no theme variables, no base style, no `color-scheme`. Browser defaults apply (white page, Times, 8px body margin) until the page's own CSS says otherwise.
- `width: <int>`, 320 to 2560: the page's viewport width in CSS pixels. An inline frame renders the page at that width and scales it down to fit the column (never up), so a desktop layout shows its desktop breakpoint. The height fit works in page pixels and is scaled the same way. Without `width`, the frame is as wide as the column, as before.

Both belong to the revision, so an update states them again; they are not authority fields. The panel honours `raw`; it ignores `width`, because the panel itself is resizable up to the whole room.

### Remote assets: a deployment switch

`mindroom.canvas.remoteAssets: true` in Chat's config lets canvas pages load images, styles, fonts, media and scripts from any `https:` source. `connect-src`, `frame-src`, `form-action` and `worker-src` stay `'none'`. This is the viewer's decision, like `libraries`: the asset hosts see the viewer's address and when they view, and a page can encode data in the addresses it loads. Off by default.
The backend toolkit option `enable_canvas_remote_assets` (like `enable_canvas_libraries`) tells the agent that remote assets work.

### Backend

`show_canvas(..., raw=False, width=None)`. `raw=True` adds `"raw": true` to the canvas; `width` is validated (integer, 320 to 2560) and added as `"width"`. The guidance says: use `raw=True` with `inline=True` to preview a website or app as it will look, and `width` for its target viewport (for example 1440 for desktop, 390 for a phone).

### Measuring a raw page

Raw pages get no `position:relative` on `body`, so the height is the larger of the body's extent and the root element's box. Content positioned against the viewport is not counted; such a page should give its own wrapper a height.

### Pages that follow their viewport (added 2026-11-16, reworked)

A page whose height follows its viewport, such as a `100vh` hero with a header, grows at least as much as its frame does, so fitting the frame to it would grow it to the 20000px cap.
Guessing that dependence from the timing of size reports failed three review rounds (pages growing twice as fast as their frame, pages growing by themselves in steps, an unrelated running animation, an exactly `100vh` page that never grows), so nothing guesses it.

A website preview (`raw`, or with its own `width`) is shown like a browser window instead: its frame is never taller than 16:10 of its layout width (`width`, or the column without it), at least 568 page px (an iPhone SE screen) and at most 1080.
The frame starts at that window, not at 160px, and its height is the smaller of the page's reported height and the window.
Content shorter than the window fits it; taller content, and any page sized by its viewport, stops exactly at the window and scrolls inside it.
No loop is possible, because the frame never grows past the window, and starting at the window lets an exactly `100vh` page land there at once.
Without `width` the column is under about 900px, so such a preview gets at most 568px: a hero fills a screenful of the thread and no more.

A themed inline page (neither `raw` nor `width`) fits its content as before, from 160px up to the 20000px cap and without scrolling; the tool guidance tells agents not to use `vh` units or `height:100%` on `html` or `body` there.
The size script is unchanged: it reports the body's extent whenever it changes.
