// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../diagnostics/diagnosticsExport', () => ({
  buildDiagnosticsPayload: vi.fn(async (exportedAt: number) => ({ metadata: { exportedAt } })),
}));

import { buildBugReport, collectReportEvents, getBugReportFileName } from './bugReportPayload';

type FakeEvent = ReturnType<typeof fakeEvent>;

const fakeEvent = (
  id: string,
  ts: number,
  opts: {
    threadRootId?: string;
    replaces?: string;
    status?: string | null;
    edit?: Record<string, unknown>;
  } = {}
) => {
  const relation = () => {
    if (opts.replaces) return { rel_type: 'm.replace', event_id: opts.replaces };
    if (opts.threadRootId && opts.threadRootId !== id) {
      return { rel_type: 'm.thread', event_id: opts.threadRootId };
    }
    return null;
  };
  return {
    getId: () => id,
    getTs: () => ts,
    threadRootId: opts.threadRootId,
    status: opts.status ?? null,
    isDecryptionFailure: () => false,
    getEffectiveEvent: () => ({ event_id: id, origin_server_ts: ts, content: { body: id } }),
    replacingEvent: () => (opts.edit ? { getEffectiveEvent: () => opts.edit } : null),
    isRelation: () => relation() !== null,
    getRelation: relation,
    getContent: () => {
      const current = relation();
      return current ? { 'm.relates_to': current } : {};
    },
  };
};

const fakeRoom = (opts: {
  live: FakeEvent[];
  thread?: { id: string; root: FakeEvent; events: FakeEvent[] };
  timelineFor?: FakeEvent[];
}) => ({
  roomId: '!room:example.com',
  name: 'Lobby',
  // getState is read by getViaServers (permalink via servers); no state means no via servers.
  getLiveTimeline: () => ({ getEvents: () => opts.live, getState: () => undefined }),
  getTimelineForEvent: () => (opts.timelineFor ? { getEvents: () => opts.timelineFor } : null),
  getThread: (id: string) =>
    opts.thread && opts.thread.id === id
      ? { rootEvent: opts.thread.root, events: opts.thread.events }
      : null,
  findEventById: (id: string) =>
    opts.thread && opts.thread.root.getId() === id ? opts.thread.root : undefined,
  getMembers: () => [],
});

