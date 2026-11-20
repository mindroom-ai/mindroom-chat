// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import { agentProfilePath, useAgentProfile } from './useAgentProfile';

const server = vi.hoisted(() => ({
  apiUrl: 'https://mindroom.example' as string | undefined,
  pending: false,
}));
const send = vi.hoisted(() => vi.fn<(path: string, init: RequestInit) => Promise<Response>>());

const client = vi.hoisted(() => ({}));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => client }));
vi.mock('../../computer/useAgentMindroomServer', () => ({
  useAgentMindroomServer: () => server,
}));
vi.mock('../../computer/clientSessions', () => ({ clientSessions: () => ({ send }) }));

const AGENT = '@mindroom_helper:x';
const PROFILE = {
  role: 'Plans the week',
  model: { config: 'luna' },
  tools: [{ name: 'shell', display_name: 'Shell', description: 'Runs', category: 'development' }],
};
const membership = { me: 'join', agent: 'join' };
const room = {
  roomId: '!room:x',
  getMyMembership: () => membership.me,
  getMember: () => ({ membership: membership.agent }),
} as unknown as Room;

const open = () => renderHook(() => useAgentProfile(room, AGENT));

beforeEach(() => {
  server.apiUrl = 'https://mindroom.example';
  server.pending = false;
  membership.me = 'join';
  membership.agent = 'join';
  send.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('useAgentProfile', () => {
  it('asks the agent server afresh on every open of the card', async () => {
    send.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(PROFILE))));
    const first = open();
    expect(first.result.current.status).toBe('loading');
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    expect(send).toHaveBeenCalledWith(
      '/api/rooms/!room%3Ax/agents/%40mindroom_helper%3Ax/profile',
      expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) })
    );
    expect(agentProfilePath('!a:x', '@b:x')).toBe('/api/rooms/!a%3Ax/agents/%40b%3Ax/profile');
    first.unmount();
    const again = open();
    await waitFor(() => expect(again.result.current.status).toBe('ready'));
    expect(send).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      'an older server without the route',
      () => Promise.resolve(new Response('{}', { status: 404 })),
    ],
    ['a refused agent', () => Promise.resolve(new Response('{}', { status: 403 }))],
    ['no answer', () => Promise.reject(new Error('offline'))],
  ])('gives none for %s', async (_case, answer) => {
    send.mockImplementation(answer);
    const { result } = open();
    await waitFor(() => expect(result.current.status).toBe('none'));
  });

  it('stops asking when the card closes, and gives none after a stalled ask', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    send.mockImplementation(
      (_path, init) =>
        new Promise((_resolve, reject) => {
          signals.push(init.signal!);
          init.signal!.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );
    const closed = open();
    closed.unmount();
    expect(signals[0]!.aborted).toBe(true);

    const stalled = open();
    expect(stalled.result.current.status).toBe('loading');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(signals[1]!.aborted).toBe(true);
    expect(stalled.result.current.status).toBe('none');
  });

  it('hides the profile at once when either side leaves or the server is no longer trusted', async () => {
    send.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(PROFILE))));
    const { result, rerender } = open();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    membership.agent = 'leave';
    rerender();
    expect(result.current.status).toBe('none');
    membership.agent = 'join';
    membership.me = 'ban';
    rerender();
    expect(result.current.status).toBe('none');
    membership.me = 'join';
    server.apiUrl = undefined;
    rerender();
    expect(result.current.status).toBe('none');
    // Another trusted server: the answer of the first one is not shown for it.
    server.apiUrl = 'https://other.example';
    rerender();
    expect(result.current.status).toBe('loading');
  });

  it('asks nothing while Chat may ask no server', () => {
    server.apiUrl = undefined;
    expect(open().result.current.status).toBe('none');
    expect(send).not.toHaveBeenCalled();
  });
});
