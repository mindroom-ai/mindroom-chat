import { describe, expect, it } from 'vitest';
import type { TriState } from '../../event-store/threads/roomThreadOverviewModel';
import { buildThreadTagOptions, matchesThreadTagSearch } from './threadTagOptions';

const filters = (entries: Array<[string, TriState]> = []) => new Map<string, TriState>(entries);

describe('the Tags dropdown list', () => {
  it('lists every tag with its thread count, most used first and then by name', () => {
    expect(
      buildThreadTagOptions(
        ['bug', 'docs', 'urgent', 'wip'],
        { bug: 3, urgent: 7, wip: 3 },
        filters()
      )
    ).toEqual([
      { tag: 'urgent', count: 7, state: 'any' },
      { tag: 'bug', count: 3, state: 'any' },
      { tag: 'wip', count: 3, state: 'any' },
      { tag: 'docs', count: 0, state: 'any' },
    ]);
  });

  it('marks the tags the filter keeps or hides', () => {
    const options = buildThreadTagOptions(
      ['bug', 'docs', 'urgent'],
      { bug: 1, docs: 1, urgent: 1 },
      filters([
        ['bug', 'include'],
        ['docs', 'exclude'],
      ])
    );
    expect(options.map(({ tag, state }) => [tag, state])).toEqual([
      ['bug', 'include'],
      ['docs', 'exclude'],
      ['urgent', 'any'],
    ]);
  });

  it('keeps a chosen tag that no thread carries any more, so the choice can be undone', () => {
    expect(buildThreadTagOptions(['bug'], { bug: 2 }, filters([['gone', 'include']]))).toEqual([
      { tag: 'bug', count: 2, state: 'any' },
      { tag: 'gone', count: 0, state: 'include' },
    ]);
  });

  it('lists each tag once and works without counts', () => {
    expect(
      buildThreadTagOptions(['bug', 'bug', 'docs'], undefined, filters([['bug', 'include']]))
    ).toEqual([
      { tag: 'bug', count: 0, state: 'include' },
      { tag: 'docs', count: 0, state: 'any' },
    ]);
  });

  it('searches tag names by any part, ignoring case and outer spaces', () => {
    const names = ['backend', 'bug', 'frontend', 'needs-review'];
    const search = (query: string) => names.filter((name) => matchesThreadTagSearch(name, query));
    expect(search('')).toEqual(names);
    expect(search('   ')).toEqual(names);
    expect(search('end')).toEqual(['backend', 'frontend']);
    expect(search(' BUG ')).toEqual(['bug']);
    expect(search('s-r')).toEqual(['needs-review']);
    expect(search('nothing')).toEqual([]);
  });
});