describe('collectReportEvents', () => {
  it('returns the thread root and every known reply, oldest first, without duplicates', () => {
    const root = fakeEvent('$root', 1, { threadRootId: '$root' });
    const a = fakeEvent('$a', 2, { threadRootId: '$root' });
    const b = fakeEvent('$b', 3, { threadRootId: '$root' });
    const room = fakeRoom({
      live: [root, b],
      thread: { id: '$root', root, events: [a, b] },
    });
    const ids = collectReportEvents(room as never, b as never).map((e) => e.getId());
    expect(ids).toEqual(['$root', '$a', '$b']);
  });

  it('includes a failed local echo that is only known as the selected event', () => {
    const root = fakeEvent('$root', 1, { threadRootId: '$root' });
    const failed = fakeEvent('~!room:example.com:m1', 5, {
      threadRootId: '$root',
      status: 'not_sent',
    });
    const room = fakeRoom({ live: [root], thread: { id: '$root', root, events: [] } });
    const ids = collectReportEvents(room as never, failed as never).map((e) => e.getId());
    expect(ids).toEqual(['$root', '~!room:example.com:m1']);
  });

  it('leaves m.replace edits out of the thread events', () => {
    const root = fakeEvent('$root', 1, { threadRootId: '$root' });
    const a = fakeEvent('$a', 2, { threadRootId: '$root' });
    const edit = fakeEvent('$edit', 3, { threadRootId: '$root', replaces: '$a' });
    const b = fakeEvent('$b', 4, { threadRootId: '$root' });
    const room = fakeRoom({
      live: [root, a, edit, b],
      thread: { id: '$root', root, events: [a, edit, b] },
    });
    const ids = collectReportEvents(room as never, b as never).map((e) => e.getId());
    expect(ids).toEqual(['$root', '$a', '$b']);
  });

  it('keeps the selected event even when it is an m.replace edit', () => {
    const root = fakeEvent('$root', 1, { threadRootId: '$root' });
    const a = fakeEvent('$a', 2, { threadRootId: '$root' });
    const edit = fakeEvent('$edit', 3, { threadRootId: '$root', replaces: '$a' });
    const room = fakeRoom({
      live: [root, a, edit],
      thread: { id: '$root', root, events: [a, edit] },
    });
    const ids = collectReportEvents(room as never, edit as never).map((e) => e.getId());
    expect(ids).toEqual(['$root', '$a', '$edit']);
  });

  it('takes the 50 events up to the selected main-timeline event', () => {
    const events = Array.from({ length: 80 }, (_, i) => fakeEvent(`$e${i}`, i));
    const room = fakeRoom({ live: events, timelineFor: events });
    const ids = collectReportEvents(room as never, events[59] as never).map((e) => e.getId());
    expect(ids).toHaveLength(50);
    expect(ids[0]).toBe('$e10');
    expect(ids[49]).toBe('$e59');
  });

  it('does not count or include m.replace edits in the main-timeline window', () => {
    const events = Array.from({ length: 80 }, (_, i) => [
      fakeEvent(`$e${i}`, i * 2),
      fakeEvent(`$edit${i}`, i * 2 + 1, { replaces: `$e${i}` }),
    ]).flat();
    const room = fakeRoom({ live: events, timelineFor: events });
    const selected = events.find((e) => e.getId() === '$e59');
    const ids = collectReportEvents(room as never, selected as never).map((e) => e.getId());
    expect(ids).toHaveLength(50);
    expect(ids[0]).toBe('$e10');
    expect(ids[49]).toBe('$e59');
    expect(ids.some((id) => id?.startsWith('$edit'))).toBe(false);
  });
});

describe('buildBugReport', () => {
  it('captures identifiers, raw events with latest edits, client state, and diagnostics', async () => {
    const root = fakeEvent('$root', 1, { threadRootId: '$root' });
    const reply = fakeEvent('$reply', 2, {
      threadRootId: '$root',
      edit: { event_id: '$edit', content: { 'm.new_content': { body: 'final' } } },
    });
    const room = fakeRoom({ live: [root, reply], thread: { id: '$root', root, events: [reply] } });
    const mx = {
      getSafeUserId: () => '@alice:example.com',
      getDeviceId: () => 'DEVICE',
      getHomeserverUrl: () => 'https://hs.example.com',
      getSyncState: () => 'SYNCING',
    };
    const report = await buildBugReport(
      mx as never,
      room as never,
      reply as never,
      new Date('2026-10-03T12:00:00.000Z')
    );
    expect(report.type).toBe('io.mindroom.bug_report');
    expect(report.version).toBe(1);
    expect(report.reporter).toEqual({
      userId: '@alice:example.com',
      deviceId: 'DEVICE',
      homeserver: 'https://hs.example.com',
    });
    expect(report.target).toMatchObject({
      roomId: '!room:example.com',
      roomName: 'Lobby',
      threadId: '$root',
      eventId: '$reply',
    });
    expect(report.target.permalink).toContain('$reply');
    expect(report.events.map((e) => e.eventId)).toEqual(['$root', '$reply']);
    expect(report.events[1].latestEdit).toEqual({
      event_id: '$edit',
      content: { 'm.new_content': { body: 'final' } },
    });
    expect(report.client.syncState).toBe('SYNCING');
    expect(report.client.platform).toBe('web');
    expect(report.diagnostics).toEqual({
      metadata: { exportedAt: Date.parse('2026-10-03T12:00:00.000Z') },
    });
    expect(getBugReportFileName(report)).toBe('mindroom-bug-report-2026-10-03T12-00-00-000Z.json');
  });
});
