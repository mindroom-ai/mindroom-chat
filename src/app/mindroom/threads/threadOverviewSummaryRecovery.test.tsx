import 'fake-indexeddb/auto';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MatrixClient, Room } from 'matrix-js-sdk';
import { afterEach, expect, it, vi } from 'vitest';
import { pickLatestThreadSummaryInfo } from '../messages/threadSummary';
import {
  deleteCacheStoreDb,
  loadCachedThreadEventsBefore,
  loadCachedThreadEvent,
  loadLatestCachedThreadEvents,
  saveThreadEventsToCache,
  type CachedThreadEvent,
  type CachedThreadEventPage,
} from './cacheStore';
import {
  clearThreadSummarySharedState,
  getThreadSummaryStateSnapshot,
  storeThreadSummaryInState,
} from './threadSummaryState';
import {
  recoverCachedThreadSummaryCandidates,
  useThreadOverviewSummaryRecovery,
} from './threadOverviewSummaryRecovery';
import type { ThreadCacheCoverage } from './types';

vi.mock('./cacheStore', async (original) => ({
  ...(await original<typeof import('./cacheStore')>()),
  loadLatestCachedThreadEvents: vi.fn(),
  loadCachedThreadEventsBefore: vi.fn(),
  loadCachedThreadEvent: vi.fn(),
}));

const sessionId = 'summary-recovery';
const mx = new MatrixClient({ baseUrl: 'https://example.org', userId: '@alice:example.org' });
const room = new Room('!room:example.org', mx, '@alice:example.org');
const rootId = '$root';
const latest = vi.mocked(loadLatestCachedThreadEvents);
const older = vi.mocked(loadCachedThreadEventsBefore);
const page = (events: CachedThreadEvent[], hasMoreBefore = false): CachedThreadEventPage => ({
  events,
  hasMoreBefore,
});
const summary = (eventId: string, ts: number, body: string): CachedThreadEvent => ({
  event_id: eventId,
  room_id: room.roomId,
  origin_server_ts: ts,
  type: 'm.room.message',
  sender: '@alice:example.org',
  content: {
    msgtype: 'm.notice',
    body,
    'io.mindroom.thread_summary': true,
    'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
  },
});
const recover = (shouldContinue = () => true) =>
  recoverCachedThreadSummaryCandidates({ sessionId, room, threadRootId: rootId, shouldContinue });
let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  clearThreadSummarySharedState(sessionId);
  await deleteCacheStoreDb(sessionId);
  vi.resetAllMocks();
});

it('checks older pages and uses accepted edit chronology rather than the first summary found', async () => {
  const original = summary('$original', 1, 'Old title');
  const edit = {
    ...summary('$edit', 30, 'Edited title'),
    content: {
      ...summary('$edit', 30, 'Edited title').content,
      'm.new_content': summary('$edit', 30, 'Edited title').content,
      'm.relates_to': { rel_type: 'm.replace', event_id: '$original' },
    },
  };
  original.unsigned = { 'm.relations': { 'm.replace': edit } };
  latest.mockResolvedValue(page([summary('$newer-original', 20, 'Earlier accepted title')], true));
  older.mockResolvedValue(page([original]));
  const candidates = await recover();
  expect(pickLatestThreadSummaryInfo(...(candidates ?? []))).toMatchObject({
    summaryText: 'Edited title',
    eventTs: 30,
  });
  expect(latest).toHaveBeenCalledWith(sessionId, room.roomId, rootId, 128);
  expect(older).toHaveBeenCalledWith(
    sessionId,
    room.roomId,
    rootId,
    { eventId: '$newer-original', ts: 20 },
    128
  );
});

it('does not recover redacted notices, local echoes, or unverified standalone replacements', async () => {
  const redacted = summary('$redacted', 2, 'Removed title');
  redacted.unsigned = {
    redacted_because: {
      event_id: '$redaction',
      type: 'm.room.redaction',
      content: {},
      sender: '@alice:example.org',
      origin_server_ts: 10,
      unsigned: {},
    },
  };
  const replacement = summary('$unverified', 4, 'Unverified title');
  replacement.content!['m.relates_to'] = { rel_type: 'm.replace', event_id: '$missing-target' };
  latest.mockResolvedValue(
    page([summary('~local-echo', 1, 'Pending title'), redacted, replacement])
  );
  expect(await recover()).toEqual([]);
});

it.each(['edit', 'redaction'] as const)(
  'applies a standalone %s to a summary on an older page',
  async (kind) => {
    const target = summary('$target', 1, 'Original title');
    const relation: CachedThreadEvent =
      kind === 'edit'
        ? {
            ...summary('$edit', 30, 'Edited title'),
            content: {
              ...summary('$edit', 30, 'Edited title').content,
              'm.new_content': summary('$edit', 30, 'Edited title').content,
              'm.relates_to': { rel_type: 'm.replace', event_id: '$target' },
            },
          }
        : {
            event_id: '$redaction',
            room_id: room.roomId,
            origin_server_ts: 30,
            type: 'm.room.redaction',
            redacts: '$target',
            content: {},
          };
    latest.mockResolvedValue(page([relation], true));
    older.mockResolvedValue(page([target]));
    const candidates = await recover();
    expect(pickLatestThreadSummaryInfo(...(candidates ?? []))).toEqual(
      kind === 'edit'
        ? {
            summaryText: 'Edited title',
            eventTs: 30,
          }
        : undefined
    );
  }
);

