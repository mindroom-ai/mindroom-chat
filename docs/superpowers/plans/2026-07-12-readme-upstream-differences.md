# README Upstream Differences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the README comparison section so it accurately presents MindRoom Chat as an independently developed product built on Cinny.

**Architecture:** Keep the existing heading and anchor, then use a short positioning paragraph, a focused comparison table, and a closing upstream-policy paragraph. Preserve detailed implementation history in `FORK_CHANGES.md` instead of duplicating it in the README.

**Tech Stack:** Markdown, Prettier, Git

---

### Task 1: Rewrite the upstream-differences section

**Files:**

- Modify: `README.md:17`

- [x] **Step 1: Replace the existing comparison section**

Use this content:

```markdown
## What Is Different From Upstream Cinny

MindRoom Chat began as a Cinny fork, but it is now developed as an independent product for Matrix-based AI-agent workflows. It retains Cinny's Matrix foundation while owning its product direction, release cadence, native apps, deployment model, and MindRoom integrations.

| Area                   | MindRoom Chat direction                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Product                | Independent MindRoom branding, roadmap, defaults, onboarding, CI, and releases                                                                  |
| Agent workflows        | Streaming edit resolution, response cancellation, model/run metadata, collapsible tool traces, long-text sidecars, and `!` command autocomplete |
| Threads and navigation | Thread-aware composition, deep links, search, unread state, and timeline recovery tuned for long-running agent conversations                    |
| Calls and voice        | Agent-call flows built on MatrixRTC and embedded Element Call, including encrypted call-key handling and native microphone preflight            |
| Native iOS             | Capacitor packaging, Apple-oriented authentication, APNs/Sygnal push support, voice recording behavior, and App Store release tooling           |
| Deployment             | Runtime configuration and base-path support for root or subpath hosting, plus fork-owned Docker and release workflows                           |
| Engineering            | A large regression suite and a maintained compatibility ledger for product, Matrix SDK, deployment, and native-app changes                      |

Cinny remains the upstream foundation and is credited in [Upstream Attribution](#upstream-attribution). We continue to evaluate and incorporate compatible upstream improvements, while MindRoom Chat's product behavior and release decisions are owned here.

For the implementation history and rationale behind individual changes, see [`FORK_CHANGES.md`](./FORK_CHANGES.md).
```

- [x] **Step 2: Format the README**

Run:

```bash
npx prettier --write README.md
```

Expected: Prettier exits successfully and leaves the Markdown table valid.

- [x] **Step 3: Verify links, formatting, and diff hygiene**

Run:

```bash
npx prettier --check README.md docs/superpowers/specs/2026-07-12-readme-upstream-differences-design.md docs/superpowers/plans/2026-07-12-readme-upstream-differences.md
test -f FORK_CHANGES.md
rg -n '^## Upstream Attribution$' README.md
git diff --check
```

Expected: every command exits successfully; the heading search reports the Upstream Attribution section.

- [x] **Step 4: Review the final patch**

Run:

```bash
git diff -- README.md docs/superpowers/specs/2026-07-12-readme-upstream-differences-design.md docs/superpowers/plans/2026-07-12-readme-upstream-differences.md
```

Expected: the patch changes only the intended README section and adds the two workflow documents.

- [ ] **Step 5: Commit the implementation**

Run:

```bash
git add README.md docs/superpowers/plans/2026-07-12-readme-upstream-differences.md
git commit -m "docs: clarify differences from upstream Cinny"
```

Expected: Git creates the implementation commit with the README rewrite and implementation plan.
