// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import {
  Direction,
  EventType,
  MatrixEvent,
  RelationType,
  type ISearchResponse,
} from 'matrix-js-sdk';
import { Provider, createStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  crossRoomThreadIndexAtom,
  emptyCrossRoomThreadIndexSnapshot,
  getCrossRoomThreadIndexKey,
  type CrossRoomThreadIndexEntry,
} from '../threads/cross-room/crossRoomThreadIndex';
import {
  clearThreadSummarySharedState,
  forgetRedactedThreadSummaries,
  getThreadSummaryStateSnapshot,
  storeThreadSummaryInState,
} from '../event-store/threads/threadSummaryState';
import type { ThreadSummaryInfo } from '../matrix/protocol/threadSummary';
import { trustAgentsOfViewer } from '../matrix/protocol/untrustedContent';
import { hasEncryptedRooms, useCommandPaletteMessages } from './useCommandPaletteMessages';

type PendingSearch = {
  term: string;
  signal?: AbortSignal;
  resolve: (response: ISearchResponse) => void;
  reject: (error: Error) => void;
};

type RoomStubOverride = {
  findEventById?: (eventId: string) => unknown;
  getThread?: (threadId: string) => unknown;
};

const {
  activeSession,
  client,
  loadCachedThreadSummariesMock,
  navigate,
  openResult,
  pending,
  roomOverrides,
} = vi.hoisted(() => {
  const searches: PendingSearch[] = [];
  const overrides = new Map<string, RoomStubOverride>();
  const session: { current: { sessionId: string } | undefined } = { current: undefined };
  return {
    activeSession: session,
    pending: searches,
    roomOverrides: overrides,
    navigate: vi.fn(),
    openResult: vi.fn(),
    loadCachedThreadSummariesMock: vi.fn(
      async (): Promise<Map<string, ThreadSummaryInfo>> => new Map()
    ),
    client: {
      getUserId: () => '@me:example.org',
      getRoom: (roomId: string) => ({
        roomId,
        name: `Room ${roomId.slice(1, roomId.indexOf(':'))}`,
        getMember: () => null,
        hasEncryptionStateEvent: () => false,
        membersLoaded: () => true,
        findEventById: (eventId: string) => overrides.get(roomId)?.findEventById?.(eventId),
        getThread: (threadId: string) => overrides.get(roomId)?.getThread?.(threadId),
      }),
      fetchRoomEvent: vi.fn(),
      relations: vi.fn(),
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
  useActiveSession: () => activeSession.current,
}));
vi.mock('../event-store/cache/db', () => ({
  loadCachedThreadSummaries: (...args: unknown[]) => loadCachedThreadSummariesMock(...(args as [])),
  saveCachedThreadSummary: vi.fn(async () => undefined),
}));
vi.mock('../search/useOpenSearchResult', () => ({ useOpenSearchResult: () => openResult }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

const responseWith = (eventId: string, body: string): ISearchResponse =>
  ({
    search_categories: {
      room_events: {
        highlights: ['walrus'],
        count: 1,
        results: [
          {
            rank: 1,
            context: {},
            result: {
              event_id: eventId,
              room_id: '!ops:example.org',
              sender: '@alice:example.org',
              origin_server_ts: 1_700_000_000_000,
              type: 'm.room.message',
              content: { msgtype: 'm.text', body },
            },
          },
        ],
      },
    },
  }) as unknown as ISearchResponse;

const replaceHitResponse = (editId: string, targetId: string, body: string): ISearchResponse => {
  const response = responseWith(editId, `* ${body}`);
  const hit = response.search_categories.room_events.results?.[0];
  if (!hit) throw new Error('no hit');
  hit.result.content = {
    msgtype: 'm.text',
    body: `* ${body}`,
    'm.new_content': { msgtype: 'm.text', body },
    'm.relates_to': { rel_type: 'm.replace', event_id: targetId },
  };
  return response;
};

const summaryMatrixEvent = (eventId: string, summary: string, ts = 1_700_000_001_000) => ({
  getId: () => eventId,
  getTs: () => ts,
  getContent: () => ({
    msgtype: 'm.notice',
    body: summary,
    'io.mindroom.thread_summary': { version: 1, summary },
  }),
});

const store = createStore();

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

afterEach(() => {
  cleanup();
  pending.length = 0;
  roomOverrides.clear();
  activeSession.current = undefined;
  clearThreadSummarySharedState();
  store.set(crossRoomThreadIndexAtom, emptyCrossRoomThreadIndexSnapshot());
  client.search.mockClear();
  client.fetchRoomEvent.mockReset();
  client.relations.mockReset();
  loadCachedThreadSummariesMock.mockReset();
  loadCachedThreadSummariesMock.mockResolvedValue(new Map());
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
    const key = getCrossRoomThreadIndexKey('!ops:example.org', '$root');
    const entry = { key, summaryText: 'Walrus launch plan', rootPreviewText: '' };
    store.set(crossRoomThreadIndexAtom, {
      ...emptyCrossRoomThreadIndexSnapshot(),
      entries: new Map([[key, entry as CrossRoomThreadIndexEntry]]),
    });
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
    expect(result.current.items[0]?.titleOfThreadId).toBe(`thread:${key}`);
    expect(result.current.items[1]?.titleOfThreadId).toBeUndefined();
  });

  it('resolves an edited thread reply synchronously via room.findEventById and reverse index', async () => {
    const roomId = '!ops:example.org';
    const keyA = getCrossRoomThreadIndexKey(roomId, '$rootA');
    const keyB = getCrossRoomThreadIndexKey(roomId, '$rootB');
    store.set(crossRoomThreadIndexAtom, {
      ...emptyCrossRoomThreadIndexSnapshot(),
      entries: new Map([
        [
          keyA,
          {
            key: keyA,
            summaryText: 'Harbor deployment plan',
            rootPreviewText: '',
          } as CrossRoomThreadIndexEntry,
        ],
        [
          keyB,
          {
            key: keyB,
            summaryText: 'Arctic telemetry notes',
            rootPreviewText: '',
          } as CrossRoomThreadIndexEntry,
        ],
      ]),
      eventIdToThreadRoots: new Map([[roomId, new Map([['$replyB', new Set(['$rootB'])]])]]),
    });
    roomOverrides.set(roomId, {
      findEventById: (eventId) =>
        eventId === '$replyA'
          ? {
              getWireContent: () => ({
                'm.relates_to': { rel_type: 'm.thread', event_id: '$rootA' },
              }),
            }
          : undefined,
    });

    const { result } = renderMessages('walrus');
    await waitFor(() => expect(pending).toHaveLength(1));
    const responseA = replaceHitResponse('$editA', '$replyA', 'Final walrus answer A');
    const responseB = replaceHitResponse('$editB', '$replyB', 'Final walrus answer B');
    responseA.search_categories.room_events.results?.push(
      ...(responseB.search_categories.room_events.results ?? [])
    );
    await act(async () => pending[0]?.resolve(responseA));
    await waitFor(() => expect(result.current.status).toBe('done'));

    expect(result.current.items).toMatchObject([
      { id: 'message:!ops:example.org:$editA', threadName: 'Harbor deployment plan' },
      { id: 'message:!ops:example.org:$editB', threadName: 'Arctic telemetry notes' },
    ]);
    expect(client.fetchRoomEvent).not.toHaveBeenCalled();
    expect(client.relations).not.toHaveBeenCalled();

    result.current.items[0]?.onSelect?.();
    result.current.items[1]?.onSelect?.();
    expect(openResult).toHaveBeenNthCalledWith(1, roomId, {
      mainEventId: '$replyA',
      threadRootId: '$rootA',
    });
    expect(openResult).toHaveBeenNthCalledWith(2, roomId, {
      mainEventId: '$replyB',
      threadRootId: '$rootB',
    });
  });

  it('fetches an unloaded edited thread reply once, shows its title, and caches across queries', async () => {
    const roomId = '!ops:example.org';
    const key = getCrossRoomThreadIndexKey(roomId, '$root');
    store.set(crossRoomThreadIndexAtom, {
      ...emptyCrossRoomThreadIndexSnapshot(),
      entries: new Map([
        [
          key,
          {
            key,
            summaryText: 'Streaming checklist',
            rootPreviewText: '',
          } as CrossRoomThreadIndexEntry,
        ],
      ]),
    });
    client.fetchRoomEvent.mockResolvedValue({
      event_id: '$orig',
      content: {
        msgtype: 'm.text',
        body: 'Thinking...',
        'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
      },
    });

    const { result, rerender } = renderMessages('walrus');
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () =>
      pending[0]?.resolve(replaceHitResponse('$edit', '$orig', 'Walrus summary ready'))
    );
    await waitFor(() => expect(result.current.items[0]?.threadName).toBe('Streaming checklist'));
    expect(client.fetchRoomEvent).toHaveBeenCalledTimes(1);
    expect(client.fetchRoomEvent).toHaveBeenCalledWith(roomId, '$orig');

    // Re-querying a hit targeting the same original event reuses the cache with no duplicate fetch.
    rerender({ text: 'walrus ready', enabled: true });
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () =>
      pending[1]?.resolve(replaceHitResponse('$edit2', '$orig', 'Walrus summary ready'))
    );
    await waitFor(() =>
      expect(result.current.items[0]?.id).toBe('message:!ops:example.org:$edit2')
    );
    expect(result.current.items[0]?.threadName).toBe('Streaming checklist');
    expect(client.fetchRoomEvent).toHaveBeenCalledTimes(1);
  });

  it('handles edited summary notices via fetchRoomEvent without breaking title dedup', async () => {
    const roomId = '!ops:example.org';
    const key = getCrossRoomThreadIndexKey(roomId, '$root');
    store.set(crossRoomThreadIndexAtom, {
      ...emptyCrossRoomThreadIndexSnapshot(),
      entries: new Map([
        [
          key,
          {
            key,
            summaryText: 'Renamed walrus title',
            rootPreviewText: '',
          } as CrossRoomThreadIndexEntry,
        ],
      ]),
    });
    client.fetchRoomEvent.mockResolvedValue({
      event_id: '$summaryOrig',
      content: {
        msgtype: 'm.notice',
        body: 'Old walrus title',
        'io.mindroom.thread_summary': { version: 1, summary: 'Old walrus title' },
        'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
      },
    });

    const { result } = renderMessages('walrus');
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () =>
      pending[0]?.resolve(
        replaceHitResponse('$summaryEdit', '$summaryOrig', 'Renamed walrus title')
      )
    );
    await waitFor(() => expect(result.current.items[0]?.titleOfThreadId).toBe(`thread:${key}`));

    expect(result.current.items[0]).toMatchObject({
      threadName: undefined,
      titleOfThreadId: `thread:${key}`,
      snippet: 'Renamed walrus title',
    });
    result.current.items[0]?.onSelect?.();
    expect(openResult).toHaveBeenCalledWith(roomId, {
      mainEventId: '$summaryOrig',
      threadRootId: '$root',
      threadTitle: true,
    });
    expect(client.relations).not.toHaveBeenCalled();
  });

  it('shows thread title on titled thread roots and empty string (never root preview) on untitled roots', async () => {
    const roomId = '!ops:example.org';
    const titledKey = getCrossRoomThreadIndexKey(roomId, '$titledRoot');
    const untitledKey = getCrossRoomThreadIndexKey(roomId, '$untitledRoot');
    store.set(crossRoomThreadIndexAtom, {
      ...emptyCrossRoomThreadIndexSnapshot(),
      entries: new Map([
        [
          titledKey,
          {
            key: titledKey,
            summaryText: 'Quarterly harbor plan',
            rootPreviewText: 'Opening walrus message',
          } as CrossRoomThreadIndexEntry,
        ],
        [
          untitledKey,
          {
            key: untitledKey,
            summaryText: '',
            rootPreviewText: 'Untitled walrus root text',
          } as CrossRoomThreadIndexEntry,
        ],
      ]),
    });
    client.fetchRoomEvent.mockResolvedValue({
      event_id: '$editedRoot',
      content: { msgtype: 'm.text', body: 'Original opening' },
      unsigned: { 'm.relations': { 'org.matrix.msc3440.thread': { count: 2 } } },
    });
    client.relations.mockImplementation(async (_roomId: string, threadId: string) =>
      threadId === '$editedRoot'
        ? {
            events: [summaryMatrixEvent('$sumEdited', 'Edited root title')],
            originalEvent: { getContent: () => ({ msgtype: 'm.text', body: 'Original opening' }) },
          }
        : {
            events: [],
            originalEvent: {
              getContent: () => ({ msgtype: 'm.text', body: 'Untitled walrus root text' }),
            },
          }
    );

    const { result } = renderMessages('walrus');
    await waitFor(() => expect(pending).toHaveLength(1));
    const titled = responseWith('$titledRoot', 'Opening walrus message');
    const untitled = responseWith('$untitledRoot', 'Untitled walrus root text');
    const editedRoot = replaceHitResponse('$rootEdit', '$editedRoot', 'Updated walrus root');
    titled.search_categories.room_events.results?.push(
      ...(untitled.search_categories.room_events.results ?? []),
      ...(editedRoot.search_categories.room_events.results ?? [])
    );
    await act(async () => pending[0]?.resolve(titled));

    await waitFor(() => expect(result.current.items[2]?.threadName).toBe('Edited root title'));
    expect(result.current.items).toMatchObject([
      { id: 'message:!ops:example.org:$titledRoot', threadName: 'Quarterly harbor plan' },
      { id: 'message:!ops:example.org:$untitledRoot', threadName: '' },
      { id: 'message:!ops:example.org:$rootEdit', threadName: 'Edited root title' },
    ]);

    result.current.items[0]?.onSelect?.();
    result.current.items[2]?.onSelect?.();
    expect(openResult).toHaveBeenNthCalledWith(1, roomId, {
      mainEventId: '$titledRoot',
      threadRootId: '$titledRoot',
    });
    expect(openResult).toHaveBeenNthCalledWith(2, roomId, {
      mainEventId: '$editedRoot',
      threadRootId: '$editedRoot',
    });
  });

  it('resolves thread titles from threadSummaryState once loaded without calling client.relations', async () => {
    const roomId = '!ops:example.org';
    const sessionId = 'session-cache-1';
    activeSession.current = { sessionId };

    let resolveCached!: (value: Map<string, ThreadSummaryInfo>) => void;
    loadCachedThreadSummariesMock.mockImplementation(
      () =>
        new Promise<Map<string, ThreadSummaryInfo>>((resolve) => {
          resolveCached = resolve;
        })
    );

    const { result } = renderMessages('walrus');
    await waitFor(() => expect(pending).toHaveLength(1));
    const response = responseWith('$reply', 'walrus status update');
    const hit = response.search_categories.room_events.results?.[0];
    if (!hit) throw new Error('no hit');
    hit.result.content = {
      msgtype: 'm.text',
      body: 'walrus status update',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$cachedRoot' },
    };
    await act(async () => pending[0]?.resolve(response));
    await waitFor(() => expect(result.current.status).toBe('done'));

    // While IndexedDB summaries are still loading, server relations fallback waits.
    expect(loadCachedThreadSummariesMock).toHaveBeenCalledWith(sessionId, roomId);
    expect(client.relations).not.toHaveBeenCalled();

    await act(async () => {
      resolveCached(
        new Map([['$cachedRoot', { summaryText: 'Cached IndexedDB title', eventTs: 100 }]])
      );
    });
    await waitFor(() => expect(result.current.items[0]?.threadName).toBe('Cached IndexedDB title'));
    expect(client.relations).not.toHaveBeenCalled();
  });

  it('falls back to client.relations, persists discovered title, and negative-caches untitled threads and standalone edits', async () => {
    const roomId = '!ops:example.org';
    const sessionId = 'session-fallback-1';
    activeSession.current = { sessionId };
    storeThreadSummaryInState(sessionId, roomId, '$other', { summaryText: 'Unrelated' });

    client.fetchRoomEvent.mockResolvedValue({
      event_id: '$standaloneOrig',
      content: { msgtype: 'm.text', body: 'Plain room note' },
    });
    client.relations.mockImplementation(async (_roomId: string, threadId: string) => {
      if (threadId === '$serverTitled') {
        return {
          events: [
            summaryMatrixEvent('$sum1', 'Early draft', 1_700_000_001_000),
            summaryMatrixEvent('$sum2', 'Server resolved title', 1_700_000_005_000),
          ],
          originalEvent: { getContent: () => ({ msgtype: 'm.text', body: 'Root body' }) },
        };
      }
      return {
        events: [],
        originalEvent: { getContent: () => ({ msgtype: 'm.text', body: 'Untitled root preview' }) },
      };
    });

    const makeReply = (eventId: string, rootId: string, body: string) => {
      const r = responseWith(eventId, body);
      const hit = r.search_categories.room_events.results?.[0];
      if (!hit) throw new Error('no hit');
      hit.result.content = {
        msgtype: 'm.text',
        body,
        'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
      };
      return hit;
    };

    const { result, rerender } = renderMessages('walrus');
    await waitFor(() => expect(pending).toHaveLength(1));
    const response = responseWith('$placeholder', 'walrus');
    const standaloneEdit = replaceHitResponse('$standaloneEdit', '$standaloneOrig', 'Walrus memo')
      .search_categories.room_events.results?.[0];
    if (!standaloneEdit) throw new Error('no edit');
    response.search_categories.room_events.results = [
      makeReply('$r1', '$serverTitled', 'walrus reply one'),
      makeReply('$r2', '$serverUntitled', 'walrus reply two'),
      standaloneEdit,
    ];
    await act(async () => pending[0]?.resolve(response));

    await waitFor(() =>
      expect(result.current.items).toMatchObject([
        { id: 'message:!ops:example.org:$r1', threadName: 'Server resolved title' },
        { id: 'message:!ops:example.org:$r2', threadName: 'Untitled root preview' },
        { id: 'message:!ops:example.org:$standaloneEdit', threadName: undefined },
      ])
    );

    expect(client.relations).toHaveBeenCalledWith(
      roomId,
      '$serverTitled',
      RelationType.Thread,
      EventType.RoomMessage,
      { dir: Direction.Backward, limit: 50 }
    );
    expect(client.relations).toHaveBeenCalledTimes(2);
    expect(client.fetchRoomEvent).toHaveBeenCalledTimes(1);
    expect(getThreadSummaryStateSnapshot(sessionId, roomId).get('$serverTitled')?.summaryText).toBe(
      'Server resolved title'
    );

    // Repeating a query with the untitled thread and standalone edit hits negative caches.
    rerender({ text: 'walrus memo', enabled: true });
    await waitFor(() => expect(pending).toHaveLength(2));
    const second = responseWith('$placeholder2', 'walrus');
    const standaloneEdit2 = replaceHitResponse('$standaloneEdit2', '$standaloneOrig', 'Walrus memo')
      .search_categories.room_events.results?.[0];
    if (!standaloneEdit2) throw new Error('no edit');
    second.search_categories.room_events.results = [
      makeReply('$r3', '$serverUntitled', 'walrus reply three'),
      standaloneEdit2,
    ];
    await act(async () => pending[1]?.resolve(second));
    await waitFor(() => expect(result.current.items[0]?.id).toBe('message:!ops:example.org:$r3'));

    expect(result.current.items).toMatchObject([
      { id: 'message:!ops:example.org:$r3', threadName: 'Untitled root preview' },
      { id: 'message:!ops:example.org:$standaloneEdit2', threadName: undefined },
    ]);
    expect(client.relations).toHaveBeenCalledTimes(2);
    expect(client.fetchRoomEvent).toHaveBeenCalledTimes(1);
  });

  it('resolves titles from room.getThread locally and identifies bundled-relation thread roots', async () => {
    const roomId = '!ops:example.org';
    roomOverrides.set(roomId, {
      getThread: (threadId) =>
        threadId === '$roomThreadRoot'
          ? { events: [summaryMatrixEvent('$roomSum', 'Loaded room thread title')] }
          : undefined,
    });
    client.relations.mockResolvedValue({
      events: [summaryMatrixEvent('$bundledSum', 'Bundled root title')],
      originalEvent: { getContent: () => ({ msgtype: 'm.text', body: 'Bundled walrus root' }) },
    });

    const { result } = renderMessages('walrus');
    await waitFor(() => expect(pending).toHaveLength(1));
    const replyRes = responseWith('$inRoomThread', 'walrus detail');
    const [replyHit] = replyRes.search_categories.room_events.results ?? [];
    if (!replyHit) throw new Error('no hit');
    replyHit.result.content = {
      msgtype: 'm.text',
      body: 'walrus detail',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$roomThreadRoot' },
    };
    const bundledRootRes = responseWith('$bundledRoot', 'Bundled walrus root');
    const [bundledRootHit] = bundledRootRes.search_categories.room_events.results ?? [];
    if (!bundledRootHit) throw new Error('no hit');
    bundledRootHit.result.unsigned = { 'm.relations': { 'm.thread': { count: 3 } } };
    replyRes.search_categories.room_events.results = [replyHit, bundledRootHit];
    await act(async () => pending[0]?.resolve(replyRes));

    await waitFor(() =>
      expect(result.current.items).toMatchObject([
        { id: 'message:!ops:example.org:$inRoomThread', threadName: 'Loaded room thread title' },
        { id: 'message:!ops:example.org:$bundledRoot', threadName: 'Bundled root title' },
      ])
    );
    expect(client.relations).toHaveBeenCalledTimes(1);
    expect(client.relations).toHaveBeenCalledWith(
      roomId,
      '$bundledRoot',
      RelationType.Thread,
      EventType.RoomMessage,
      { dir: Direction.Backward, limit: 50 }
    );
  });

  it('resolves bundled io.mindroom.title on long-thread /relations originalEvent and local root events', async () => {
    const roomId = '!ops:example.org';
    const makeBundledTitle = (rootId: string, summaryEventId: string, title: string) => ({
      'm.relations': {
        'm.thread': {
          count: 80,
          'io.mindroom.title': {
            event_id: summaryEventId,
            sender: '@mindroom_helper:example.org',
            type: 'm.room.message',
            origin_server_ts: 1_700_000_002_000,
            content: {
              msgtype: 'm.notice',
              body: title,
              'io.mindroom.thread_summary': { version: 1, summary: title },
              'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
            },
          },
        },
      },
    });

    // Long thread (>50 replies): /relations returns 0 summary notices in events, but originalEvent bundles io.mindroom.title.
    client.relations.mockResolvedValue({
      events: [],
      originalEvent: new MatrixEvent({
        event_id: '$longRoot',
        room_id: roomId,
        sender: '@alice:example.org',
        origin_server_ts: 1_700_000_000_000,
        type: 'm.room.message',
        content: { msgtype: 'm.text', body: 'Opening long thread' },
        unsigned: makeBundledTitle('$longRoot', '$longTitleEvt', 'Long thread bundled title'),
      }),
    });

    const { result } = renderMessages('walrus');
    await waitFor(() => expect(pending).toHaveLength(1));

    const longReplyRes = responseWith('$longReply', 'walrus reply #75');
    const [longReplyHit] = longReplyRes.search_categories.room_events.results ?? [];
    if (!longReplyHit) throw new Error('no hit');
    longReplyHit.result.content = {
      msgtype: 'm.text',
      body: 'walrus reply #75',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$longRoot' },
    };

    // Direct root search hit carrying bundled io.mindroom.title resolves locally without /relations.
    const localBundledRootRes = responseWith('$localBundledRoot', 'Local walrus root');
    const [localBundledRootHit] = localBundledRootRes.search_categories.room_events.results ?? [];
    if (!localBundledRootHit) throw new Error('no hit');
    localBundledRootHit.result.unsigned = makeBundledTitle(
      '$localBundledRoot',
      '$localTitleEvt',
      'Local bundled root title'
    );

    longReplyRes.search_categories.room_events.results = [longReplyHit, localBundledRootHit];
    await act(async () => pending[0]?.resolve(longReplyRes));

    await waitFor(() =>
      expect(result.current.items).toMatchObject([
        { id: 'message:!ops:example.org:$longReply', threadName: 'Long thread bundled title' },
        {
          id: 'message:!ops:example.org:$localBundledRoot',
          threadName: 'Local bundled root title',
        },
      ])
    );
    expect(client.relations).toHaveBeenCalledTimes(1);
    expect(client.relations).toHaveBeenCalledWith(
      roomId,
      '$longRoot',
      RelationType.Thread,
      EventType.RoomMessage,
      { dir: Direction.Backward, limit: 50 }
    );
  });

  it('ignores primarySummaryText root fallback on untitled crossRoomThreadIndex entries', async () => {
    const roomId = '!ops:example.org';
    const sessionId = 'session-idx-1';
    activeSession.current = { sessionId };
    storeThreadSummaryInState(sessionId, roomId, '$idxCachedTitledRoot', {
      summaryText: 'Cached summary state title',
    });
    const untitledKey = getCrossRoomThreadIndexKey(roomId, '$idxUntitledRoot');
    const cachedTitledKey = getCrossRoomThreadIndexKey(roomId, '$idxCachedTitledRoot');
    const serverTitledKey = getCrossRoomThreadIndexKey(roomId, '$idxServerTitledRoot');
    const makeUntitledIndexEntry = (key: string, rootId: string, rootText: string) =>
      ({
        key,
        roomId,
        threadRootId: rootId,
        // Mirrors crossRoomThreadIndex: entry.summaryText falls back to primarySummaryText (root body)
        // even when threadRecord.presentation.summaryText is undefined.
        summaryText: rootText,
        rootPreviewText: rootText,
        threadRecord: {
          presentation: {
            summaryText: undefined,
            primarySummaryText: rootText,
            rootPreviewText: rootText,
          },
        },
      }) as unknown as CrossRoomThreadIndexEntry;

    store.set(crossRoomThreadIndexAtom, {
      ...emptyCrossRoomThreadIndexSnapshot(),
      entries: new Map([
        [
          untitledKey,
          makeUntitledIndexEntry(untitledKey, '$idxUntitledRoot', 'Walrus opening note'),
        ],
        [
          cachedTitledKey,
          makeUntitledIndexEntry(
            cachedTitledKey,
            '$idxCachedTitledRoot',
            'Walrus cached root text'
          ),
        ],
        [
          serverTitledKey,
          makeUntitledIndexEntry(serverTitledKey, '$idxServerTitledRoot', 'Walrus stale root text'),
        ],
      ]),
    });

    client.relations.mockImplementation(async (_roomId: string, threadId: string) =>
      threadId === '$idxServerTitledRoot'
        ? {
            events: [summaryMatrixEvent('$srvSum', 'Recovered server title')],
            originalEvent: {
              getContent: () => ({ msgtype: 'm.text', body: 'Walrus stale root text' }),
            },
          }
        : {
            events: [],
            originalEvent: {
              getContent: () => ({ msgtype: 'm.text', body: 'Walrus opening note' }),
            },
          }
    );

    const { result } = renderMessages('walrus');
    await waitFor(() => expect(pending).toHaveLength(1));

    const untitledRootRes = responseWith('$idxUntitledRoot', 'Walrus opening note');
    const untitledReplyRes = responseWith('$idxUntitledReply', 'walrus follow-up');
    const cachedTitledRootRes = responseWith('$idxCachedTitledRoot', 'Walrus cached root text');
    const serverTitledRootRes = responseWith('$idxServerTitledRoot', 'Walrus stale root text');
    const serverTitledReplyRes = responseWith('$idxServerTitledReply', 'walrus detail');
    const untitledReplyHit = untitledReplyRes.search_categories.room_events.results?.[0];
    const serverTitledReplyHit = serverTitledReplyRes.search_categories.room_events.results?.[0];
    if (!untitledReplyHit || !serverTitledReplyHit) throw new Error('no hit');
    untitledReplyHit.result.content = {
      msgtype: 'm.text',
      body: 'walrus follow-up',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$idxUntitledRoot' },
    };
    serverTitledReplyHit.result.content = {
      msgtype: 'm.text',
      body: 'walrus detail',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$idxServerTitledRoot' },
    };

    untitledRootRes.search_categories.room_events.results?.push(
      untitledReplyHit,
      ...(cachedTitledRootRes.search_categories.room_events.results ?? []),
      ...(serverTitledRootRes.search_categories.room_events.results ?? []),
      serverTitledReplyHit
    );
    await act(async () => pending[0]?.resolve(untitledRootRes));

    await waitFor(() =>
      expect(result.current.items).toMatchObject([
        // Truly untitled root never repeats its own text as the breadcrumb title.
        { id: 'message:!ops:example.org:$idxUntitledRoot', threadName: '' },
        // Truly untitled reply falls back to rootPreviewText.
        { id: 'message:!ops:example.org:$idxUntitledReply', threadName: 'Walrus opening note' },
        // Cached threadSummaryState title is not suppressed by entry.summaryText and skips /relations.
        {
          id: 'message:!ops:example.org:$idxCachedTitledRoot',
          threadName: 'Cached summary state title',
        },
        // Both root and reply recover the true title via /relations instead of being suppressed.
        {
          id: 'message:!ops:example.org:$idxServerTitledRoot',
          threadName: 'Recovered server title',
        },
        {
          id: 'message:!ops:example.org:$idxServerTitledReply',
          threadName: 'Recovered server title',
        },
      ])
    );
    expect(client.relations).toHaveBeenCalledTimes(2);
  });

  it('prefers a newer bundled root title over an older cached summary in threadSummaryState', async () => {
    const roomId = '!ops:example.org';
    const sessionId = 'session-chrono-1';
    activeSession.current = { sessionId };
    storeThreadSummaryInState(sessionId, roomId, '$chronoRoot', {
      summaryText: 'Older cached title',
      eventId: '$oldSum',
      eventTs: 1_700_000_001_000,
    });

    const { result } = renderMessages('walrus');
    await waitFor(() => expect(pending).toHaveLength(1));
    const response = responseWith('$chronoRoot', 'Walrus chronology root');
    const [hit] = response.search_categories.room_events.results ?? [];
    if (!hit) throw new Error('no hit');
    hit.result.unsigned = {
      'm.relations': {
        'm.thread': {
          count: 4,
          'io.mindroom.title': {
            event_id: '$newSum',
            sender: '@mindroom_helper:example.org',
            type: 'm.room.message',
            origin_server_ts: 1_700_000_009_000,
            content: {
              msgtype: 'm.notice',
              body: 'Newer bundled title',
              'io.mindroom.thread_summary': { version: 1, summary: 'Newer bundled title' },
              'm.relates_to': { rel_type: 'm.thread', event_id: '$chronoRoot' },
            },
          },
        },
      },
    };
    await act(async () => pending[0]?.resolve(response));
    await waitFor(() => expect(result.current.status).toBe('done'));

    expect(result.current.items[0]?.threadName).toBe('Newer bundled title');
    expect(client.relations).not.toHaveBeenCalled();
  });

  it('does not resurrect a redacted server-fetched title when sessionId is active', async () => {
    const roomId = '!ops:example.org';
    const sessionId = 'session-redacted-1';
    activeSession.current = { sessionId };
    client.relations.mockResolvedValue({
      events: [summaryMatrixEvent('$redactedSum', 'Title later redacted', 1_700_000_005_000)],
      originalEvent: { getContent: () => ({ msgtype: 'm.text', body: 'Plain root fallback' }) },
    });

    const { result, rerender } = renderMessages('walrus');
    await waitFor(() => expect(pending).toHaveLength(1));
    const makeHit = (eventId: string, body: string) => {
      const r = responseWith(eventId, body);
      const hit = r.search_categories.room_events.results?.[0];
      if (!hit) throw new Error('no hit');
      hit.result.content = {
        msgtype: 'm.text',
        body,
        'm.relates_to': { rel_type: 'm.thread', event_id: '$redactedRoot' },
      };
      return r;
    };
    await act(async () => pending[0]?.resolve(makeHit('$r1', 'walrus update')));
    await waitFor(() => expect(result.current.items[0]?.threadName).toBe('Title later redacted'));

    act(() => {
      forgetRedactedThreadSummaries(sessionId, roomId, new Set(['$redactedSum']));
    });
    await waitFor(() => expect(result.current.items[0]?.threadName).toBe('Plain root fallback'));

    // Subsequent search in the same session still never resurrects the redacted title or refetches.
    rerender({ text: 'walrus again', enabled: true });
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => pending[1]?.resolve(makeHit('$r2', 'walrus again')));
    await waitFor(() => expect(result.current.items[0]?.id).toBe('message:!ops:example.org:$r2'));
    expect(result.current.items[0]?.threadName).toBe('Plain root fallback');
    expect(client.relations).toHaveBeenCalledTimes(1);
  });

  it('does not permanently cache transient fetchRoomEvent or relations errors', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.fetchRoomEvent.mockRejectedValueOnce(new Error('503 Service Unavailable'));
    client.relations.mockRejectedValueOnce(new Error('503 Service Unavailable'));

    const buildResponse = () => {
      const editRes = replaceHitResponse('$transientEdit', '$transientOrig', 'walrus edited');
      const replyRes = responseWith('$transientReply', 'walrus reply');
      const replyHit = replyRes.search_categories.room_events.results?.[0];
      if (!replyHit) throw new Error('no hit');
      replyHit.result.content = {
        msgtype: 'm.text',
        body: 'walrus reply',
        'm.relates_to': { rel_type: 'm.thread', event_id: '$transientRoot' },
      };
      editRes.search_categories.room_events.results?.push(replyHit);
      return editRes;
    };

    const first = renderMessages('walrus', true, queryClient);
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => pending[0]?.resolve(buildResponse()));
    await waitFor(() => {
      expect(client.fetchRoomEvent).toHaveBeenCalledTimes(1);
      expect(client.relations).toHaveBeenCalledTimes(1);
    });
    expect(first.result.current.items).toMatchObject([
      { id: 'message:!ops:example.org:$transientEdit', threadName: undefined },
      { id: 'message:!ops:example.org:$transientReply', threadName: '' },
    ]);
    first.unmount();

    // Server recovers on palette reopen (same QueryClient): errored queries retry and resolve.
    client.fetchRoomEvent.mockResolvedValue({
      event_id: '$transientOrig',
      content: {
        msgtype: 'm.text',
        body: 'Thinking...',
        'm.relates_to': { rel_type: 'm.thread', event_id: '$transientRoot' },
      },
    });
    client.relations.mockResolvedValue({
      events: [summaryMatrixEvent('$recoveredSum', 'Recovered after 503')],
      originalEvent: { getContent: () => ({ msgtype: 'm.text', body: 'Root' }) },
    });

    const second = renderMessages('walrus', true, queryClient);
    await waitFor(() =>
      expect(second.result.current.items).toMatchObject([
        { id: 'message:!ops:example.org:$transientEdit', threadName: 'Recovered after 503' },
        { id: 'message:!ops:example.org:$transientReply', threadName: 'Recovered after 503' },
      ])
    );
    expect(client.fetchRoomEvent).toHaveBeenCalledTimes(2);
    expect(client.relations).toHaveBeenCalledTimes(2);
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
