# Command palette: fuzzy search that finds what was meant

Bas Nijholt asked on 2026-11-15, after the palette gained settings, pages and commands (`2026-11-15-command-palette-commands-design.md`), to "make the fuzzy finding and fuzzy searching much better".

## Understanding

- The palette's rooms, threads, people and actions are found with Fuse.js, one index per list, with one threshold per list. Settings and page choices are found by exact words, because Fuse brought them in for names of people (`john` listed Hide Membership Change).
- Better means: what a person types the way people type into a fuzzy finder (the start of a word, initials, an abbreviation, a typo, no accents, words in any order) puts the row they mean first, text that means nothing lists nothing, and a row shows which of its letters matched.

Assumptions (not said, chosen here):

- "Much better" is decided by a corpus of typed text with the rows a person expects, measured before and after, and by the time a keystroke takes on a large account.
- The server's message search, the Settings dialog's own search and the rows the palette offers stay as they are.
- One pull request.

## Scope

In:

- One matcher for rooms, threads, people, actions, settings and page choices, in place of Fuse.js and the exact-word search.
- Ranking by how the typed text matches, then by what the lists rank by today.
- The All tab puts the section with the best match first.
- The matched letters are marked in a row's title and in the line under it.
- A corpus of typed text as golden tests, and a measured time per keystroke.

Out:

- New rows or commands.
- The message search (the server's) and the Settings dialog's search (`searchSettings`), which keep their results.
- Transliteration between scripts (`tokyo` does not find `東京`), German `ue` for `ü`, and spelling variants of Arabic letters other than their marks.
- Learning from what a person chose before.

## Where today's search stands

The corpus (`command-palette/__fixtures__/searchCorpus.ts`) holds 361 cases over 41 rooms, 40 people, 16 threads and the real actions, settings and page choices in English, German and Japanese. Each case is typed text on a tab with the rows expected: the first row, rows among the first few, a row above another, rows that must be missing, or an empty tab.

Today's search (commit `328551ab0`, `commandPaletteSearch.corpus.test.ts` there) passes 259 of 361:

| Group | What it holds | Passes |
|---|---|---|
| names | a person's name brings no setting; text that means nothing lists nothing | 26 of 32 |
| prefix | the start of a name or of a word in it | 45 of 55 |
| acronym | initials and abbreviations (`crm`, `mf`, `js`, `engplat`) | 5 of 37 |
| typo | a wrong, missing, doubled or swapped letter | 20 of 38 |
| accent | text typed without the name's accents | 26 of 30 |
| words | several words, in any order, over several fields | 31 of 42 |
| scripts | Japanese, Russian, Arabic, Hebrew, Korean names; the app in German and Japanese | 50 of 56 |
| all | the row meant is first on the All tab | 24 of 37 |
| fields | search words, topics, tags, user IDs | 32 of 34 |

What fails, by cause:

- Fuse accepts one wrong letter in a word of three or four: `lisa` lists the room Platform Reliability and the command Show or hide the room list, `hime` lists Go Home, `zoe` puts Zoey above Zoë.
- No match on initials or abbreviations: `crm`, `mf`, `pz` find nothing.
- Fuse matches the typed text as one string, so `settings open`, `smith john` and `copy link` find nothing.
- Settings and page choices take no typo (`markdwon`, `dracla`), and always follow every action, so `dark` lists the Theme page above the Dark theme.
- The All tab keeps its sections in one order, so the thread "Theme contrast in dark mode" is the first row for `theme`, above the Theme command.
- On 5000 rooms and 5000 people a keystroke takes 58 ms (median of 39 typed texts; the slowest 143 ms), which is not instant.

## Approaches

1. **Fuse.js with other options**: its extended search for words in any order, `ignoreDiacritics`, a lower threshold. It has no match on initials or abbreviations, its tolerance is one share of the text's length for every length, and it is the slow part. It fixes two of the six causes.
2. **A fuzzy finder from npm** (`fzf`, `fuzzysort`, `uFuzzy`; all MIT or BSD). Each matches letters in order and scores gaps, which finds `crm`, and none of them takes a swapped or wrong letter, folds accents with positions kept, or searches several weighted fields with every word required. The palette would wrap one of them in as much code as a matcher of its own.
3. **A matcher of its own** (chosen): about 400 lines without dependencies, whose rules are the ones below and nothing else, so every rank can be explained and tested. Fuse.js stays a dependency for the invite dialog (`members/userDirectorySearch.ts`).

## Behavior

### What matches

- The typed text is split at spaces into words. A row matches when every word matches one of its fields; the words may match different fields and come in any order.
- Text is compared folded: lower case, Latin, Greek and Cyrillic letters without their accents (`é`, `ü`, `ё`), `ß` as `ss`, `æ` as `ae`, `œ` as `oe`, `ø` as `o`, `đ` and `ð` as `d`, `þ` as `th`, `ł` as `l`, `ı` as `i`, and Arabic and Hebrew letters without their vowel marks. Marks that change a word in other scripts stay, as in the Settings search.
- A word of a field starts after a character that is no letter or digit, and at a capital letter after a small one (`MindRoom` is `Mind` and `Room`). In Chinese, Japanese, Thai, Lao, Khmer and Burmese text, which is written without spaces, every character starts a word.
- One typed word matches a field in one of these ways, best first:

| Way | Example | Fields |
|---|---|---|
| the whole field | `theme` for Theme | all |
| the start of the field | `plat` for Platform Reliability | all |
| the start of a later word | `plat` for Engineering Platform | all |
| initials of words that follow each other | `cr` for Create Room, `js` for John Smith | names |
| inside a word | `room` for mindroom-dev | all (three letters or more outside names) |
| a typo | `markdwon` for Markdown, `jhon` for John | all |
| an abbreviation | `crm` for Create Room, `stgs` for Settings | names |

- "Names" are the fields a row is called by: a room's name, a person's display name and user name, an action's title. The other fields (topic, alias, parent spaces, search words, description, tags, room of a thread, user ID) and a thread's title, which is a sentence, take no initials and no abbreviations.
- A typed word that ends where the field's word ends counts as the whole word and goes above a longer word that starts the same (`john` puts John Smith above Johnny Appleseed and the room Johnson Account).
- **Typos.** The first letter must be right. A word of up to three letters takes no typo. A word of four letters takes two neighboring letters swapped (`jhon`), nothing else. A word of five to eight letters takes one typo, and one of nine or more takes two; a typo is a letter that is wrong, missing or extra, or two neighbors swapped. The typed word is compared with a whole word of the field; from seven letters on also with the start of a longer word, so a typo does not hide the row while the word is still being typed.
- **Abbreviations.** Three letters or more. The first letter starts a word of the name; every later letter comes later in that same word or starts a later word (`crm`: `C`reate `R`oo`m`).

### Order

- Rows are ordered by their score: the mean over the typed words of each word's best match, where a match in a field that is not a name counts for a share of its value (search words and tags 0.7, a person's user name 0.8, an alias 0.9, the rest 0.5). Typed text that a name holds as a whole, in order, counts as that one match.
- Inside one way of matching, a word the typed text covers more of, and a word nearer the field's start, go first.
- Then, as today: a small share for the row's boost (an unread room, an open direct chat), the row's rank (a room's activity, an action's rank), and the ID.
- Actions, settings and page choices are one list ranked together, so `dark` puts the Dark theme, whose name it is, above the Theme page, which has it as a search word. A page choice is also found by its page's title (`theme dracula`).
- People from the server's user directory are ranked with the local ones by the same score; those the local rules do not match (the server found them its own way) go last, in the server's order.
- A person's user name counts without MindRoom's agent prefix, and typed text may carry it (`mindroom_code` finds Code), so `mind` and `room` list no agent.

