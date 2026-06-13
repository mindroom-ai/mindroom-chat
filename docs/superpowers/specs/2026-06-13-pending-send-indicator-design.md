# Pending Send Indicator Design

## Goal

Show a subtle, clear indicator when a message is a Matrix local echo that has
not yet been fully accepted and echoed by the server.

## User Experience

Messages in pending send states show a small muted clock indicator inline at
the end of the rendered message body. The indicator uses accessible text
(`Message sending`) and a tooltip/title such as `Waiting for server`.

The indicator is intentionally quiet:

- no bubble-wide dimming,
- no extra row below the message,
- no animation that could be confused with MindRoom AI streaming,
- no indicator after the message reaches a terminal failure state.

## Pending State Definition

Use Matrix local echo status rather than custom message metadata. A message is
pending when its `MatrixEvent.status` is one of:

- `EventStatus.ENCRYPTING`
- `EventStatus.SENDING`
- `EventStatus.QUEUED`
- `EventStatus.SENT`

Do not show the pending indicator for `EventStatus.NOT_SENT` or
`EventStatus.CANCELLED`.

`EventStatus.SENT` remains pending for this UI because the SDK documents it as
sent to the server but not yet remotely echoed. Once the remote echo is handled,
the SDK clears/replaces the local echo and the indicator should disappear.

## Architecture

Add a fork-owned MindRoom pending-send helper/component near the existing
message rendering code. The component should render a small Folds `Clock` icon
with low-priority/muted styling.

Route the component through the existing message state-suffix path used by
edited markers and MindRoom streaming indicators. This keeps the mark aligned
with text, emote, notice, long-text, and standard MindRoom message rendering
without changing the surrounding message layout.

Suffixes should compose rather than replace each other. If a message is both
edited and pending, render both the pending indicator and the edited marker. If
MindRoom AI streaming and local-echo pending are both present, keep the streaming
indicator visible and add the pending clock after it.

The first implementation targets message types that already render through the
inline message-body suffix path: text, notice, emote, file captions, and
MindRoom long-text variants. Media-only bodies and stickers are intentionally
out of scope for this pass because they do not have the same inline text suffix
surface.

If necessary, extend local echo update handling so `RoomEvent.LocalEchoUpdated`
causes the affected timeline surface to re-render when status changes or when
the local event ID is replaced. This prevents the indicator from getting stuck
after server acceptance.

## Testing

Add focused unit coverage for:

- helper returns pending for encrypting/sending/queued/sent states,
- helper returns false for no status/not_sent/cancelled,
- message rendering includes the pending indicator for a pending local echo,
- message rendering omits it for accepted or failed/cancelled states.

Prefer focused message-rendering or helper tests over expanding broad room
timeline tests unless local echo refresh behavior requires a targeted timeline
test.

## Validation

Run focused tests first, then `npm run typecheck`. Before finalizing, run the
repo-required validation that is feasible in this environment and record the
results in `FORK_CHANGES.md`.
