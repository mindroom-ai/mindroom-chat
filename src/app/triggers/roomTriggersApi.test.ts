import type { MatrixClient } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteRoomTrigger,
  fetchRoomTriggers,
  parseRoomTriggersResponse,
  setRoomTriggerEnabled,
} from './roomTriggersApi';

const sendMock = vi.hoisted(() => vi.fn());

vi.mock('../computer/clientSessions', () => ({
  clientSessions: () => ({ send: sendMock }),
}));

const mx = {} as MatrixClient;
const API_URL = 'https://mindroom.example.org';
const ROOM_ID = '!ops:example.org';

const validRow = (overrides: Record<string, unknown> = {}) => ({
  trigger_id: 'tr_123',
  kind: 'room_message',
  relation: 'target',
  description: 'Design triage',
  prompt: 'Summarize new issues in the Design channel',
  target_room_id: ROOM_ID,
  target_thread_id: '$thread1',
  thread_mode: 'thread',
  enabled: true,
  disabled_reason: null,
  last_fired_at: 1764000000000,
  owner_user_id: '@alice:example.org',
  can_manage: true,
  ...overrides,
});

afterEach(() => {
  sendMock.mockReset();
});

describe('roomTriggersApi', () => {
  it('parses valid and unknown-kind rows while dropping malformed rows', () => {
    const parsed = parseRoomTriggersResponse({
      triggers: [
        validRow({ unknown_future_field: 'ignored' }),
        {
          trigger_id: 'tr_future',
          kind: 'cron_v2',
          relation: 'target',
          description: '',
          thread_mode: 'dm_thread',
          enabled: false,
          owner_user_id: '@bob:example.org',
          can_manage: false,
        },
        validRow({ trigger_id: '   ' }),
        validRow({ enabled: 'yes' }),
        null,
      ],
    });

    expect(parsed).toEqual([
      {
        triggerId: 'tr_123',
        kind: 'room_message',
        relation: 'target',
        description: 'Design triage',
        prompt: 'Summarize new issues in the Design channel',
        targetRoomId: ROOM_ID,
        targetThreadId: '$thread1',
        threadMode: 'thread',
        enabled: true,
        disabledReason: null,
        lastFiredAt: 1764000000000,
        ownerUserId: '@alice:example.org',
        canManage: true,
      },
      {
        triggerId: 'tr_future',
        kind: 'cron_v2',
        relation: 'target',
        description: '',
        prompt: null,
        targetRoomId: null,
        targetThreadId: null,
        threadMode: 'dm_thread',
        enabled: false,
        disabledReason: null,
        lastFiredAt: null,
        ownerUserId: '@bob:example.org',
        canManage: false,
      },
    ]);
    expect(parseRoomTriggersResponse({ triggers: 'bad' })).toBeNull();
  });

  it('distinguishes empty 200 from 404 failure and sends PATCH/DELETE mutations', async () => {
    sendMock.mockResolvedValueOnce(new Response(JSON.stringify({ triggers: [] }), { status: 200 }));
    expect(await fetchRoomTriggers(mx, API_URL, ROOM_ID)).toEqual([]);
    expect(sendMock).toHaveBeenCalledWith(
      '/api/rooms/!ops%3Aexample.org/triggers',
      expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) })
    );

    sendMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect(await fetchRoomTriggers(mx, API_URL, ROOM_ID)).toBeNull();

    sendMock.mockResolvedValueOnce(
      new Response(JSON.stringify(validRow({ enabled: false })), { status: 200 })
    );
    expect((await setRoomTriggerEnabled(mx, API_URL, ROOM_ID, 'tr_123', false))?.enabled).toBe(
      false
    );
    expect(sendMock).toHaveBeenLastCalledWith(
      '/api/rooms/!ops%3Aexample.org/triggers/tr_123',
      expect.objectContaining({
        method: 'PATCH',
        redirect: 'error',
        body: JSON.stringify({ enabled: false }),
      })
    );

    sendMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await deleteRoomTrigger(mx, API_URL, ROOM_ID, 'tr_123');
    expect(sendMock).toHaveBeenLastCalledWith(
      '/api/rooms/!ops%3Aexample.org/triggers/tr_123',
      expect.objectContaining({ method: 'DELETE', redirect: 'error' })
    );

    sendMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(deleteRoomTrigger(mx, API_URL, ROOM_ID, 'tr_123')).rejects.toMatchObject({
      status: 403,
    });
  });
});
