import { describe, expect, it } from 'vitest';
import { SEARCH_CORPUS, checkCorpusCase, type CorpusCase } from './__fixtures__/searchCorpus';
import { getCorpusSource } from './__fixtures__/searchCorpusSource';
import { LOAD_QUERIES, makeLoadRooms, makeLoadUsers } from './__fixtures__/searchLoad';
import { getCommandPaletteLocalSections } from './commandPaletteResults';

const sourceOf = (testCase: CorpusCase) => {
  const { actions, settingRows, choiceRows, rooms, threads, users } = getCorpusSource(
    testCase.language ?? 'en'
  );
  return {
    actions,
    commands: [...settingRows, ...choiceRows],
    rooms,
    threads,
    getUsers: () => users,
  };
};

// One source per language, so the lists keep their identity as the palette's do.
const sources = new Map<string, ReturnType<typeof sourceOf>>();

const rowsOf = (testCase: CorpusCase): string[] => {
  const language = testCase.language ?? 'en';
  const source = sources.get(language) ?? sourceOf(testCase);
  sources.set(language, source);
  return getCommandPaletteLocalSections({
    source,
    tab: testCase.tab,
    searchText: testCase.query,
  }).flatMap((section) => section.items.map((item) => item.id));
};

describe('the search corpus', () => {
  it.each(
    SEARCH_CORPUS.map((testCase) => ({
      name: `${testCase.group}: "${testCase.query}" on ${testCase.tab} (${
        testCase.language ?? 'en'
      })`,
      testCase,
    }))
  )('$name', ({ testCase }) => {
    const rows = rowsOf(testCase);
    expect({ failures: checkCorpusCase(testCase, rows), rows: rows.slice(0, 6) }).toEqual({
      failures: [],
      rows: rows.slice(0, 6),
    });
  });
});

describe('the search of a large account', () => {
  it('answers a keystroke on 5000 rooms and 5000 people well inside a frame budget', () => {
    const users = makeLoadUsers(5000);
    const source = {
      actions: [],
      commands: [],
      rooms: makeLoadRooms(5000),
      threads: [],
      getUsers: () => users,
    };
    const search = (searchText: string) =>
      getCommandPaletteLocalSections({ source, tab: 'all', searchText });

    const started = performance.now();
    search('a');
    const first = performance.now() - started;
    // The best of three runs of each text: what the search costs, without what else the machine does.
    const times = LOAD_QUERIES.map((text) =>
      Math.min(
        ...[0, 1, 2].map(() => {
          const start = performance.now();
          search(text);
          return performance.now() - start;
        })
      )
    ).sort((left, right) => left - right);
    const median = times[Math.floor(times.length / 2)] ?? 0;
    const slowest = times[times.length - 1] ?? 0;
    // eslint-disable-next-line no-console
    console.log(
      `first search (prepares both lists) ${first.toFixed(
        1
      )} ms; a keystroke: median ${median.toFixed(1)} ms, slowest ${slowest.toFixed(1)} ms over ${
        times.length
      } texts`
    );

    // Far above what it takes (a few milliseconds), so a busy machine does not fail it.
    expect(slowest).toBeLessThan(50);
  });
});
