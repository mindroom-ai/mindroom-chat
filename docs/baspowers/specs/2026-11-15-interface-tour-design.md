# Interface Tour

Bas Nijholt asked on 2026-11-15 for "a super intuitive interface tour that highlights the different parts and is kind of like a tutorial". People who open MindRoom for the first time do not see what the threads are, how to start a new one, that a thread is a conversation of its own (as in Slack), that the cards carry a title an agent wrote, in what order they are listed, and what their states mean (streaming, snoozed, resolved). The tour "needs to have different levels. One is literally like one minute version, and maybe a five minute version", and to be "extremely well integrated and nice and professional looking".

Two other models reviewed the first draft of this page (GPT-6.1 Sol and Gemini 4 Carbon); what they found is worked in, and what was declined is listed under Scope.

## Understanding

- The tour teaches one model: a room holds threads, a thread is one conversation, the list shows a card per thread.
- Two levels: a Quick tour of about a minute that covers what was named above, and a Full tour of about five minutes that goes on to the rest of what people do with threads.
- It looks like the app: the app's own cards, glass surfaces, tokens, themes and motion, in every language the app has, on phones too, with a keyboard, and with reduced motion.
- People find it without being told: it is offered until they answer, and it stays where help is looked for.

Assumptions (not said, chosen here):

- **The tour shows a sample room, not the room behind it.** A new account has no thread that streams, is snoozed or is resolved, often no thread at all, and may have no room open, so marks placed on the live page would point at nothing for exactly the people the tour is for. The tour is a dialog whose upper part, the stage, is a small room drawn with the app's own thread card and sample data; a spotlight moves over its parts and the text below explains them. Both reviewers kept this choice, and both asked for a way back to the real room at the end: Done hands over to the real composer (see Handoff).
- The stage demonstrates and is not operated: it is inert, and the text of each step says everything the stage shows.
- The Quick tour is the first chapter of the Full tour. Its last step offers to go on with the rest, so nobody sees a step twice.
- The offer goes to accounts that exist already too: for them it announces the tour.
- The Threads section of the rail is left out: its button is off unless a person turns it on in Settings.

## Scope

In:

- The tour dialog with its two levels, twelve steps and the animated stage.
- An offer after sign-in, shown until it is answered, which a deployment can turn off.
- Four standing entries: the command palette, Settings (About), the welcome page, and the box a Compact room shows while it has no thread.
- The handoff to the real composer.
- The seventeen language catalogs.

Out:

- Marks on the live page beyond the handoff's one ring (coach marks). See the first assumption.
- Trying things in the stage (typing in its composer, clicking its cards).
- Tours of other parts of the app (calls, canvases, computers, Connections, settings). The step list is data, so a later tour adds steps and scenes; nothing here is built for that ahead of time.
- Remembering how far someone got. Closing the tour ends it; opening it starts at its first step, also when it is opened while it is open (the command palette opens over it).
- A setting to see the offer again. The entries open the tour at any time.
- Declined from the reviews: showing all three sort modes (the text names the button, the bar shows it); translated search keywords for the palette (its other actions have English ones, and the translated title matches); opening a room for someone who finishes on the welcome page ("Start in <room>": which room is a guess); a focus target of the tour's own for an entry that is gone when the tour closes (the app's dialogs leave that to `lib/overlayFocus.ts`).

## Behavior

### Offer

- A card where the new version notice shows (`ui/noticeSlots.tsx`): at the foot of the room list while there is one beside the page, else at the top of the page, under a phone's top bar. Both cards can show; the list's place stacks them, the new version notice below.
- On it: a mark, "Take a tour of MindRoom", "See how threads, titles and states work.", the buttons **Quick tour (1 min)** and **Full tour (5 min)**, and a dismiss button.
- It shows when all of these hold: the account's `io.mindroom.settings` has no `tourOffered: true`; the client has synced with its server since the page started (`useSyncedWithServer`: the app counts a start from the stored copy of the last session as ready before that, with account data as old as that copy), so account data that is not there yet, or is older than another device's answer, never shows the card; the deployment's `tour.offerAtStart` is not `false`; the account was not answered for on this page.
- **Answered** means: one of its three buttons, or the tour opened from anywhere. The card plays out (or is not shown), the account is remembered as answered for the life of the page, and `tourOffered: true` is written once the client has synced with its server. The write merges over the stored content, so it never runs before that content is known.
- On a phone the card waits while the drawer covers its place, as the new version notice does.
- A card nobody answered shows again at the next start, and on another device until one of them answers.
- It does not show on the sign-in pages, nor in the Quick Capture widget, which have no signed-in shell.

