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
