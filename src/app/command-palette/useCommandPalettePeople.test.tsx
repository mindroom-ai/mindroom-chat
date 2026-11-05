// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Preset, Visibility, type ICreateRoomOpts, type MatrixClient } from 'matrix-js-sdk';
import { createRoomEncryptionState } from '../matrix/createRoom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDirectRoomPath } from '../routes/pathUtils';
import { useCommandPalettePeople, useStartDirectChat } from './useCommandPalettePeople';

type IUserDirectoryResponse = Awaited<ReturnType<MatrixClient['searchUserDirectory']>>;

type PendingSearch = {
  term: string;
  resolve: (response: IUserDirectoryResponse) => void;
  reject: (error: Error) => void;
};

const { client, direct, navigate, pending } = vi.hoisted(() => {
  const searches: PendingSearch[] = [];
  const mDirect: { current: Record<string, string[]> } = { current: {} };
  return {
    pending: searches,
    direct: mDirect,
    navigate: vi.fn(),
    client: {
      getSafeUserId: () => '@me:example.org',
      getHomeserverUrl: () => 'https://example.org',
      mxcUrlToHttp: (mxc: string) => `https://example.org/thumbnail/${mxc.slice('mxc://'.length)}`,
      searchUserDirectory: vi.fn(
        ({ term }: { term: string; limit?: number }) =>
          new Promise<IUserDirectoryResponse>((resolve, reject) => {
            searches.push({ term, resolve, reject });
          })
      ),
      getProfileInfo:
        vi.fn<(userId: string) => Promise<{ displayname?: string; avatar_url?: string }>>(),
      getAccountData: vi.fn(() => ({ getContent: () => mDirect.current })),
      getRoom: vi.fn((roomId: string) => ({ roomId, getMyMembership: () => 'join' })),
      createRoom: vi.fn(async (options: ICreateRoomOpts) => {
        void options;
        return { room_id: '!new:example.org' };
      }),
      setAccountData: vi.fn(async () => ({})),
    },
  };
});

vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => client }));
vi.mock('../matrix/hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => navigate,
}));

const directoryWith = (...users: [string, string?, string?][]): IUserDirectoryResponse => ({
  limited: false,
  results: users.map(([user_id, display_name, avatar_url]) => ({
    user_id,
    display_name,
    avatar_url,
  })),
});

const renderPeople = (text: string, enabled = true) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(
    (props: { text: string; enabled: boolean }) =>
      useCommandPalettePeople(props.text, props.enabled),
    { wrapper, initialProps: { text, enabled } }
  );
};

afterEach(() => {
  pending.length = 0;
  direct.current = {};
  client.searchUserDirectory.mockClear();
  client.getProfileInfo.mockReset();
  client.createRoom.mockClear();
  client.setAccountData.mockClear();
  navigate.mockClear();
});