### Entries

- **Command palette:** "Take the quick tour" and "Take the full tour" (keywords: help, tutorial, guide, threads, onboarding).
- **Settings, About:** a "Tour" section with one tile, "See how threads work", and the two buttons; Settings search finds it. Starting a tour closes Settings.
- **Welcome page:** a "How threads work" link with the page's other links, which opens the Quick tour.
- **A Compact room with no thread:** the box reads "No threads", then "Send a message below to start one.", then a link "How threads work", which opens the Quick tour.

### Dialog

- A centered dialog 720 px wide; on a phone it fills the screen. Escape, the close button and a click outside close it, as the app's other dialogs do. Focus stays inside; it returns to the control that opened the tour when that is still there.
- From the top: a title row (the level's name, "Step 3 of 6", close), the stage, the chapter's name in small capitals, the step's title, its text, then the progress bar on a row of its own (one segment per step, a wider gap between chapters), then the buttons.
- **Nothing jumps.** The stage has one height for every step, and the text block is as tall as the tallest step's text at the dialog's width, so Back and Next stay under the pointer from step to step. On a phone the stage takes the height left over.
- **Buttons.** Back (none on the first step) and Next. The last step's main button is **Done**. The Quick tour's last step has Done as its main button and beside it **Keep going (6 more steps)**, which changes the level to Full and moves to step 7.
- **Keys.** ArrowRight and ArrowLeft move a step in the reading direction (mirrored in right-to-left languages) and stop at the level's ends. The main button has the focus when the dialog opens and from step to step, so Enter goes on.
- The step's title and text are a live region, so a screen reader reads each step as it comes, after "Step 3 of 6" and the chapter's name, which it would otherwise only find by looking. A live region says only what changes, so the dialog is also described by the step's text, which is read with the dialog's name as the tour opens. The text names each control by its label and place, never as "this button".
- **The recovery prompt waits.** The app's own opening of the recovery password dialog (`EncryptionRecoveryPrompt`) holds back while the tour is open and opens when it closes.

### Stage

- A room in Compact view at a small size: a header (the room's avatar and name, the Thread filters button, the Compact view button, the room menu), the list of cards, and the composer with the app's placeholder. Cards are the app's `CompactThreadCard` with sample view models, so a change to the real card changes the tour's.
- **On a phone the stage is a phone's room:** a back chevron, the name and the room menu in its header, no buttons that show on pointing at a card, and the bell in a top bar instead of on the rail.
- A **spotlight** marks the part a step is about: the part stays as it is, a ring in the accent color goes around it, and the rest of the stage fades toward the stage's own color (a dark shade over a light stage reads as a fault; the ring carries the mark). The ring glides from one part to the next. A step about the whole list has no spotlight.
- Each step has a **scene** that plays once through a few phases (text typed into the composer, the thread opening, a card moving up). It starts 450 ms after the step comes, so the eye is on the stage. Once a scene with more than one phase has played, a **Replay** button shows at the end of the chapter's row, under the stage (in the stage's corner it covered the composer's send button). A change of what the stage shows (the list, an open thread, the Threads view) cross-fades.
- **The part a step is about is always in view.** The room is drawn at one size and scaled down to the stage's height where that is less (never below 0.6), and a scene shows only as much of the room as fits: on a phone the scene of the states has neither header nor composer, so that its four cards fit.
- With reduced motion a scene shows its last phase at once, there is no Replay, the spotlight jumps, and nothing moves.
- The sample texts (room, names, titles, previews) are translated like the rest.

### Steps

Chapter **The basics** (the Quick tour):

| # | Step | Title | Text | Scene and spotlight |
|---|---|---|---|---|
| 1 | `conversation` | A thread is one conversation | Most rooms with agents open in Compact view. Each card is one thread: a single topic with all its replies together. A room holds as many as you need. | Four cards. Spotlight: the first card. |
| 2 | `start` | Type to start a new thread | Write in the box at the bottom of the room and send. That starts a new thread, and it opens right away. | A message is typed into the composer and sent; the new thread opens with the message and an agent answering. Spotlight: the composer, then the open thread. |
| 3 | `reply` | Inside a thread, you reply | What you write in an open thread is a reply there, not a new thread. Back returns to the list, where any card opens its thread again. | The open thread: the reply box, then Back, then the list with the new card on top. Spotlight: the reply box, Back, the new card. |
| 4 | `title` | AI writes the titles | A new card shows your first message. After an agent replies, MindRoom's AI gives the thread a short title. Edit summary in Thread options changes it. | The new card's title changes from the typed message to a short title. Spotlight: the title. |
| 5 | `order` | The latest activity comes first | A thread moves to the top when it gets a new message, so what is active comes first. Pinned threads stay above the rest. | A lower card gets a reply and moves to the top. Spotlight: that card. |
| 6 | `states` | A card shows where its thread stands | Four rows, each a mark and a line. **streaming**: an agent is replying now. **unread**: new replies, with a colored edge and time. **resolved**: done; Compact hides it. **snoozed**: hidden until its time, then back by itself. | Four cards, one in each state. No spotlight. |

Chapter **Keeping the list tidy**:

| # | Step | Title | Text | Scene and spotlight |
|---|---|---|---|---|
| 7 | `resolve` | Resolve what is done | Press Resolve, the check on a card, or swipe the card on a touch screen. The thread leaves the list, and you can reopen it at any time. | A card with its buttons showing (a phone: the card swiped); it gets the resolved mark and leaves. Spotlight: the check (a phone: the card). |
| 8 | `snooze` | Snooze what can wait | In Thread options (⋯), pick Snooze. The thread hides until the time you choose, then returns with a note that the snooze ended. | The card's Thread options button, then its menu open. Spotlight: the button, then Snooze. |
| 9 | `pinAndTag` | Pin and tag | Pin keeps a thread at the top of the list. Edit tags in Thread options labels a thread, and you can filter by tag. | A Pinned section above the list; cards with tags. Spotlight: the pinned card. |

Chapter **Finding your way**:

| # | Step | Title | Text | Scene and spotlight |
|---|---|---|---|---|
| 10 | `filters` | Filter and sort | Thread filters, in the room's header or its menu, shows and hides this bar. Unresolved hides what is done, Last Reply changes the order, and the filter icon at the bar's end opens Advanced filters, which find the rest, snoozed threads too. | The filter bar under the header (a phone: the room menu open first). Spotlight: the button, then the bar. |
| 11 | `views` | Two views of a room | Compact shows one card per thread. Threads shows each thread's first message with its reply count under it. Compact view, in the room's header or its menu, switches. | The list changes from cards to messages with reply counts. Spotlight: the Compact view button (a phone: the room menu's entry). |
| 12 | `activity` | Activity collects what needs you | The bell opens Activity: mentions, replies in your threads and agent runs that finished. Approvals, questions and invites are answered right there. | The bell with its list open: three rows. Spotlight: the bell. |

Every sentence above was checked against the app: a room with agents opens in Compact unless its `io.mindroom.thread_mode` is `room` (`navigation/useRoomViewMode.ts`); Compact opens the thread a sent message starts (`handleRoomMessageSent` in `room/useRoomViewThreadState.ts`); the title is the summary, else the root's text (`threads/overview/compactThreadCardViewModel.ts`), the backend writes the first summary after `thread_summary_first_threshold` countable replies (1 unless configured), and the menu's entry is "Edit summary"; the order is the last activity, newest first, pinned on top (`event-store/threads/threadRecordOverview.ts`, `threadRecord.ts`); Compact leaves out resolved and snoozed threads until a filter is set, and the Unresolved switch brings back only the resolved (`room/useRoomViewThreadState.ts`); the sort button reads "Last Reply" and goes through newest, oldest and natural order (`cycleSortMode`); touch screens hide the check and swipe instead (`threads/overview/CompactRoomView.css.ts`); a phone keeps Thread filters and Compact view in the room menu (`room/roomHeaderActions.tsx`); the filter bar shows unless a person hid it (`hideThreadFilterBar`), and Advanced filters is a button with an icon alone (`threads/overview/RoomThreadOverview.tsx`); the snooze's end is a thread message (`matrix/protocol/threadSnooze.ts`).

### Handoff

- **Done** (not Escape, the close button or a click outside) on the last step of either level hands over: when a room's own composer is on the page and can be typed in, the tour's ring pulses twice around it, and on a screen without touch the composer takes the focus, so typing starts a thread.
- With reduced motion there is no pulse. Without such a composer nothing happens: no room on the page, or a thread that fills it, whose reply box would take what is typed. `ConversationLayout` marks each footer as a room's or a thread's (`data-footer-of`) for this.

## Architecture

A new domain, `src/app/tour/`, in layer 12 beside `settings` (it renders the `threads` card and uses `room`'s Compact view icon); the atom that opens it lives in `navigation/`, so `timeline`, `command-palette`, `settings` and `shell` open the tour without importing it.

| File | Role |
|---|---|
| `src/app/navigation/tourState.ts` | `tourAtom`: `{ level: 'quick' \| 'full' } \| undefined`, undefined while closed. Reset on account exit (`shell/accountState.ts`) |
| `src/app/tour/tourSteps.ts` | Pure: the twelve steps in order (`id`, `chapter`, the phases' durations), `stepsOf(level)`, and the moves (`nextStep`, `previousStep`) |
| `src/app/tour/tourSample.ts` | Pure: the sample room from `t` and a clock: the card view models and the messages of each scene |
| `src/app/tour/tourScenes.ts` | Pure: `sceneOf(stepId, phase, phone)`: what the stage shows (which view, which chrome, which cards in which order, the composer's text, the open menu, the spotlight's part) |
| `src/app/tour/useScenePhase.ts` | The phase of the current step: starts after the delay, advances on timers, starts over when the step changes or on Replay, the last phase at once with reduced motion |
| `src/app/tour/TourStage.tsx`, `TourStageRoom.tsx`, `TourStage.css.ts` | The frame that scales the room to fit and cross-fades its views, and the room itself: header, list, composer, and the scene's extras (open thread, menu, filter bar, messages view, bell list); marks its parts with `data-tour-part`; inert (`lib/hooks/useInert.ts`) |
| `src/app/tour/tourMotion.ts` | Whether motion is reduced, whether the pointer is coarse, and the times the scripted animations share |
| `src/app/tour/TourSpotlight.tsx` | Measures the part named by the scene inside the stage (layout offsets, so a card that is still moving is measured where it will rest; again on resize) and places the ring |
| `src/app/tour/useFlipList.ts` | Moves the cards from their old places to their new ones when the list's order changes (Web Animations; nothing with reduced motion or where `animate` is missing) |
| `src/app/tour/TourDialog.tsx`, `.css.ts` | The dialog: title row, stage, text, progress, buttons, keys |
| `src/app/tour/TourRenderer.tsx` | Mounted in `ClientShell`: the dialog while `tourAtom` is set, and the handoff after Done |
| `src/app/tour/TourHandoff.tsx`, `.css.ts` | The pulse around the real composer (`[data-room-footer] [data-editable-name="RoomInput"]`) and its focus |
| `src/app/tour/TourOffer.tsx`, `.css.ts` | Mounted in `ClientShell`: the offer card and its rule |
| `src/app/ui/noticeSlots.tsx` | `useNoticePresence(due, phoneLayer)`: where a notice card shows and how it comes and goes (the list's place else the page's, held back while a phone's drawer covers it, leaving from where it was), taken out of `NewVersionNotice`, which uses it too. The caller hands in whether a phone's layer is open, which `navigation` knows and `ui`, a layer below it, may not import |
| `src/app/matrix/hooks/useSyncedWithServer.ts` | Whether the client has synced with its server since the page started |
| `src/app/preferences/accountSettings.ts` | `tourOffered: boolean`, default false, beside the sidebar switches of `io.mindroom.settings` |
| `src/app/config/useClientConfig.ts` | `tour?: { offerAtStart?: boolean }` |
| `src/app/account/encryption/EncryptionRecoveryPrompt.tsx` | Holds back while `tourAtom` is set |

**Data flow.** An entry sets `tourAtom` to a level. `TourRenderer` renders `TourDialog`, which keeps the step's index in its own state, takes the steps from `stepsOf(level)` and the phase from `useScenePhase`, builds the scene with `sceneOf`, and hands it to `TourStage`. Closing sets `tourAtom` to undefined. Keep going sets the level to `full` and moves on one step: the Quick tour's steps are the Full tour's first six.

**Offer rule.** `TourOffer` reads the account data event with `useAccountData` (which starts from what the client holds, so there is no frame without it) through `sanitizeAccountSettings`. Answered accounts are a module-level set of user IDs, as the recovery prompt keeps its prompted accounts, so a switch of account and back does not show the card again. One effect writes the flag with `useSetAccountSettings` when the account is answered, the client has synced with its server and the stored flag is not set.

**The stage is not the app.** It imports the card (`threads/overview/CompactThreadCard.tsx`), its styles, the streaming dot, the tag pill and the Compact view icon, and draws the header, composer, menu, filter bar, message rows and bell list itself from folds and the glass primitives with the app's icons and labels. It needs no Matrix client: sample avatars have no picture and show their fallback.

**Size.** The tour is part of the signed-in pages' chunk, as the Settings dialog is: no loading state and no failed load of its own. `just bundle-report` after the build says what it adds.

**e2e.** The dev server's and the static build server's `config.json` (`scripts/e2e-client-config.mjs`, `e2e/helpers/staticBuildServer.ts`) set `tour.offerAtStart: false`, as they do for the recovery prompt, so no spec meets the card unasked.

## Error handling

- A failed `tourOffered` write is ignored: the card stays gone for this page, and the offer is made again at the next start.
- Account data that is not an object, or a `tourOffered` that is not a boolean, counts as not offered.
- A scene whose part is not in the stage shows no spotlight.
- A handoff that finds no composer does nothing.

## Testing

Unit (vitest, beside each module):

- `tourSteps`: the Quick tour is the Full tour's first six steps, ids are unique, each step has English text, the moves stop at both ends.
- `tourScenes`: each step's last phase has the view, cards, order and part the tables name, for a phone and a wider screen; `start` ends in the open thread; `reply` ends in the list with the new card on top; `order` moves the replied card up; `resolve` drops the card; `states` has no header and no composer.
- `tourSample`: the view models satisfy the card (rendered in jsdom), times are relative to the clock given, no pinned card is resolved or snoozed.
- `useScenePhase`: waits the delay, advances with fake timers, starts over on a step change and on Replay, jumps to the end with reduced motion.
- `accountSettings`: `tourOffered` is read, defaults to false, survives a merge with unknown keys.
- `TourOffer` (jsdom): hidden before the client has synced with its server, also when that sync then brings `tourOffered: true`; shown after it without the flag; hidden with the flag, with `offerAtStart: false`, and when another device's answer arrives; each button hides it and writes the flag, and no write runs before the client has synced; the tour opening from elsewhere answers it; account A answered, then B, then A again shows nothing for A.
- `useNoticePresence` through `NewVersionNotice`'s existing tests, unchanged, and two cards in the list's place.
- `TourDialog` (jsdom): Next, Back, Done, the arrow keys in both directions of writing, Keep going, Escape; the main button has the focus on opening and after each step; Tab never reaches a control of the stage; the step's text is in the live region; Replay starts the scene over.
- `TourHandoff` (jsdom): Done with a room's composer on the page focuses it, passing over a thread's beside it; Escape does not; no composer, or the room's under a thread that fills the page, nothing.
- `EncryptionRecoveryPrompt`: holds back while the tour is open, in both orders (the tour opens while the server check is pending; the check settles first), and opens after the tour closes.
- Entries: the command palette lists and runs both actions; About's buttons set the atom and close Settings, and Settings search finds the tile; the welcome page's link and the empty Compact room's link set the atom.
- `e2eClientConfig`: the override carries `tour.offerAtStart: false`.
- Locale overlays: the new keys in all seventeen (the existing parity tests).

e2e: `e2e/tour/tour.spec.ts` (disposable homeserver), with the offer switched on for the spec: a new account sees the card, Quick tour opens the dialog, six steps, Keep going reaches step 7, Done closes and the room's composer has the focus; after a reload the card does not return; a dismissed card stays away and the command palette opens the Full tour, whose stage Tab never enters. `e2e/tour/tour-layout.spec.ts` (the fixture page `e2e/fixtures/tour.html`, no homeserver): at 375 by 667, at 1280 by 800 and in Arabic, every step's part lies inside the stage, the four state cards are all in view, and the buttons are in view and do not move between steps. Screenshots of the offer, four steps and the phone layout go on the pull request.
