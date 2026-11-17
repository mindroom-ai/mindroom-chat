# Skill review marker

## Goal

The backend's skill review notice ("💾 Skill review: updated `developing-mindroom-chat`") renders today as a full agent message.
Bas wants it to look like the quiet "AI titled this thread" marker, with more detail on demand: which files changed and a small diff.
It must stay quiet by default: one slim line, details only on hover or click.

## Event contract (`io.mindroom.skill_review`, additive)

The backend already sends `m.notice` content with `"io.mindroom.skill_review": {"changes": {"<skill>": "created" | "updated"}}`.
It adds `files`, one entry per file a review changed, in change order:

```json
{
  "changes": {"developing-mindroom-chat": "updated"},
  "files": [
    {
      "skill": "developing-mindroom-chat",
      "path": "developing-mindroom-chat/SKILL.md",
      "action": "updated",
      "added": 12,
      "removed": 3,
      "diff": "@@ -10,4 +10,6 @@\n context\n-old\n+new\n",
      "diff_truncated": false
    }
  ]
}
```

- `path` is relative to the agent's skills directory (the skill's directory, then the file's path inside it). Never an absolute host path.
- `action`: `created` (file did not exist before the review), `updated`, or `removed`.
- `added` / `removed`: changed line counts between the file before the review's first change to it and after its last change.
- `diff`: unified diff hunks (no `---`/`+++` header lines), 2 lines of context. Omitted when the budget ran out.
- `diff_truncated`: true when `diff` is cut short or omitted. The counts are always exact.
- Budget: at most 4,000 characters of diff per file and 12,000 in total, cut at line boundaries, so the event stays far below Matrix's 64 KiB limit.
- Old notices have no `files`; clients fall back to `changes`.

## Client (mindroom-chat)

- Inside an open thread, a skill review notice from a MindRoom agent becomes one marker row (like `SnoozeEndedMarker` / `ThreadSummaryMarker`, via `MessageAside`): an icon and a label, e.g. "Updated skill `developing-mindroom-chat`", or "Updated 2 skills".
- Mouse hover shows a tooltip listing each file: path, action, `+added −removed`. With old notices it lists the skills and their actions.
- Click (or tap) toggles an inline panel under the marker: per file a header (path, counts) and its diff, monospace, added and removed lines tinted, capped height with scroll, and a "diff truncated" note when flagged. Notices without diffs do not expand.
- Other views (threads shown in the room) render the same marker as the message body via `renderAgentMessageContent`.

## Not in scope

Fetching full diffs or skill history from the server, showing skill contents beyond the diff, thread-list preview changes.
