import { it } from 'vitest';
import { foldSearchText, searchSettings } from '../settings/settingsSearchIndex';
import { SEARCH_CORPUS, checkCorpusCase, type CorpusCase } from './__fixtures__/searchCorpus';
import { getCorpusSource, type CorpusSource } from './__fixtures__/searchCorpusSource';
import { rankCommandPalettePeople } from './commandPalettePeopleRanking';
import {
  getCommandPaletteSectionLimit,
  getCommandPaletteSectionOrder,
} from './commandPaletteQuery';
import { commandPaletteSearchConfig, searchCommandPaletteSection } from './commandPaletteSearch';
import type { CommandPaletteSectionId } from './commandPaletteTypes';

// Today's search, as CommandPalette.tsx and useCommandPaletteCommands.ts put it together.
const searchCommands = (source: CorpusSource, text: string): string[] => {
  const folded = foldSearchText(text);
  if (!folded) return [];
  const rowIds = new Set(source.settingRows.map((row) => row.id));
  const settings = searchSettings(text, source.shownSettings, source.t, source.searchValues)
    .map(({ setting }) => `setting:${setting.id}`)
    .filter((id) => rowIds.has(id));
  const choices = source.choiceRows
    .filter((row) => foldSearchText(row.title).includes(folded))
    .map((row) => row.id);
  return [...settings, ...choices];
};

const sectionRows = (
  source: CorpusSource,
  sectionId: Exclude<CommandPaletteSectionId, 'messages'>,
  tab: CorpusCase['tab'],
  text: string
): string[] => {
  const limit = getCommandPaletteSectionLimit(sectionId, tab);
  const ids = (items: readonly { id: string }[]) => items.map((item) => item.id);
  switch (sectionId) {
    case 'actions':
      return [
        ...ids(
          searchCommandPaletteSection({
            items: source.actions,
            query: text,
            config: { ...commandPaletteSearchConfig.actions, limit },
          })
        ),
        ...searchCommands(source, text),
      ].slice(0, limit);
    case 'threads':
      return ids(
        searchCommandPaletteSection({
          items: source.threads,
          query: text,
          config: { ...commandPaletteSearchConfig.threads, limit },
        })
      );
    case 'rooms':
      return ids(
        searchCommandPaletteSection({
          items: source.rooms,
          query: text,
          config: { ...commandPaletteSearchConfig.rooms, limit },
        })
      );
    default:
      return ids(
        rankCommandPalettePeople(
          searchCommandPaletteSection({
            items: source.users,
            query: text,
            config: { ...commandPaletteSearchConfig.users, limit: Number.POSITIVE_INFINITY },
          }),
          text
        ).slice(0, limit)
      );
  }
};

const rowsOf = (testCase: CorpusCase): string[] => {
  const source = getCorpusSource(testCase.language ?? 'en');
  return getCommandPaletteSectionOrder(testCase.tab, true)
    .filter((id): id is Exclude<CommandPaletteSectionId, 'messages'> => id !== 'messages')
    .flatMap((sectionId) => sectionRows(source, sectionId, testCase.tab, testCase.query));
};

it("reports how today's search does on the corpus", () => {
  const totals = new Map<string, { pass: number; total: number }>();
  const lines: string[] = [];
  SEARCH_CORPUS.forEach((testCase) => {
    const rows = rowsOf(testCase);
    const failures = checkCorpusCase(testCase, rows);
    const total = totals.get(testCase.group) ?? { pass: 0, total: 0 };
    total.total += 1;
    if (failures.length === 0) total.pass += 1;
    else
      lines.push(
        `${testCase.group} ${testCase.language ?? 'en'} ${testCase.tab} "${
          testCase.query
        }": ${failures.join('; ')}  [${rows.slice(0, 4).join(', ')}]`
      );
    totals.set(testCase.group, total);
  });
  let pass = 0;
  let total = 0;
  totals.forEach((value, group) => {
    pass += value.pass;
    total += value.total;
    console.log(`${group.padEnd(8)} ${value.pass}/${value.total}`);
  });
  console.log(`total    ${pass}/${total}`);
  console.log(lines.join('\n'));
});

it("reports how long today's search takes on 5000 rooms and 5000 people", async () => {
  const { LOAD_QUERIES, makeLoadRooms, makeLoadUsers } = await import('./__fixtures__/searchLoad');
  const rooms = makeLoadRooms(5000);
  const users = makeLoadUsers(5000);
  const search = (text: string) => {
    searchCommandPaletteSection({
      items: rooms,
      query: text,
      config: commandPaletteSearchConfig.rooms,
    });
    rankCommandPalettePeople(
      searchCommandPaletteSection({
        items: users,
        query: text,
        config: { ...commandPaletteSearchConfig.users, limit: Number.POSITIVE_INFINITY },
      }),
      text
    );
  };
  const started = performance.now();
  search('a');
  const first = performance.now() - started;
  const times = LOAD_QUERIES.map((text) => {
    const best = [0, 1, 2].map(() => {
      const start = performance.now();
      search(text);
      return performance.now() - start;
    });
    return Math.min(...best);
  }).sort((a, b) => a - b);
  console.log(
    `first search (builds both indexes) ${first.toFixed(1)} ms; per keystroke median ${(
      times[Math.floor(times.length / 2)] ?? 0
    ).toFixed(1)} ms, slowest ${(times[times.length - 1] ?? 0).toFixed(1)} ms over ${
      times.length
    } texts`
  );
});