it('retains an older ordinary notice that a standalone edit turns into a summary', async () => {
  const target = summary('$target', 1, 'Ordinary notice');
  delete target.content!['io.mindroom.thread_summary'];
  const edit = summary('$edit', 30, 'New summary');
  edit.content = {
    ...edit.content,
    'm.new_content': summary('$edit', 30, 'New summary').content,
    'm.relates_to': { rel_type: 'm.replace', event_id: '$target' },
  };
  latest.mockResolvedValue(page([edit], true));
  older.mockResolvedValue(page([target]));
  expect(pickLatestThreadSummaryInfo(...((await recover()) ?? []))).toMatchObject({
    summaryText: 'New summary',
    eventTs: 30,
  });
});

it('applies a metadata-free edit that removes summary status from an older notice', async () => {
  const target = summary('$target', 1, 'Former summary');
  const edit = summary('$edit', 30, 'Ordinary notice now');
  const content = { ...edit.content };
  delete content['io.mindroom.thread_summary'];
  edit.content = {
    ...content,
    'm.new_content': content,
    'm.relates_to': { rel_type: 'm.replace', event_id: '$target' },
  };
  latest.mockResolvedValue(page([edit], true));
  older.mockResolvedValue(page([target]));
  expect(await recover()).toEqual([]);
});

it('looks up a summary-creating edit target that sorted ahead of the edit', async () => {
  const target = summary('$target', 30, 'Ordinary notice');
  delete target.content!['io.mindroom.thread_summary'];
  const edit = summary('$edit', 20, 'Accepted summary');
  edit.content = {
    ...edit.content,
    'm.new_content': edit.content,
    'm.relates_to': { rel_type: 'm.replace', event_id: '$target' },
  };
  latest.mockResolvedValue(page([target], true));
  older.mockResolvedValue(page([edit]));
  vi.mocked(loadCachedThreadEvent).mockResolvedValue(target);
  expect(pickLatestThreadSummaryInfo(...((await recover()) ?? []))).toMatchObject({
    summaryText: 'Accepted summary',
    eventTs: 20,
  });
});

it('discards a page if its owner is cancelled while the read is pending', async () => {
  let finish!: (page: CachedThreadEventPage) => void;
  latest.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  let active = true;
  const pending = recover(() => active);
  active = false;
  finish(page([summary('$summary', 1, 'Stale title')], true));
  expect(await pending).toBeUndefined();
  expect(older).not.toHaveBeenCalled();
});

const coverage = (): ThreadCacheCoverage => ({
  eventCount: 32,
  hasMoreBackward: true,
  tailLoaded: true,
  relationSnapshotComplete: false,
});
const mount = async () => {
  const records = new Map();
  const store = vi.fn((id, ...infos) => {
    storeThreadSummaryInState(sessionId, room.roomId, id, ...infos);
  });
  const rootIds = [rootId];
  function Harness({
    state = coverage(),
    enabled = true,
  }: {
    state?: ThreadCacheCoverage;
    enabled?: boolean;
  }) {
    useThreadOverviewSummaryRecovery({
      enabled,
      sessionId,
      room,
      threadRootIds: rootIds,
      records,
      coverage: new Map([[rootId, state]]),
      onStoreThreadSummary: store,
    });
    return null;
  }
  const state = coverage();
  await act(async () => {
    renderer = create(<Harness state={state} />);
  });
  return {
    store,
    refresh: async (next = state, enabled = true) => {
      await act(async () => renderer?.update(<Harness state={next} enabled={enabled} />));
    },
  };
};

it('keeps a newer live summary accepted while recovery is pending', async () => {
  let finish!: (value: CachedThreadEventPage) => void;
  latest.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const { store } = await mount();
  await vi.waitFor(() => expect(latest).toHaveBeenCalledOnce());
  storeThreadSummaryInState(sessionId, room.roomId, rootId, {
    summaryText: 'Live title',
    eventTs: 30,
  });
  await act(async () => finish(page([summary('$old', 10, 'Older cached title')])));
  expect(store).toHaveBeenCalledOnce();
  expect(getThreadSummaryStateSnapshot(sessionId, room.roomId).get(rootId)?.summaryText).toBe(
    'Live title'
  );
});

it('restarts an inconsistent scan before publishing when cache history changes in flight', async () => {
  let finish!: (value: CachedThreadEventPage) => void;
  latest.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const newer = summary('$newer', 30, 'Newly downloaded title');
  latest.mockResolvedValue(page([newer]));
  const { store } = await mount();
  await vi.waitFor(() => expect(latest).toHaveBeenCalledOnce());
  await saveThreadEventsToCache(sessionId, room.roomId, rootId, [newer]);
  await act(async () => finish(page([summary('$old', 10, 'Stale scan title')])));
  expect(store).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(store).toHaveBeenCalledOnce());
  expect(getThreadSummaryStateSnapshot(sessionId, room.roomId).get(rootId)?.summaryText).toBe(
    'Newly downloaded title'
  );
});

it.each(['close', 'clear'] as const)('does not republish pending data after %s', async (action) => {
  let finish!: (value: CachedThreadEventPage) => void;
  latest.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const { store, refresh } = await mount();
  await vi.waitFor(() => expect(latest).toHaveBeenCalledOnce());
  if (action === 'close') await refresh(coverage(), false);
  else await deleteCacheStoreDb(sessionId);
  await act(async () => finish(page([summary('$old', 10, 'Cancelled title')])));
  expect(store).not.toHaveBeenCalled();
});

it('does not rescan negative results on rerender, but retries when cache coverage changes', async () => {
  latest.mockResolvedValue(page([]));
  const { refresh, store } = await mount();
  await vi.waitFor(() => expect(latest).toHaveBeenCalledOnce());
  await refresh();
  expect(latest).toHaveBeenCalledOnce();
  latest.mockResolvedValue(page([summary('$downloaded', 10, 'Downloaded later')]));
  await refresh(coverage());
  await vi.waitFor(() => expect(store).toHaveBeenCalledOnce());
  expect(latest).toHaveBeenCalledTimes(2);
});
