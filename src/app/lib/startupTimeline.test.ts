import { expect, it, vi } from 'vitest';
import { claimClientStartup, markPageStartup, readStartupTimeline } from './startupTimeline';

it('exports only our marks, with relative times for the first client attempt', () => {
  const foreign = 'mindroom.startup.sync.first_live';
  performance.mark(foreign);
  const devToolsMark = vi.spyOn(performance, 'mark');
  try {
    markPageStartup('js.entry');
    markPageStartup('js.entry');
    devToolsMark.mockImplementationOnce(() => {
      throw new Error('User Timing failed');
    });
    markPageStartup('config.ready');
    markPageStartup('splash.shown');
    let active = true;
    const mark = claimClientStartup(() => active);
    if (!mark) throw new Error('The first startup must own the timeline');
    mark('client.init.start');
    mark('saved_sync.read.done', {
      cacheHit: true,
      durationMs: 3,
      invalid: Infinity,
      text: 'not an enum',
    });
    active = false;
    mark('sync.first_live');
    expect(claimClientStartup(() => true)).toBeUndefined();

    const { timeOrigin, marks } = readStartupTimeline();
    expect(timeOrigin).toBe(performance.timeOrigin);
    expect(marks.map(({ name, detail }) => [name, detail])).toEqual([
      ['mindroom.startup.js.entry', null],
      ['mindroom.startup.config.ready', null],
      ['mindroom.startup.splash.shown', null],
      ['mindroom.startup.client.init.start', null],
      ['mindroom.startup.saved_sync.read.done', { cacheHit: true, durationMs: 3 }],
    ]);
    const [entry] = performance.getEntriesByName('mindroom.startup.js.entry', 'mark');
    expect(entry).toBeDefined();
    expect(marks[0]?.atMs).toBe(entry?.startTime);
  } finally {
    devToolsMark.mockRestore();
    performance.clearMarks(foreign);
    for (const { name } of readStartupTimeline().marks) performance.clearMarks(name);
  }
});
