# Reference screenshots

Captured on 2026-11-02 from MindRoom Chat `dev` at `fc3a5905`, running locally against a disposable Tuwunel seeded with MindRoom-style content (`scripts/reference/seed.py` reproduces the data; `E2E_SEED_AGENT_AVATARS` and `E2E_SEED_PEOPLE_AVATARS` name its avatar folders, see the script). 1440x900 unless noted. These show the target look and behavior; the ported files implement most of what is MindRoom-specific here.

`home.png` is the exception: the MindRoom Chat capture credited the upstream client on its welcome page, so on 2026-11-04 it was retaken from this client at `ec95e01` with the same seed data and size. The MindRoom Chat capture stays in this file's history (`git log -- docs/design/reference/home.png`); `docs/design/m2-screenshots/V1-contact-sheet.png` and `V1-differences.png` ("Milestone screenshots" below) still show it, with that one credit masked.

| File | Shows |
|---|---|
| `home.png` | Signed-in home of this client (see above): icon rail, sidebar with Home header, Create Room, Join a Room, Message Search, ROOMS and THREADS sections, RECENTLY OPENED at the bottom, welcome page |
| `room-light.png` | Room in Compact mode: room header (avatar, name, topic, scheduled tasks, members, options), threads as equal-height bars (title with emoji and age, `Sender: 🔧 N tool · preview`, participants, tags, status, reply count), resolved thread tinted green with "Resolved by", members panel |
| `room-dark.png` | The same in dark mode |
| `room-mobile.png` | The same at 390x844, with a back button, bars with an options menu |
| `thread-light.png` | Thread view: collapsible thread banner (back, tags with remove and "+ tag", title, options, pin, resolve), messages with painted avatars, model badge under the agent avatar, "Ran 1 tool call web_search" rows with expand chevrons, Markdown table, "AI titled this thread" marker |
| `thread2-light.png` | Thread with a pending approval: "Running 2 tool calls read_file, run_shell_command" with a spinner, typing dots, and the approval bar above the composer ("code is waiting for you · run_shell_command", Review) |
| `thread3-light.png` | Thread with a streaming reply: running tool row, partial text, typing dots |
| `settings.png` | Settings dialog |

The thread filter bar at the top of `room-light.png` is part of the target without its view toggle: the Compact and Full switch moves to the room header. The screenshots show the bar in Simple Mode (Unresolved, Last Reply sort); this client has no Simple Mode and shows the full bar, with its status filters, presets, statistics, search, sort lock and tags in the same style. The Simple Mode setting is not part of the target.

## Milestone screenshots

The screenshots taken at the rewrite's milestones, `docs/design/m1-screenshots/`, `docs/design/m2-screenshots/` and `docs/design/m3-screenshots/`, have left the tree; `681ede140`, a commit of `main`, still has them. Read them from that commit, in the repository's root directory:

```sh
git ls-tree -r --name-only 681ede140 docs/design/m2-screenshots
git show 681ede140:docs/design/m2-screenshots/V1-contact-sheet.png > V1-contact-sheet.png
git archive 681ede140 docs/design/m1-screenshots docs/design/m2-screenshots docs/design/m3-screenshots | tar -x -C <directory>
```
