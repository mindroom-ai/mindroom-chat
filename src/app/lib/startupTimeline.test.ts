import { expect, it } from 'vitest';
import { claimClientStartup, markPageStartup, readStartupTimeline } from './startupTimeline';

it('exports only startup marks, with relative times for the first client attempt', () => {
  performance.mark('other.measurement');
  try {
    markPageStartup('js.entry');
    markPageStartup('js.entry');
    let active = true;
    const mark = claimClientStartup(() => active);
    if (!mark) throw new Error('The first startup must own the timeline');
    mark('client.init.start');
    mark('saved_sync.read.done', { cacheHit: true });
    active = false;
    mark('sync.first_live');
    expect(claimClientStartup(() => true)).toBeUndefined();

    const { timeOrigin, marks, phases } = readStartupTimeline();
    expect(timeOrigin).toBe(performance.timeOrigin);
    expect(marks.map(({ name, detail }) => [name, detail])).toEqual([
      ['mindroom.startup.js.entry', null],
      ['mindroom.startup.client.init.start', null],
      ['mindroom.startup.saved_sync.read.done', { cacheHit: true }],
    ]);
    expect(phases).toEqual(
      marks.slice(1).map((mark, index) => ({
        from: marks[index]?.name,
        to: mark.name,
        durationMs: mark.atMs - (marks[index]?.atMs ?? 0),
      }))
    );
  } finally {
    performance.getEntriesByType('mark').forEach(({ name }) => performance.clearMarks(name));
  }
});
