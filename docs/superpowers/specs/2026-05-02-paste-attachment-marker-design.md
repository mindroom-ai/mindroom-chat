# Paste Attachment Marker Design

## Goal

When a user pastes text into the MindRoom Cinny composer and the resulting Matrix message would exceed the safe event-size budget, Cinny should turn the pasted text into a normal file attachment and insert a short sent marker at the original paste position.

The sent marker gives downstream MindRoom processing a stable literal token to replace with the attached text later.

## Matrix Compatibility

The feature must use only standard Matrix message shapes:

- The surrounding composer text remains a normal `m.room.message` with `msgtype: m.text`.
- The pasted payload is uploaded as a normal text file attachment with `msgtype: m.file`.
- The marker is plain text inside the message body.

Older clients may show the raw marker text. That is acceptable. They must not receive unsupported event types or custom-only attachment events.

The Matrix spec limits full events to 65536 bytes after federation formatting and canonical JSON encoding. Client-side detection should use a conservative content budget rather than trying to exactly reproduce server-side event construction.

## Marker Contract

Use this plain-text marker form:

```text
[[mindroom-paste:{"v":1,"id":"paste-a3f19c","chars":18421,"file":"mindroom-paste-a3f19c.txt"}]]
```

Fields:

- `v`: marker contract version. Current version is `1`.
- `id`: `paste-` plus a short lowercase hex identifier. It only needs to be unique within the composed message.
- `chars`: JavaScript string character count of the pasted text.
- `file`: attachment filename. The filename must include the id suffix.

The exact marker string is inserted where the paste would have occurred. MindRoom downstream code can later find markers by scanning for the fixed `[[mindroom-paste:` and `]]` delimiters, parse the JSON payload, and replace the exact token with the attached text content.

## Composer Behavior

On paste:

1. If the clipboard contains files, keep the existing file-paste path.
2. If the clipboard contains text, estimate the Matrix event content size after inserting the pasted text into the current editor content.
3. If the estimate stays under the safe budget, allow the normal Slate paste behavior.
4. If the estimate exceeds the budget:
   - prevent the normal paste,
   - create a UTF-8 `text/plain` file from the pasted text,
   - add that file to the existing room upload board,
   - insert an atomic inline-void editor badge at the current editor selection that serializes to the marker text,
   - leave the user free to edit surrounding text before sending.

While composing, deleting the badge removes the staged paste attachment, and canceling/removing the staged paste attachment removes the corresponding badge. Once a message has been sent, the attachment is normal Matrix history and should not be deleted implicitly by marker rendering.

The upload board send path should continue to send text and attachments through the existing MindRoom send-session controller, preserving thread/reply behavior.

## Render Behavior

MindRoom Cinny should render marker text as a compact badge in both the composer and displayed messages. The event body remains unchanged; display-time rendering is a presentation-only transform.

Badge display should show:

- "Pasted text"
- the marker id
- character count
- filename

The badge reduces accidental marker edits in Cinny-controlled views and makes the placeholder understandable. Copying or downstream markdown processing can still use the original event body, because the underlying sent message remains plain text.

## Files And Ownership

- Composer paste policy belongs in `src/app/mindroom/room-input`, near `MindroomRoomInput`.
- Shared marker creation/parsing helpers should live under `src/app/mindroom/messages` because the marker is a message-body contract consumed by both compose and render code.
- Composer-only size-estimation helpers should live in a small owner module under `src/app/mindroom/room-input`.
- Render-time marker badge rendering should live under `src/app/mindroom/messages`, behind the existing `renderMindroomMessageContent` boundary.
- Upload and send-session mechanics should reuse the existing upload board and send-session controller.

## Testing

Add focused tests for:

- marker creation and parsing,
- safe/oversized paste decision,
- oversized text paste becoming an upload item plus inserted marker,
- normal paste not being intercepted under the budget,
- marker rendering as a badge while preserving ordinary text around it.

Run focused tests first, then `npm test`, `npm run typecheck`, `npm run build`, `npm run lint`, and `git diff --check` before finalizing.