### The All tab

- With text typed, the sections keep the order rooms, threads, people, actions, except that a section whose first row matches better goes first: a name that is the typed text, then a name that holds every typed word at word starts or as initials, then everything else. Sections of the same grade keep their order.
- Only what the client holds decides the order, so a section never moves when the server's people or messages arrive. Messages stay last.
- The sections' sizes stay (5 rooms, 3 threads, 3 people, 3 actions).

### Marks

- The letters of a row that matched the typed text are marked in its title, and in the line under it when that line is the field that matched (a room's topic or alias, a person's user ID, a thread's room, an action's description).
- A mark changes the letters' color and underlines them. The weight stays, so the row keeps its width and Arabic letters keep their joins.
- A title shown differently from the field (a name with direction controls revealed, a Matrix ID typed in full) carries no marks.

### What stays

- Without text, every list and its order.
- The limits of the sections and tabs.
- The Settings dialog's search.

## Design

### Units

| File | What it does |
|---|---|
| `command-palette/fuzzyMatch.ts` (new) | Pure, no app types. `foldText`, `prepareText` (the folded text with its word starts and ends), `matchWord` (one typed word against one prepared text: a score and the matched ranges, or nothing), `originalRanges` (ranges of folded text as ranges of the text as written). |
| `command-palette/commandPaletteSearch.ts` | The fields of each list with their weights (`commandPaletteSearchConfig`), `matchCommandPaletteSection` (the matches of a list for typed text: item, score, marks per field, best first) and `searchCommandPaletteSection` (their items). An index of prepared fields per list, kept while the list keeps its identity. Fuse.js goes. |
| `command-palette/commandPaletteResults.ts` (new) | Pure: `getCommandPaletteLocalSections` gives the rooms, threads, people and actions of a tab for typed text, in the order shown, with their marks. `rankCommandPalettePeople` ranks local and server people together. The corpus tests run on it. |
| `command-palette/commandPalettePeopleRanking.ts` | Removed: the one score ranks people. |
| `command-palette/useCommandPaletteCommands.ts`, `commandPaletteItems.ts` | `searchCommands(text)` becomes `commands`, the rows only typed text finds (settings, page choices), which the palette searches with the actions. |
| `command-palette/commandPalettePages.ts` | A tagged page choice carries its page's title as a search word. |
| `command-palette/CommandPalette.tsx` | Builds its sections from `getCommandPaletteLocalSections`. |
| `command-palette/CommandPaletteList.tsx`, `CommandPalette.css.ts` | Draws the marks (`TitleMatch`). |

### Data flow

`CommandPalette` passes the source, the tab and the typed text to `getCommandPaletteLocalSections`. Each list is prepared once per list identity (a `WeakMap`), scored per keystroke, sorted and cut to the section's limit; the marks of the rows that remain are mapped back to the text as written. The sections carry `marks` by row ID to `CommandPaletteList`.

### Speed

Per keystroke each row costs a few `indexOf` calls; the initials, typo and abbreviation checks run only for a word no field holds, and each starts with a first-letter test. The index holds the folded text and one flag per character. The corpus test of the load fixture (5000 rooms, 5000 people) states the time.

## Testing

- Unit: `fuzzyMatch` (folding with positions, each way of matching, the typo lengths, ranges), `commandPaletteSearch` (fields, weights, order, boost, marks), `commandPaletteResults` (sections, All's order, people merged with the server's), the list (marks drawn, none on a changed title), the commands hook (a name finds no command).
- Golden: every corpus case, and the load fixture under a generous bound.
- e2e (`e2e/command-palette/command-palette-fuzzy.spec.ts`): initials, a typo and accent-free text find their rows with marks; a name lists no setting; the All tab opens the Dark theme for `dark`.
