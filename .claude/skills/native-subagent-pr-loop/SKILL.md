---
name: native-subagent-pr-loop
description: Use when the user asks for native Codex sub-agents, parallel PR review agents, unbiased re-review loops, or main-thread fixes after agent findings in MindRoom Chat.
---

# Native Subagent PR Loop

## Core Rule

The main thread owns all repository mutations.
Native subagents provide bounded analysis or review, but review findings are untrusted until the main thread verifies them against current code.
After each fix, use fresh read-only reviewers with neutral prompts.

## Use When

- The user asks for native Codex agents, native sub-agents, parallel review agents, or a review loop.
- The user wants fixes made inline in the main thread after agent findings.
- The work is on a PR or branch where commits and pushes should remain inspectable.

## Do Not Use

- The user explicitly asks for `agent-cli`, tmux supervision, or another external agent runner.
- The task has no useful independent subtask or review surface.
- A reviewer must use private CI or browser state unavailable to a fresh subagent.

## Main Loop

1. Pin context.
   Read `AGENTS.md` and the Runbook in `FORK_CHANGES.md`, check `git status --short --branch`, and identify the PR's real base, head, and exact head SHA.
   Keep the active branch. If a branch must be created, its name must start with `caveman/`; never create a `codex/...` branch.
2. Implement in the main thread.
   The main thread edits, verifies, stages targeted files only, commits, and pushes.
   Do not use `git add .`, amend, rewrite history, or force-push unless the user explicitly asks.
3. Use task subagents only for bounded, non-overlapping analysis or review.
   Subagents must not edit repository files.
   The main thread applies any verified changes.
4. After each pushed step, start two fresh native Codex PR-review agents.
   Tell each reviewer to read and follow `.claude/skills/pr-review/SKILL.md`, review the full PR merge-base diff, and avoid edits, commits, pushes, or CI inspection if the user excluded CI.
5. Treat findings as claims.
   Verify each finding against current code before editing.
   Fix only real, in-scope issues in the main thread.
   Classify stale, incorrect, overreaching, or duplicate findings instead of patching blindly.
6. Repeat after any fix.
   Commit and push the main-thread fix, then launch fresh reviewers against the new head.
   After every third review round that still finds many issues or a new major bug class, stop patching and reconsider the design before another round.
7. Stop only when both fresh reviewers approve the same head.
   Confirm the worktree contains no unexpected changes and the remote branch matches the local head.

## Cinny Review Priorities

Review the whole diff. Pay particular attention when the changed surface includes:

- rapid Matrix edits used for agent streaming;
- thread routes, summaries, deep links, banners, and compact/expanded timelines;
- cached event data upgrading to newer live data;
- authentication and per-account state isolation;
- service-worker messages, media access, and persistent caches;
- fork-specific code that increases future upstream rebase cost.

These are prompts to inspect risk, not permission to narrow the review or invent issues.

## Bias Firewall

Do not bias review agents with:

- Prior findings or expected bugs.
- Claims that the PR should now be clean.
- A desired verdict.
- A narrowed scope such as "only check the previous failure."
- Defenses of the implementation.

Allowed review context:

- Repo path, PR number or URL, base ref, head ref, exact head SHA, and diff command.
- User constraints, such as "CI/tests already passing; do not inspect CI."
- Required local skill path: `.claude/skills/pr-review/SKILL.md`.
- Read-only requirement and exact output format.

Mention prior findings only when the user explicitly asks reviewers to re-check those exact items.

## Neutral Review Prompt Template

```text
Read and follow <absolute repo path>/.claude/skills/pr-review/SKILL.md.
Native Codex sub-agent only; do not use agent-cli.

Review PR <owner/repo#number> in repo <absolute repo path>.
Latest local HEAD is <sha> on branch <branch>.
Base is <base ref>; review the full pull-request diff with:
git diff <base ref>...<sha>

Do not edit files, commit, push, or inspect CI.
<User constraint if any, for example: tests already passed in the main thread.>

Output only:
- Verdict: APPROVE or CHANGES REQUIRED
- Findings with exact file/line and required fix

If no blockers, say APPROVE and no findings.
```

## Handling Reviewer Results

- Wait for both reviewers before declaring the loop clean.
- One approval is not enough if the other reviewer is still running.
- If any reviewer says `CHANGES REQUIRED`, verify the claim before editing.
- If the claim is real, fix it in the main thread, run focused verification followed by the project gates warranted by the blast radius, commit, push, and start a new review loop.
- If the claim is stale or wrong, record the reason and continue evaluating the other findings.
- Do not reuse a reviewer after the head changes; start unbiased reviewers with fresh context.

## Final Report

Report only current facts:

- Branch and pushed head SHA.
- Commits made.
- Verification run.
- Review loop outcome.
- Any skipped verification and why.
