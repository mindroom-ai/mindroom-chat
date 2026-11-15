# Interface Tour

Bas Nijholt asked on 2026-11-15 for "a super intuitive interface tour that highlights the different parts and is kind of like a tutorial". People who open MindRoom for the first time do not see what the threads are, how to start a new one, that a thread is a conversation of its own (as in Slack), that the cards carry a title an agent wrote, in what order they are listed, and what their states mean (streaming, snoozed, resolved). The tour "needs to have different levels. One is literally like one minute version, and maybe a five minute version", and to be "extremely well integrated and nice and professional looking".

## Understanding

- The tour teaches one model: a room holds threads, a thread is one conversation, the list shows a card per thread.
- Two levels: a Quick tour of about a minute that covers what was named above, and a Full tour of about five minutes that goes on to the rest of what people do with threads.
- It looks like the app: the app's own cards, glass surfaces, tokens, themes and motion, in every language the app has, on phones too, with a keyboard, and with reduced motion.
- People find it without being told: it is offered once, and it stays where help is looked for.

Assumptions (not said, chosen here):

- **The tour shows a sample room, not the room behind it.** A new account has no thread that streams, is snoozed or is resolved, often no thread at all, and may have no room open, so marks placed on the live page would point at nothing for exactly the people the tour is for. The tour is a dialog whose upper part, the stage, is a small room drawn with the app's own thread card and sample data; a spotlight moves over its parts and the text below explains them. What it shows is therefore the same for everyone, on any screen and theme.
- The stage demonstrates and is not operated: it is hidden from assistive technology and takes no focus, and the text of each step says everything the stage shows.
- The Quick tour is the first chapter of the Full tour. Its last step offers to go on with the rest, so nobody sees a step twice.
- The offer is made once per account, on whatever device comes first, to accounts that exist already too: for them it announces the tour.
- The Threads section of the rail is left out: its button is off unless a person turns it on in Settings.

## Scope

In:

- The tour dialog with its two levels, twelve steps and the animated stage.
- A one-time offer after sign-in, which a deployment can turn off.
- Three standing entries: the command palette, Settings (About), and a link in the box a Compact room shows while it has no thread.
- The seventeen language catalogs.

Out:

- Marks on the live page (coach marks). See the first assumption.
- Trying things in the stage (typing in its composer, clicking its cards).
- Tours of other parts of the app (calls, canvases, computers, Connections, settings). The step list is data, so a later tour adds steps and scenes; nothing here is built for that ahead of time.
- Remembering how far someone got. Closing the tour ends it; opening it starts at its first step.
- A setting to see the offer again. The entries above open the tour at any time.

## Behavior

### Offer

- A card in the page's notice place (`ui/noticeSlots.tsx`, where the sync status shows), under the new version notice when both show: a mark, "Take a tour of MindRoom", "See how threads work, in one minute or five.", the buttons **Quick tour** and **Full tour**, and a dismiss button.
- It shows when the account's `io.mindroom.settings` has no `tourOffered: true` and the deployment's `tour.offerAtStart` is not `false`.
- Either button opens the tour at that level; the dismiss button plays the card out. All three write `tourOffered: true`, and the card is gone at once, whether or not the write succeeds.
- It does not show on the sign-in pages, nor in the Quick Capture widget, which have no signed-in shell.

### Entries

- **Command palette:** "Take the quick tour" and "Take the full tour" (keywords: help, tutorial, guide, threads, onboarding).
- **Settings, About:** a "Tour" section with one tile, "See how threads work", and the two buttons. Starting a tour closes Settings.
- **A Compact room with no thread:** under "No threads", a link "How threads work", which opens the Quick tour.

### Dialog

