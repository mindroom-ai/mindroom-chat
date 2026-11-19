# Thread model change as one activity line

Status: design A ("one line in the conversation") chosen by Bas on 2026-11-19, with a privacy correction from the first backend review on the same day.
Paired changes: `mindroom-ai/mindroom` (the router acknowledges a typed change as it does the picker's) and `mindroom-ai/mindroom-chat` (this repository: pair the command with its acknowledgement and draw one line).

## Problem

Changing a thread's model, from the composer's picker or by typing `!model <key>` or `/model <key>`, leaves two message bubbles in the thread: the person's command and the router's reply ("✅ This thread now uses `fast` (openai gpt-...) for the agents and teams you may address. Use `/model reset` to ...").
They interrupt the conversation and repeat what the picker already shows.

## What Bas picked

One quiet line in time order, in place of both bubbles, that opens in place:

- at rest: a switch glyph, what happened, the new model, a chevron: `⇄ Model set  Quick helper · High ⌄`;
- a reset: `⇄ Model reset  Back to inherited models ⌄`;
- opened: who changed it and when, and its scope: "Applies to future replies in this thread from the agents and teams you may address." (the sender's name instead of "you" when someone else sent it).

No picker redesign, no other surface (thread cards, previews, notifications, the classic room view), no room model receipts.

## Wire contract

Nothing new on the wire.
The router's reply to an applied change carries `io.mindroom.model_selection_result`, as the picker's always has (MindRoom's `docs/architecture/matrix.md`, "Thread Changes and Acknowledgements"):

```json
{"io.mindroom.model_selection_result":{"version":1,"command_event_id":"$command","room_id":"!room:example.org","thread_id":"$root","runtime_user_id":"@mindroom_router:example.org","runtime_device_id":"ROUTER_DEVICE","operation":"set","model":"fast@high","status":"applied","override":"fast@high"}}
```

The backend change adds the same result to the reply of a typed `!model <key>` and `!model reset` that was applied.
A typed listing, a refusal, a rejected picker command and `!room_model` carry no applied result.

### Privacy rule (review correction)

The reply is readable by the whole room, while the model catalog and the models the thread's agents inherit reach only a requester who may address those agents, over encrypted to-device discovery.
The result therefore names only what the command itself named: the selected key and level.
It never carries a previous model, an inherited default, a display name or which agents changed, and the client must not need them.
A first draft that put the previous and the restored model into the result was dropped for this reason; hiding such fields in the client would not have been enough, since the raw event stays readable.

## Pairing: when the two rows become one line

The client never guesses from text. `planModelChanges` (`src/app/messages/modelChanges.ts`) pairs an acknowledgement with its command among the open thread's loaded rows, and only then hides the command's row and draws the line at the acknowledgement's row. Every condition must hold:

1. The room's state names a router the client trusts (`trustedRouterUserId`, as for voice transcripts), the viewer does not ignore it, and that account sent the acknowledgement, which is not redacted.
2. The acknowledgement's content, as its row shows it (the sender's own edits included), parses as a result (`parseModelSelectionResult`) with `status: "applied"`, names this room, the thread its own relation puts it in, and the router as `runtime_user_id`.
3. The command it names (`command_event_id`) is among the loaded rows, a message in that same thread (not the thread's root), not redacted, not from an ignored sender, not from a MindRoom agent, and, when the command is encrypted, the acknowledgement is too.
4. The command, as its row shows it, is that change: its `io.mindroom.model_selection` has the result's operation and model, or, without one, its body is exactly `!model <arg>` or `/model <arg>` where `<arg>` is the result's model for a set, and `reset` or `clear` for a reset.
5. Neither row is one the route or a jump opened, and no earlier acknowledgement already took the command.

Anything else keeps both rows as they are: a pending or failed send, a rejected or uncertain change, a listing or help, `!room_model`, an acknowledgement from an older backend (a typed change has none), from another account or an untrusted router, a redacted or unloaded command, a command edited into something else, a command that came as a voice message or behind a mention.

The plan is made on each render in one pass that reads one key of each row, like the voice transcript plan; it asks the server for nothing.

## The line

- `ModelChangeMarker` (`src/app/messages/ModelChangeMarker.tsx`) is a quiet marker row of the open thread, like the thread title and skill review markers, always on a row of its own. Its trigger is the markers' own disclosure: a button with `aria-expanded` and `aria-controls` that opens a panel under it, in the app's colour and spacing tokens.
- Who: the command's sender, by their room name. When: the acknowledgement's time, as `Time` shows it. Scope: the sentence above.
- The new model shows its display name when the viewer's own model catalog for the thread holds its key (what the composer's picker already shows them), with the level's name after it; otherwise the key as the command named it. The line reads the catalog through `ModelController.watch`, which listens without asking: a thread no composer shows discovers nothing for a line.

## Known limits

- **No "Old → New".** The model a change replaced cannot be proven from what the room can read: the result must not carry it (privacy rule), each person's change covers only the agents they may address, and an agent's own `thread_model` tool or a fork's copy changes a thread's models without any command in the thread. The line shows the new model only. Showing the old one would need a new, room-visible provenance record in the backend, which is out of scope.
- **A change that moved nothing still shows.** The result does not say whether any agent's model changed (choosing the model already in force, resetting a thread that had no override), so the line says what was done ("Model set", "Model reset"), not that something changed.
- **The display name is today's.** It comes from the viewer's current catalog, so an old line shows the name the key has now, and the key when the viewer has no catalog (they may address no agent of the room, discovery has not answered) or the key is gone.
- **Open thread only.** The classic room view, thread cards, previews, search and notifications show the two messages as before.
- **Typed changes need the backend change.** With an older backend only the picker's changes become a line.
- **A fork's prefix** shows its parent's changes as lines too; the scope sentence there speaks of the parent's thread.
- **A change made while an agent works** still starts a turn of its own for the thread's turn folds, as the hidden command is a person's message: when that turn folds, the line folds behind its break with the turn's other quiet markers.
