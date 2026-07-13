# AGENTS: MindRoom Cinny Fork

## Mission

This fork exists to provide a Matrix client optimized for MindRoom AI agent workflows.

MindRoom depends on rapid message edits for streaming. Reliable edit rendering is mandatory. In addition, thread UX and tool-call visibility are core to product usability.

## First read (mandatory)

All agents must start with `FORK_CHANGES.md` (Runbook section).

It is the single source of truth for:

- architecture notes,
- implementation plan,
- execution order,
- validation/review process,
- current status and next steps.

Treat the Runbook section in `FORK_CHANGES.md` as a living document and keep it updated continuously.

## Working agreement

- Implement in small logical steps.
- Validate every step (`typecheck`, `build`, and lint when feasible).
- Require independent review after each logical step (separate agent/subagent when available; otherwise an independent second self-review).
- Commit frequently with focused messages.
- Add/update tests whenever behavior changes.
- Open pull requests as ready for review, never as drafts. After opening a PR,
  wait for all AI reviewers to finish, validate every finding, and address all
  confirmed items before considering the work complete.

## Testing notes

- For room/thread behavior, prefer dedicated behavioral tests over growing `RoomTimeline.test.ts` further. Route, filter, compact/expanded, and cache interactions regress across surfaces and are easier to verify in focused unit files plus live Playwright specs.
- When changing thread summaries, deep links, or room view mode behavior, verify both room overview and thread banner surfaces. They must share one resolution path and upgrade cleanly from cached state to newer live data.
- Run `npm test` before finalizing changes. Keep room timeline coverage in normal Vitest discovery; if a room test file becomes too large, split it by behavior instead of adding bespoke runners or name-pattern wrappers.