- A centered dialog 720 px wide that ends below its content; on a phone it fills the screen. Escape, the close button and a click outside close it, as the app's other dialogs do. Focus stays inside and returns to where it was.
- From the top: a title row (the level's name, "Step 3 of 5", close), the stage, the chapter's name in small capitals, the step's title, its text, then a progress bar with one segment per step (a wider gap between chapters) beside **Back** and **Next**.
- The first step has no Back. The last step's main button is **Done**. The Quick tour's last step also has **Keep going**, which changes the level to Full and moves to the next step.
- ArrowRight and ArrowLeft move a step in the reading direction (mirrored in right-to-left languages), outside of a focused button's own keys. Next has the focus when the dialog opens, and keeps it from step to step.
- The step's title and text are in a live region, so a screen reader reads each step as it comes.
- On a phone the stage takes the height that is left and clips its lower cards; the text and the buttons stay at the bottom, within reach.

### Stage

- A room in Compact view at a small size: a header (the room's avatar and name "Marketing", the filter button, the view switch), the list of cards, and the composer with the app's placeholder. Cards are the app's `CompactThreadCard` with sample view models, so a change to the real card changes the tour's.
- A **spotlight** marks the part a step is about: a ring in the accent color around it and a soft dimming of the rest of the stage. It glides from one part to the next. A step about the whole list has no spotlight.
- Each step has a **scene**, which may play once through a few phases when the step comes (text typed into the composer, a card arriving, a card moving up). Back and Next start the scene of the step they go to from its first phase.
- With reduced motion a scene shows its last phase at once, the spotlight jumps, and nothing moves.
- The sample texts (room, names, titles, previews) are translated like the rest.

### Steps

Chapter **The basics** (the Quick tour):

| # | Step | Title | Text | Scene and spotlight |
|---|---|---|---|---|
| 1 | `conversation` | A thread is one conversation | Each card is a thread: one topic with all its messages together, like a chat of its own. A room holds as many as you need. | Four cards. Spotlight: the first card. |
| 2 | `start` | Type to start a new thread | Write in the box at the bottom of the room and send. Every message you send from there starts a new thread. | A message is typed into the composer and sent; its card arrives on top, an agent starts answering. Spotlight: the composer, then the new card. |
| 3 | `title` | Titles write themselves | A new thread shows your first message. Once an agent has replied, MindRoom gives it a short title. You can change it in the thread's menu. | The new card's title changes from the typed message to a short title. Spotlight: the title. |
| 4 | `order` | The latest activity comes first | The thread with the newest reply is on top, so the list moves as conversations do. Pinned threads stay above the rest. | A lower card gets a reply and moves to the top. Spotlight: that card. |
| 5 | `states` | A card shows where things stand | Four rows, each a mark and a line: **streaming** an agent is writing a reply; **unread** new replies, shown by the colored edge and time; **resolved** done; **snoozed** set aside until a time you picked. Then: Resolved and snoozed threads leave the list until you ask for them. | Four cards, one in each state. No spotlight. |

Chapter **Inside a thread**:

| # | Step | Title | Text | Scene and spotlight |
|---|---|---|---|---|
| 6 | `open` | Open a card to go on | Click a card to open its conversation. What you write there is a reply in that thread, not a new one. Back returns to the list. | The thread open: Back and the title, three messages, the reply box. Spotlight: the reply box. |

Chapter **Keeping the list tidy**:

| # | Step | Title | Text | Scene and spotlight |
|---|---|---|---|---|
| 7 | `resolve` | Resolve what is done | Use the check on a card, or swipe the card on a touch screen. The thread leaves the list and you can reopen it at any time. | A card with its buttons showing; it gets the resolved mark and leaves. Spotlight: the check. |
| 8 | `snooze` | Snooze what can wait | Thread options has Snooze. The thread stays away until the time you pick, then returns with a note that the snooze ended. | The card's menu open. Spotlight: Snooze. |
| 9 | `pinAndTag` | Pin and tag | Pin keeps a thread at the top of the list. Tags name what a thread is about, and you can filter by them. | A Pinned section above the list; cards with tags. Spotlight: the pinned card. |

Chapter **Finding your way**:

| # | Step | Title | Text | Scene and spotlight |
|---|---|---|---|---|
| 10 | `filters` | Filter and sort | The filter button in the room's header shows this bar. Unresolved leaves out what is done, the arrow turns the order around, and Advanced filters has the rest. | The filter bar under the header. Spotlight: the bar. |
| 11 | `views` | Two views of a room | Compact shows a card per thread. Threads shows the first message of each thread with its replies behind a chip. This button switches between them. | The list changes from cards to messages with reply chips. Spotlight: the view switch. |
| 12 | `activity` | The bell collects what needs you | Activity lists mentions, replies in your threads and agent runs that finished. Approvals, questions and invites are answered right there. | The bell with its list open: three rows. Spotlight: the bell. |

Every sentence above was checked against the app: Compact opens the thread a sent message starts (`room/useRoomViewThreadState.ts`); the title is the summary, else the root's text (`threads/overview/compactThreadCardViewModel.ts`), and the backend writes the first summary after one countable reply (`thread_summary_first_threshold`, default 1); the order is the last activity, newest first, pinned on top (`event-store/threads/threadRecordOverview.ts`); Compact leaves out resolved and snoozed threads until a filter is set (`room/useRoomViewThreadState.ts`); the swipe resolves on touch screens (`threads/overview/CompactRoomView.tsx`); the snooze's end is a thread message (`matrix/protocol/threadSnooze.ts`).

## Architecture

A new domain, `src/app/tour/`, in layer 10 (it renders the `threads` card); the atom that opens it lives in `navigation/`, so every layer above 4 can open the tour without importing it.

| File | Role |
|---|---|
| `src/app/navigation/tourState.ts` | `tourAtom`: `{ level: 'quick' \| 'full' } \| undefined`, undefined while closed. Reset on account exit (`shell/accountState.ts`) |
| `src/app/tour/tourSteps.ts` | Pure: the twelve steps in order (`id`, `chapter`, the phases' durations), `stepsOf(level)`, and the moves (`nextStep`, `previousStep`, `continueWithFull`) |
| `src/app/tour/tourSample.ts` | Pure: the sample room from `t` and a clock: the card view models of each scene |
| `src/app/tour/tourScenes.ts` | Pure: `sceneOf(stepId, phase, sample)`: what the stage shows (which view, which cards in which order, the composer's text, the open menu, the spotlight's target) |
| `src/app/tour/useScenePhase.ts` | The phase of the current step: advances on timers, starts over when the step changes, the last phase at once with reduced motion |
| `src/app/tour/TourStage.tsx`, `.css.ts` | Draws a scene: header, list, composer, and the scene's extras (open thread, menu, filter bar, messages view, bell list); marks its parts with `data-tour-part` |
| `src/app/tour/TourSpotlight.tsx` | Measures the part named by the scene inside the stage (layout offsets, so a card that is still moving is measured where it will rest; again on resize) and places the ring |
| `src/app/tour/useFlipList.ts` | Moves the cards from their old places to their new ones when the list's order changes (Web Animations; nothing with reduced motion or where `animate` is missing) |
| `src/app/tour/TourDialog.tsx`, `.css.ts` | The dialog: title row, stage, text, progress, buttons, keys |
| `src/app/tour/TourRenderer.tsx` | Mounted in `ClientShell`: renders the dialog, loaded on demand (`lazyPart`), while `tourAtom` is set |
| `src/app/tour/TourOffer.tsx`, `.css.ts` | Mounted in `ClientShell`: the offer card and its rule |
| `src/app/preferences/accountSettings.ts` | `tourOffered: boolean`, default false, beside the sidebar switches of `io.mindroom.settings` |
| `src/app/config/useClientConfig.ts` | `tour?: { offerAtStart?: boolean }` |

**Data flow.** An entry sets `tourAtom` to a level. `TourRenderer` renders `TourDialog`, which keeps the step's index in its own state, takes the steps from `stepsOf(level)` and the phase from `useScenePhase`, builds the scene with `sceneOf`, and hands it to `TourStage`. Closing sets `tourAtom` to undefined. Keep going sets the level to `full` and keeps the index, since the Quick tour's steps are the Full tour's first five.

**Offer rule.** `TourOffer` reads the account data event with `useAccountData` (which starts from what the client already holds, so an account that was offered the tour never sees the card for a frame) through `sanitizeAccountSettings`, and writes with `useSetAccountSettings`. A local "done here" state hides the card at once after any of its three buttons.

**The stage is not the app.** It imports the card (`threads/overview/CompactThreadCard.tsx`), its styles, the streaming dot and the tag pill, and draws the header, composer, menu, filter bar, message rows and bell list itself from folds and the glass primitives with the app's icons. It needs no Matrix client: sample avatars have no picture and show their fallback.

**Size.** The dialog and the stage load on demand, so the signed-in start grows only by the renderer, the offer and the atom.

**e2e.** The dev server's and the static build server's `config.json` (`scripts/e2e-client-config.mjs`, `e2e/helpers/staticBuildServer.ts`) set `tour.offerAtStart: false`, as they do for the recovery prompt, so no spec meets the card unasked.

## Error handling

- A failed `tourOffered` write is ignored: the card stays gone for this page, and the offer is made again at the next start.
- Account data that is not an object, or a `tourOffered` that is not a boolean, counts as not offered.
- A scene whose part is not in the stage (a step drawn without it) shows no spotlight.
- The dialog's part failing to load shows the app's "part unavailable" fallback of `lazyPart`, and closing works.

## Testing

Unit (vitest, beside each module):

- `tourSteps`: the Quick tour is the Full tour's first five steps, ids are unique, each step has English text, the moves stop at both ends, `continueWithFull` lands on step 6.
- `tourScenes`: each step's last phase has the cards, order and target the table above names; `start` puts the new card on top; `order` moves the replied card up; `resolve` drops the card.
- `tourSample`: the view models satisfy the card (rendered once in jsdom without errors), times are relative to the clock given.
- `useScenePhase`: advances with fake timers, starts over on a step change, jumps to the end with reduced motion.
- `accountSettings`: `tourOffered` is read, defaults to false, survives a merge with unknown keys.
- `TourOffer` (jsdom): shows without the flag; hidden with it, with `offerAtStart: false`; each button writes the flag and hides it; the two tour buttons set `tourAtom`.
- `TourDialog` (jsdom): Next, Back, Done, the arrow keys, Keep going, Escape; the step's text is in the live region; the stage is hidden from assistive technology.
- Entries: the command palette lists and runs both actions; About's buttons set the atom and close Settings; the empty Compact room's link sets the atom.
- `e2eClientConfig`: the override carries `tour.offerAtStart: false`.
- Locale overlays: the new keys in all seventeen (the existing parity tests).

e2e (`e2e/tour/tour.spec.ts`, disposable homeserver): with the offer switched on for the spec, a new account sees the card, Quick tour opens the dialog, Next through five steps, Keep going reaches step 6, Done closes; after a reload the card does not return. The command palette opens the Full tour. A phone viewport shows the dialog full screen with its buttons in view. Screenshots of the offer, three steps and the phone layout go on the pull request.
