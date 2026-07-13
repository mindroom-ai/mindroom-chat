---
name: pr-review
description: Zero-tolerance pull request review for MindRoom Chat. Every issue is a blocker. Use when reviewing PRs for merge readiness.
---

Review the pull request with a **zero-tolerance standard**. Every issue you find is a blocker — there is no such thing as a "minor issue" or "non-blocking suggestion". Either the PR is flawless and ready to merge, or it has problems that MUST be fixed before merging. Do not approve a PR with caveats like "ready to merge but consider..." or "minor nit:". If you would mention it, it must be fixed.

**Your verdict must be one of**:

- ✅ **APPROVE** — The code is near-perfect. No issues found. Merge immediately.
- ❌ **CHANGES REQUIRED** — Issues found. List every one. All must be fixed before re-review.

Never approve with suggestions. Never say "looks good overall but...". If there's a "but", it's CHANGES REQUIRED.

## Scope and Refactor Standard

Code touched by a PR must be merge-and-forget quality — no rough edges, no avoidable duplication, no unconventional idioms.
Do not require refactors of untouched code unless they have clear immediate ROI.

- Require a broader refactor only when it has clear immediate ROI:
  - It removes active duplication in current code paths.
  - It creates one clear consolidation point.
  - It reduces net complexity after the change.
  - It is validated by meaningful tests in the same PR.
- Do not require broad refactors for hypothetical future needs.

## Review checklist

- **Code cleanliness**: Is the implementation clean and well-structured?
- **DRY principle**: Does it avoid duplication?
- **Architectural smells**: Identify scattered logic or the same policy/resolution logic being defined in multiple places instead of one source of truth.
- **Code reuse**: Are there parts that should be reused from other places?
- **Organization**: Is everything in the right place?
- **Consistency**: Is it in the same style as other parts of the codebase?
- **Simplicity**: Is it not over-engineered? Remember KISS and YAGNI. No dead code paths, speculative abstractions, or fallback branches that hide broken invariants. No unnecessary catches.
- **No pointless wrappers**: Identify functions/methods that just call another function and return its result. Callers should call the underlying function directly instead of going through unnecessary indirection.
- **TypeScript and React style**: Does it preserve useful types, use functions and hooks where appropriate, and avoid unsafe casts, duplicated derived state, and effects that should be event-driven or computed?
- **Imports**: Are imports at the top of the file and free of avoidable circular dependencies?
- **Matrix correctness**: Do event relations, rapid edits/streaming, thread routes and summaries, compact/expanded timelines, and cached-to-live upgrades remain correct on every affected surface?
- **Isolation and persistence**: Are authentication, account-scoped state, service-worker messages, media, and caches isolated by the correct user/session identity and durable across reloads without leaking stale state?
- **Fork maintainability**: Does the change keep the upstream delta focused, use existing Cinny abstractions where sensible, and document fork-specific architecture or rebase-sensitive decisions in `FORK_CHANGES.md`?
- **User experience**: Does it provide a good user experience?
- **PR**: Is the PR description and title clear and informative?
- **Docs**: Are docs updated anywhere the change affects users, operators, developers, configuration, tooling, workflows, or behavior that someone would need to learn later? Missing required docs is a blocker.
- **Tests**: Are there meaningful behavioral and regression tests for the changes? Run focused Vitest files while reviewing and require the normal project gates before merge: `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`.
- **Live tests**: If feasible for user-visible room or thread behavior, run the client and exercise the affected flow against a Matrix homeserver. Check both room overview and thread banner surfaces when summaries, deep links, or room view modes change.
- **Rules**: Does the code follow `AGENTS.md` and the Runbook in `FORK_CHANGES.md`?

## How to review

Determine the real PR base instead of assuming `main`:

```bash
BASE=$(gh pr view --json baseRefName --jq .baseRefName)
git --no-pager diff "origin/$BASE...HEAD"
```

Use the merge-base (`...`) diff so the review matches the pull request. If there is no GitHub PR for the branch, identify the intended upstream base from the branch or user context and state that assumption.
