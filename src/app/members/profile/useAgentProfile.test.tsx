// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agentProfilePath, useAgentProfile } from './useAgentProfile';

const server = vi.hoisted(() => ({
  apiUrl: 'https://mindroom.example' as string | undefined,
  pending: false,
}));
const send = vi.hoisted(() => vi.fn<(path: string) => Promise<Response>>());
const client = vi.hoisted(() => ({}));

vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => client }));
vi.mock('../../computer/useAgentMindroomServer', () => ({
  useAgentMindroomServer: () => server,
}));
vi.mock('../../computer/clientSessions', () => ({ clientSessions: () => ({ send }) }));

const PROFILE = {
  role: 'Plans the week',
  model: { config: 'luna' },
  tools: [{ name: 'shell', display_name: 'Shell', description: 'Runs', category: 'development' }],
};

let serial = 0;
/** A room no earlier test asked about, so the answer is not one kept from before. */
const freshRoom = () => {
  serial += 1;
  return `!room${serial}:x`;
};

beforeEach(() => {
  server.apiUrl = 'https://mindroom.example';
  server.pending = false;
  send.mockReset();
});

describe('useAgentProfile', () => {
  it('asks the agent server for the profile once and keeps the answer for the next card', async () => {
    send.mockResolvedValue(new Response(JSON.stringify(PROFILE)));
    const roomId = freshRoom();
    const first = renderHook(() => useAgentProfile(roomId, '@mindroom_helper:x'));
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    expect(send).toHaveBeenCalledWith(agentProfilePath(roomId, '@mindroom_helper:x'), {
      redirect: 'error',
    });
    expect(agentProfilePath('!a:x', '@b:x')).toBe('/api/rooms/!a%3Ax/agents/%40b%3Ax/profile');
    const again = renderHook(() => useAgentProfile(roomId, '@mindroom_helper:x'));
    await waitFor(() => expect(again.result.current.status).toBe('ready'));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'an older server without the route',
      () => Promise.resolve(new Response('{}', { status: 404 })),
    ],
    ['a refused agent', () => Promise.resolve(new Response('{}', { status: 403 }))],
    ['no answer', () => Promise.reject(new Error('offline'))],
  ])('gives none for %s, and asks again next time', async (_case, answer) => {
    send.mockImplementation(answer);
    const roomId = freshRoom();
    const first = renderHook(() => useAgentProfile(roomId, '@mindroom_helper:x'));
    await waitFor(() => expect(first.result.current.status).toBe('none'));
    const again = renderHook(() => useAgentProfile(roomId, '@mindroom_helper:x'));
    await waitFor(() => expect(again.result.current.status).toBe('none'));
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('gives none without asking when Chat may ask no server for the agent', async () => {
    server.apiUrl = undefined;
    const roomId = freshRoom();
    const { result } = renderHook(() => useAgentProfile(roomId, '@mindroom_helper:x'));
    await waitFor(() => expect(result.current.status).toBe('none'));
    expect(send).not.toHaveBeenCalled();
  });
});
