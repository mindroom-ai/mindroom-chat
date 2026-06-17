# Router Delegate Design

## Goal

Add a MindRoom message-menu action that lets a user delegate an unassigned router
message to one joined MindRoom agent in the same thread.

## Behavior

The delegate action appears only when all conditions are true:

- The message sender is `@mindroom_router:mindroom.chat`.
- The effective message content has no direct user mentions in `m.mentions.user_ids`
  and no room mention in `m.mentions.room`.
- The message is rendered inside a Matrix thread and exposes a thread root id.
- The room has at least one joined member matching
  `^@mindroom_[^:]+:mindroom\.chat$`, excluding the router user.

The menu item is labeled `Delegate to`. Opening it shows the eligible joined
agents in the room. Selecting an agent sends a new text message in the same
thread, replying to the router message.

The sent message body is:

```text
<original message>

@selected_agent:mindroom.chat, can you address this question?
```

The sent message also includes formatted HTML with a clickable Matrix.to user
link and `m.mentions.user_ids` containing the selected agent id.

## Architecture

Use the existing MindRoom message-menu extension path. Add focused delegate
helpers in `src/app/mindroom/messages/delegation.ts` for eligibility, agent
collection, mention detection, HTML escaping, and Matrix event content creation.
Render the UI from `MindroomMessageControls.tsx` and pass room/message context
through `MindroomMessageMenuExtensions`.

Sending uses `mx.sendMessage(room.roomId, content)` directly. The content uses
`m.relates_to.rel_type = m.thread`, `m.relates_to.event_id = threadRootId`,
`m.relates_to.is_falling_back = false`, and `m.in_reply_to.event_id` pointing at
the router message id.

## Errors

If sending is in flight, agent menu items are disabled. If Matrix send rejects,
the delegate menu stays open and displays a short failure message so the user can
retry or close the menu.

## Tests

Add unit tests for pure delegate helpers and focused message-menu integration:

- delegate action hidden for non-router senders,
- hidden when the router message already has `m.mentions`,
- hidden when the message is not in a thread,
- shows joined MindRoom agents only,
- selected agent send includes same-thread reply relation, plain body,
  clickable formatted mention, and `m.mentions.user_ids`.

## Validation

Run the focused delegate tests first, then typecheck and the normal test suite
before completion.
