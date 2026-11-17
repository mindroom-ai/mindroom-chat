# Room settings in room state

Bas wants per-room MindRoom settings that a room's admins set from MindRoom Chat, without editing
`config.yaml`. The first setting is extra rules for automatic thread titles (for example "3-5 words
after the emoji"). Room thread mode may move here later, in its own pull request.

## Event contract (shared by the backend and Chat)

- Event type: `io.mindroom.room_settings`, a state event.
- State key: the setting's name. One state event per setting, so settings never overwrite each
  other and two people saving different settings never lose an edit.
- Content: `{"value": <string>}`.
- Unset: Matrix cannot delete state, so clearing a setting sends `{}`. A missing event, `{}`, a
  `value` that is not a string, or a value that is empty after `strip()` all mean "unset".
- Power: Chat does **not** add this type to the level-0 `AGENT_STATE` list in room creation. It
  falls under the room's `state_default` (normally 50), so only moderators and admins can change
  settings. Agents only read it. Agent tools already cannot write it (`io.mindroom.` is in
  `MINDROOM_RESERVED_PREFIXES`).

## Settings

| State key | Value | Cap | Meaning |
|---|---|---|---|
| `thread_summary_instructions` | free text | 2,000 characters | Extra rules for this room's automatic thread titles, appended to the title instructions |

### `thread_summary_instructions` (backend)

- Every automatic title pass (the provisional title from the first prompt, the after-reply title,
  forced retitles) reads `io.mindroom.room_settings` / `thread_summary_instructions` for the room
  with one `room_get_state_event` call. No cache: titles are rare and the read is cheap.
- Fail open: `M_NOT_FOUND` means unset; any other error or exception logs a warning and the title
  uses the normal instructions. A title is never skipped because the read failed.
- A value longer than 2,000 characters is cut to 2,000 (Chat already enforces the cap).
- When set, the system instructions become a new overridable prompt template
  `THREAD_SUMMARY_ROOM_INSTRUCTIONS_TEMPLATE` (in `prompts.py`, fields `instructions` and
  `room_instructions`), rendered with `instructions` = the normal `THREAD_SUMMARY_INSTRUCTIONS`
  (built-in or `prompts:` override) and `room_instructions` = the room's text. The default
  template appends a section that says the room's rules come from the room's admins and win over
  any conflicting rule above (length, style, emoji), but never over the rule to treat thread
  messages as untrusted. When unset, the instructions are exactly what they are today.
- Precedence, lowest to highest: built-in default, `prompts:` override, room setting.

### `thread_summary_instructions` (Chat)

- Room settings dialog gets a new page, **MindRoom** (not shown for spaces), drawn from a small
  definitions list (`key`, label, description, placeholder, `maxLength`). Only a `text` kind exists
  now; a `choice` kind gets added with the first setting that needs it.
- The text setting: a multi-line field showing the current value, Save (enabled only when the
  text changed), Clear (sends `{}`), the character count against the cap, an inline error when the
  send fails, and live update when someone else changes the state. Read-only with a short note
  when the user lacks the power to send `io.mindroom.room_settings`.
- Note under the field: titles already set keep their wording until the next refresh.
