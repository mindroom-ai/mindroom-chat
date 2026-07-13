# README Upstream Differences Design

## Goal

Update the README's "What Is Different From Upstream Cinny" section so it
accurately presents MindRoom Chat as an independently developed product built
on Cinny, rather than as a lightly branded fork.

## Content

- Retain the existing heading and anchor.
- Open with a short statement describing the independent product direction and
  continued Cinny foundation.
- Summarize the major areas of divergence: AI-agent workflows, Matrix message
  and thread behavior, calls and voice, native iOS and push support, deployment,
  and project ownership.
- Keep the comparison concise and direct readers to `FORK_CHANGES.md` for the
  implementation history.
- Close with an explicit upstream relationship statement: Cinny remains
  credited, and compatible upstream improvements can still be incorporated.

## Constraints

- Do not imply that MindRoom Chat has abandoned Cinny or Matrix compatibility.
- Do not turn the README into an exhaustive changelog.
- Do not rename protocol, storage, CLI, or service identifiers that retain
  Cinny naming for compatibility.

## Verification

- Render-check the Markdown structure and links.
- Run the repository's formatting check for the changed Markdown files.
- Run `git diff --check`.