describe('useCommandPalettePeople', () => {
  it('waits for typing to pause and then asks the directory once, for the last text', async () => {
    const { result, rerender } = renderPeople('q');
    rerender({ text: 'qu', enabled: true });
    rerender({ text: 'quin', enabled: true });
    expect(result.current.status).toBe('loading');
    expect(client.searchUserDirectory).not.toHaveBeenCalled();
    await waitFor(() => expect(client.searchUserDirectory).toHaveBeenCalledTimes(1));
    expect(client.searchUserDirectory).toHaveBeenCalledWith({ term: 'quin', limit: 20 });
  });

  it('never shows the people of an older text, whichever answers first', async () => {
    const { result, rerender } = renderPeople('quin');
    await waitFor(() => expect(pending).toHaveLength(1));
    rerender({ text: 'quinn', enabled: true });
    await waitFor(() => expect(pending).toHaveLength(2));
    const [older, newer] = pending;

    await act(async () => older?.resolve(directoryWith(['@quincy:example.org', 'Quincy Adams'])));
    expect(result.current.status).toBe('loading');
    expect(result.current.items).toEqual([]);

    await act(async () =>
      newer?.resolve(
        directoryWith(['@quinn:example.org', 'Quinn Harper', 'mxc://example.org/quinn'])
      )
    );
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(result.current.items.map((item) => item.userId)).toEqual(['@quinn:example.org']);
    expect(result.current.items[0]).toMatchObject({
      id: 'user:@quinn:example.org',
      kind: 'user',
      displayName: 'Quinn Harper',
      localpart: 'quinn',
      avatarUrl: 'https://example.org/thumbnail/example.org/quinn',
    });

    // The next text is loading until its own answer comes; these people do not stand in for it.
    rerender({ text: 'quinny', enabled: true });
    await waitFor(() => expect(pending).toHaveLength(3));
    expect(result.current.status).toBe('loading');
    expect(result.current.items).toEqual([]);
  });

  it('leaves the account itself out and names people without a name by their ID', async () => {
    const { result } = renderPeople('example');
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () =>
      pending[0]?.resolve(directoryWith(['@me:example.org', 'Me'], ['@rosa:example.org']))
    );
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({
      userId: '@rosa:example.org',
      displayName: 'rosa',
    });
  });

  it('reports a failed search as an error', async () => {
    const { result } = renderPeople('quinn');
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => pending[0]?.reject(new Error('M_UNKNOWN')));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.items).toEqual([]);
  });

  it('asks nothing while disabled or without text', async () => {
    const { result, rerender } = renderPeople('quinn', false);
    expect(result.current.status).toBe('idle');
    rerender({ text: '', enabled: true });
    expect(result.current.status).toBe('idle');
    await new Promise((resolve) => {
      setTimeout(resolve, 300);
    });
    expect(client.searchUserDirectory).not.toHaveBeenCalled();
  });

  it('offers a Matrix ID typed in full that the directory does not return, with its profile', async () => {
    client.getProfileInfo.mockResolvedValue({
      displayname: 'Zed Zimmer',
      avatar_url: 'mxc://example.org/zed',
    });
    const { result } = renderPeople('@zed:example.org');
    await waitFor(() => expect(pending).toHaveLength(1));
    // The directory matches part of an ID, so the @ is left off.
    expect(pending[0]?.term).toBe('zed:example.org');
    expect(client.getProfileInfo).toHaveBeenCalledWith('@zed:example.org');
    await act(async () => pending[0]?.resolve(directoryWith(['@ezed:example.org', 'Ezed'])));
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(result.current.items.map((item) => [item.userId, item.typedId])).toEqual([
      ['@ezed:example.org', undefined],
      ['@zed:example.org', true],
    ]);
    expect(result.current.items[1]).toMatchObject({
      displayName: 'Zed Zimmer',
      avatarUrl: 'https://example.org/thumbnail/example.org/zed',
    });
  });

  it('still offers the typed Matrix ID when its profile lookup and the search fail', async () => {
    client.getProfileInfo.mockRejectedValue(new Error('M_NOT_FOUND'));
    const { result } = renderPeople('@zed:example.org');
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => pending[0]?.reject(new Error('M_UNKNOWN')));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({
      userId: '@zed:example.org',
      displayName: 'zed',
      typedId: true,
    });
    expect(result.current.items[0]?.avatarUrl).toBeUndefined();
  });

  it('gives a typed Matrix ID that the directory lists, or the account itself, no extra row', async () => {
    client.getProfileInfo.mockResolvedValue({ displayname: 'Zed Zimmer' });
    const { result, rerender } = renderPeople('@zed:example.org');
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => pending[0]?.resolve(directoryWith(['@zed:example.org', 'Zed Zimmer'])));
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(result.current.items.map((item) => item.typedId)).toEqual([undefined]);

    rerender({ text: '@me:example.org', enabled: true });
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => pending[1]?.resolve(directoryWith()));
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(result.current.items).toEqual([]);
    expect(client.getProfileInfo).not.toHaveBeenCalledWith('@me:example.org');
  });
});

describe('useStartDirectChat', () => {
  it('opens the direct chat the account has instead of starting another', async () => {
    direct.current = { '@quinn:example.org': ['!dm:example.org'] };
    const { result } = renderHook(() => useStartDirectChat());
    await act(() => result.current('@quinn:example.org'));
    expect(client.createRoom).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(getDirectRoomPath('!dm:example.org'));
  });

  it('starts an encrypted direct chat that invites the person and lists it in m.direct', async () => {
    const { result } = renderHook(() => useStartDirectChat());
    await act(() => result.current('@quinn:example.org'));
    const options = client.createRoom.mock.calls[0]?.[0];
    expect(options).toMatchObject({ invite: ['@quinn:example.org'], is_direct: true });
    // Create Chat's room: the invitee gets the creator's power, and it is encrypted.
    expect([options?.preset, options?.visibility]).toEqual([
      Preset.TrustedPrivateChat,
      Visibility.Private,
    ]);
    expect(options?.initial_state).toEqual([createRoomEncryptionState()]);
    expect(client.setAccountData).toHaveBeenCalledWith('m.direct', {
      '@quinn:example.org': ['!new:example.org'],
    });
    expect(navigate).toHaveBeenCalledWith(getDirectRoomPath('!new:example.org'));
  });
});
