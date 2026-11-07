// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ISearchResponse } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasEncryptedRooms, useCommandPaletteMessages } from './useCommandPaletteMessages';

type PendingSearch = {
  term: string;
  signal?: AbortSignal;
  resolve: (response: ISearchResponse) => void;
  reject: (error: Error) => void;
};

const { client, navigate, openResult, pending } = vi.hoisted(() => {
  const searches: PendingSearch[] = [];
  return {
    pending: searches,
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
      }),
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
  } as unknown as ISearchResponse);

const renderMessages = (text: string, enabled = true) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(
    (props: { text: string; enabled: boolean }) =>
      useCommandPaletteMessages(props.text, props.enabled),
    { wrapper, initialProps: { text, enabled } }
  );
};

afterEach(() => {
  pending.length = 0;
  client.search.mockClear();
  navigate.mockClear();
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
    } as unknown as typeof hit.result.unsigned;
    await act(async () => pending[0]?.resolve(response));
    await waitFor(() => expect(result.current.status).toBe('done'));

    expect(result.current.items[0]?.snippet).toBe('The walrus plan: see the list and run it.');
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
