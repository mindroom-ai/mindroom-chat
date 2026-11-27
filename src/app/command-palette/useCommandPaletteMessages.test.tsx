// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ISearchResponse } from 'matrix-js-sdk';
import { Provider, createStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearThreadSummarySharedState,
  forgetRedactedThreadSummaries,
  storeThreadSummaryInState,
} from '../event-store/threads/threadSummaryState';
import {
  crossRoomThreadIndexAtom,
  emptyCrossRoomThreadIndexSnapshot,
  getCrossRoomThreadIndexKey,
  type CrossRoomThreadIndexEntry,
} from '../threads/cross-room/crossRoomThreadIndex';
import { trustAgentsOfViewer } from '../matrix/protocol/untrustedContent';
import { hasEncryptedRooms, useCommandPaletteMessages } from './useCommandPaletteMessages';

type PendingSearch = {
  term: string;
  signal?: AbortSignal;
  resolve: (response: ISearchResponse) => void;
  reject: (error: Error) => void;
};

const { client, navigate, openResult, pending, roomEvents } = vi.hoisted(() => {
  const searches: PendingSearch[] = [];
  const loaded = new Map<string, unknown>();
  return {
    pending: searches,
    roomEvents: loaded,
    navigate: vi.fn(),
    openResult: vi.fn(),
    client: {
      getUserId: () => '@me:example.org',
      getRoom: (roomId: string) => ({
        roomId,
        name: `Room ${roomId.slice(1, roomId.indexOf(':'))}`,
        getMember: () => null,
        hasEncryptionStateEvent: () => false,
        membersLoaded: () => true,
        findEventById: (id: string) => loaded.get(`${roomId}:${id}`),
        getThread: () => undefined,
      }),
      fetchRoomEvent: vi.fn(),
      search: vi.fn(
        (
          { body }: { body: { search_categories: { room_events: { search_term: string } } } },
          signal?: AbortSignal
        ) =>
          new Promise<ISearchResponse>((resolve, reject) => {
            searches.push({
              term: body.search_categories.room_events.search_term,
              signal,
              resolve,
              reject,
            });
          })
      ),
    },
  };
});

vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => client }));
vi.mock('../matrix/session/useSessionStore', () => ({
  useActiveSession: () => ({ sessionId: 'test-session' }),
}));
vi.mock('../event-store/cache/db', () => ({
  loadCachedThreadSummaries: vi.fn().mockResolvedValue(new Map()),
  saveCachedThreadSummary: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../search/useOpenSearchResult', () => ({ useOpenSearchResult: () => openResult }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

const ROOM = '!ops:example.org';
const hitOf = (eventId: string, body: string, extra?: Record<string, unknown>) => ({
  rank: 1,
  context: {},
  result: {
    event_id: eventId,
    room_id: ROOM,
    sender: '@alice:example.org',
    origin_server_ts: 1_700_000_000_000,
    type: 'm.room.message',
    content: { msgtype: 'm.text', body, ...extra },
  },
});
const responseOf = (...results: ReturnType<typeof hitOf>[]) =>
  ({
    search_categories: { room_events: { highlights: ['walrus'], count: results.length, results } },
  }) as unknown as ISearchResponse;
const responseWith = (eventId: string, body: string) => responseOf(hitOf(eventId, body));

const store = createStore();
const makeEntry = (rootId: string, title?: string, rootPreviewText = '') =>
  ({
    key: getCrossRoomThreadIndexKey(ROOM, rootId),
    summaryText: title ?? rootPreviewText,
    rootPreviewText,
    threadRecord: { presentation: { summaryInfo: title ? { summaryText: title } : undefined } },
  }) as unknown as CrossRoomThreadIndexEntry;
const setIndex = (entries: CrossRoomThreadIndexEntry[], rev?: [string, string][]) =>
  store.set(crossRoomThreadIndexAtom, {
    ...emptyCrossRoomThreadIndexSnapshot(),
    entries: new Map(entries.map((e) => [e.key, e])),
    ...(rev && {
      eventIdToThreadRoots: new Map([[ROOM, new Map(rev.map(([i, r]) => [i, new Set([r])]))]]),
    }),
  });

const renderMessages = (
  text: string,
  enabled = true,
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
) => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </Provider>
  );
  return renderHook(
    (props: { text: string; enabled: boolean }) =>
      useCommandPaletteMessages(props.text, props.enabled),
    { wrapper, initialProps: { text, enabled } }
  );
};

const searchHits = async (res: ISearchResponse, qc?: QueryClient) => {
  const hook = renderMessages('walrus', true, qc);
  await waitFor(() => expect(pending).toHaveLength(1));
  await act(async () => pending.shift()?.resolve(res));
  return hook;
};

afterEach(() => {
  pending.length = 0;
  roomEvents.clear();
  clearThreadSummarySharedState();
  store.set(crossRoomThreadIndexAtom, emptyCrossRoomThreadIndexSnapshot());
  client.search.mockClear();
  client.fetchRoomEvent.mockReset();
  navigate.mockClear();
  openResult.mockClear();
});

describe('useCommandPaletteMessages', () => {
  it('waits for typing to pause and then asks once, for the last text', async () => {
    const { result, rerender } = renderMessages('w');
    rerender({ text: 'wa', enabled: true });
    rerender({ text: 'wal', enabled: true });
    expect(result.current.status).toBe('loading');
    expect(client.search).not.toHaveBeenCalled();
    await waitFor(() => expect(client.search).toHaveBeenCalledTimes(1));
    expect(pending.map((search) => search.term)).toEqual(['wal']);
  });

  it('never shows the hits of an older text that answers late, and aborts its request', async () => {
    const { result, rerender } = renderMessages('wal');
    await waitFor(() => expect(pending).toHaveLength(1));
    rerender({ text: 'walrus', enabled: true });
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(pending).toHaveLength(2));
    const [older, newer] = pending;
    expect(older?.signal?.aborted).toBe(true);

    await act(async () => newer?.resolve(responseWith('$new', 'a walrus on the beach')));
    await waitFor(() => expect(result.current.status).toBe('done'));
    await act(async () => older?.resolve(responseWith('$old', 'a wallaby')));

    expect(result.current.items.map((item) => item.id)).toEqual(['message:!ops:example.org:$new']);
    expect(result.current.items[0]).toMatchObject({
      senderName: 'alice',
      roomName: 'Room ops',
      snippet: 'a walrus on the beach',
      highlights: ['walrus'],
      timestamp: 1_700_000_000_000,
    });
  });

  it('shows a hit by its latest edit as plain text, without Markdown syntax', async () => {
    const { result } = renderMessages('walrus');
    await waitFor(() => expect(pending).toHaveLength(1));
    const response = responseWith('$reply', 'Thinking... walrus');
    const hit = response.search_categories.room_events.results?.[0];
    if (!hit) throw new Error('no hit');
    const body = 'The **walrus** plan: see the [list](https://example.org) and `run it`.';
    hit.result.unsigned = {
      'm.relations': {
        'm.replace': {
          event_id: '$edit',
          sender: hit.result.sender,
          content: { body: `* ${body}`, 'm.new_content': { msgtype: 'm.text', body } },
        },
      },
    };
    await act(async () => pending[0]?.resolve(response));
    await waitFor(() => expect(result.current.status).toBe('done'));

    expect(result.current.items[0]?.snippet).toBe('The walrus plan: see the list and run it.');
  });

  it("shows the tool calls of an agent's reply, which Matrix holds without them", async () => {
    trustAgentsOfViewer('@me:example.org');
    const { result } = renderMessages('walrus');
    await waitFor(() => expect(pending).toHaveLength(1));
    const response = responseWith('$reply', 'The walrus plan.\n\nDone.');
    const hit = response.search_categories.room_events.results?.[0];
    if (!hit) throw new Error('no hit');
    hit.result.sender = '@mindroom_helper:example.org';
    Object.assign(hit.result.content, {
      format: 'org.matrix.custom.html',
      formatted_body: '<p>The walrus plan.</p>\n<p>Done.</p>\n',
      'io.mindroom.tool_trace': {
        version: 3,
        events: [{ type: 'tool_call_completed', tool_name: 'shell', body_line: 2, at: 1 }],
      },
    });
    await act(async () => pending[0]?.resolve(response));
    await waitFor(() => expect(result.current.status).toBe('done'));

    expect(result.current.items[0]?.snippet).toBe('The walrus plan. 🔧 shell [1] Done.');
  });

  it('starts a snippet a few words before a late match, in right-to-left text too', async () => {
    const { result } = renderMessages('walrus');
    await waitFor(() => expect(pending).toHaveLength(1));
    const body =
      'بالتأكيد. ارتفع معدل الاستخدام بنسبة 12% وتم إصلاح الخطأ WALRUS-88 في الإصدار الأخير.';
    await act(async () => pending[0]?.resolve(responseWith('$arabic', body)));
    await waitFor(() => expect(result.current.status).toBe('done'));

    const snippet = result.current.items[0]?.snippet ?? '';
    expect(snippet).toBe('…وتم إصلاح الخطأ WALRUS-88 في الإصدار الأخير.');
    expect(snippet.indexOf('WALRUS')).toBeLessThan(21);
  });

  it('leads to the first whole-word match, not to the word inside a longer one', async () => {
    const { result } = renderMessages('walrus');
    await waitFor(() => expect(pending).toHaveLength(1));
    const body = 'The walruses and subwalrus helpers stay put, then the plain walrus here.';
    await act(async () => pending[0]?.resolve(responseWith('$words', body)));
    await waitFor(() => expect(result.current.status).toBe('done'));

    expect(result.current.items[0]?.snippet).toBe('…then the plain walrus here.');
  });

  // The first pass keeps 2,000 characters from 599 before the real match, which falls inside
  // "subwalrus" (or inside the two halves of "𝐀" in "sub𝐀walrus"); the cut-off tail must not
  // become the match the second pass centers on.
  it.each([
    ['inside a word', 'sub'],
    ['inside a letter written as a surrogate pair', 'sub\uD835\uDC00'],
  ])('reads no word cut %s at the edge of a long message as a match', async (_, cut) => {
    const { result } = renderMessages('walrus');
    await waitFor(() => expect(pending).toHaveLength(1));
    const head = `${'gamma '.repeat(400)}${cut.slice(0, -1)}`;
    const tail = `${cut.slice(-1)}walrus helpers`.padEnd(599);
    const body = `${head}${tail}walrus here. ${'omega '.repeat(400)}`;
    expect(body.indexOf(' walrus ') + 1 - 599).toBe(head.length);
    await act(async () => pending[0]?.resolve(responseWith('$cut', body)));
    await waitFor(() => expect(result.current.status).toBe('done'));

    expect(result.current.items[0]?.snippet).toMatch(/^…helpers walrus here\. omega/);
  });

  it('lists a retitled thread once, by its current title, beside what was said in it', async () => {
    const entry = makeEntry('$root', 'Walrus launch plan');
    setIndex([entry]);
    const { result } = renderMessages('walrus');
    await waitFor(() => expect(pending).toHaveLength(1));
    const response = responseWith('$said', 'walrus sighting');
    const [said] = response.search_categories.room_events.results ?? [];
    if (!said) throw new Error('no hit');
    const relation = { 'm.relates_to': { rel_type: 'm.thread', event_id: '$root' } };
    const title = (eventId: string, body: string) => ({
      ...said,
      result: {
        ...said.result,
        event_id: eventId,
        content: {
          msgtype: 'm.notice',
          body,
          'io.mindroom.thread_summary': { version: 1 },
          ...relation,
        },
      },
    });
    said.result.content = { ...said.result.content, ...relation };
    response.search_categories.room_events.results = [
      title('$new', 'Walrus plan'),
      said,
      title('$old', 'Walrus sketch'),
    ];
    await act(async () => pending[0]?.resolve(response));
    await waitFor(() => expect(result.current.status).toBe('done'));

    expect(result.current.items).toMatchObject([
      { id: 'message:!ops:example.org:$new', snippet: 'Walrus launch plan', threadName: undefined },
      { id: 'message:!ops:example.org:$said', threadName: 'Walrus launch plan' },
    ]);
    expect(result.current.items[0]?.titleOfThreadId).toBe(`thread:${entry.key}`);
    expect(result.current.items[1]?.titleOfThreadId).toBeUndefined();
  });

  it('resolves sync/async m.replace replies, negative-caches standalone edits, and retries 503s', async () => {
    setIndex(
      [makeEntry('$rA', 'Loaded'), makeEntry('$rB', 'Indexed'), makeEntry('$rC', 'Fetched')],
      [['$repB', '$rB']]
    );
    roomEvents.set(`${ROOM}:$repA`, {
      getWireContent: () => ({ 'm.relates_to': { rel_type: 'm.thread', event_id: '$rA' } }),
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.fetchRoomEvent.mockImplementation(async (_r: string, id: string) => {
      if (id === '$repC') throw new Error('503');
      return { event_id: id, content: { msgtype: 'm.text', body: 'Solo' } };
    });
    const rep = (e: string, t: string) =>
      hitOf(e, '* walrus', { 'm.relates_to': { rel_type: 'm.replace', event_id: t } });
    const page = responseOf(
      rep('$eA', '$repA'),
      rep('$eB', '$repB'),
      rep('$eC', '$repC'),
      rep('$eS', '$solo')
    );
    const first = await searchHits(page, qc);
    await waitFor(() => expect(client.fetchRoomEvent).toHaveBeenCalledTimes(2));
    const names = (h: typeof first) => h.result.current.items.map((i) => i.threadName);
    expect(names(first)).toEqual(['Loaded', 'Indexed', undefined, undefined]);
    first.result.current.items[0]?.onSelect?.();
    expect(openResult).toHaveBeenCalledWith(ROOM, { mainEventId: '$repA', threadRootId: '$rA' });
    first.unmount();

    client.fetchRoomEvent.mockResolvedValueOnce({
      event_id: '$repC',
      content: { 'm.relates_to': { rel_type: 'm.thread', event_id: '$rC' } },
    });
    const second = renderMessages('walrus', true, qc);
    await waitFor(() => expect(names(second)).toEqual(['Loaded', 'Indexed', 'Fetched', undefined]));
    expect(client.fetchRoomEvent).toHaveBeenCalledTimes(3);
  });

  it('shows titles on titled roots and empty string (never root preview) on untitled roots', async () => {
    setIndex([makeEntry('$rT', 'Harbor roadmap', 'Root T'), makeEntry('$rU', undefined, 'Root U')]);
    const { result } = await searchHits(
      responseOf(hitOf('$rT', 'walrus T'), hitOf('$rU', 'walrus U'))
    );
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.items.map((i) => i.threadName)).toEqual(['Harbor roadmap', '']);
    result.current.items[1]?.onSelect?.();
    expect(openResult).toHaveBeenCalledWith(ROOM, { mainEventId: '$rU', threadRootId: '$rU' });
  });

  it('resolves titles from threadSummaryState and drops them cleanly on redaction', async () => {
    setIndex([makeEntry('$rS', undefined, 'Plain root fallback')]);
    const reply = hitOf('$repS', 'walrus', {
      'm.relates_to': { rel_type: 'm.thread', event_id: '$rS' },
    });
    const { result } = await searchHits(responseOf(reply));
    await waitFor(() => expect(result.current.items[0]?.threadName).toBe('Plain root fallback'));
    const info = { summaryText: 'Live title', eventId: '$sum1', eventTs: 2000 };
    act(() => {
      storeThreadSummaryInState('test-session', ROOM, '$rS', info);
    });
    await waitFor(() => expect(result.current.items[0]?.threadName).toBe('Live title'));
    act(() => forgetRedactedThreadSummaries('test-session', ROOM, new Set(['$sum1'])));
    await waitFor(() => expect(result.current.items[0]?.threadName).toBe('Plain root fallback'));
  });

  it('reports a failed search as an error', async () => {
    const { result } = renderMessages('walrus');
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => pending[0]?.reject(new Error('M_UNKNOWN')));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.items).toEqual([]);
  });

  it('asks nothing while disabled or without text, and opens the page for a term', async () => {
    const { result, rerender } = renderMessages('walrus', false);
    rerender({ text: '', enabled: true });
    expect(result.current.status).toBe('idle');
    await new Promise((resolve) => {
      setTimeout(resolve, 300);
    });
    expect(client.search).not.toHaveBeenCalled();
    result.current.openSearchPage('walrus');
    expect(navigate).toHaveBeenCalledWith('/home/search/?term=walrus&global=true');
  });
});

describe('hasEncryptedRooms', () => {
  const room = (encrypted: boolean) => ({ hasEncryptionStateEvent: () => encrypted });

  it('is true only when at least one joined room is encrypted', () => {
    expect(hasEncryptedRooms([])).toBe(false);
    expect(hasEncryptedRooms([room(false), undefined, null])).toBe(false);
    expect(hasEncryptedRooms([room(false), room(true)])).toBe(true);
  });
});
