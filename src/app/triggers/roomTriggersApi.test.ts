import type { MatrixClient } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteRoomTrigger,
  fetchRoomTriggers,
  parseRoomTriggersResponse,
  setRoomTriggerEnabled,
} from './roomTriggersApi';
import { triggerRowJson } from './useRoomTriggers.test.shared';

const sendMock = vi.hoisted(() => vi.fn());

vi.mock('../computer/clientSessions', () => ({
  clientSessions: () => ({ send: sendMock }),
}));

const mx = {} as MatrixClient;
const API_URL = 'https://mindroom.example.org';
const ROOM_ID = '!ops:example.org';

afterEach(() => {
  vi.useRealTimers();
  sendMock.mockReset();
});

describe('roomTriggersApi', () => {
  it('parses valid, unknown-kind, and out-of-range-timestamp rows while dropping malformed rows', () => {
    const parsed = parseRoomTriggersResponse({
      triggers: [
        triggerRowJson({ unknown_future_field: 'ignored' }),
        {
          trigger_id: 'tr_future',
          kind: 'cron_v2',
          relation: 'target',
          description: '',
          thread_mode: 'dm_thread',
          enabled: false,
          last_fired_at: 1e20,
          owner_user_id: '@bob:example.org',
          can_manage: false,
        },
        triggerRowJson({ trigger_id: 'tr_neg_overflow', last_fired_at: -1e20 }),
        triggerRowJson({ trigger_id: '   ' }),
        triggerRowJson({ enabled: 'yes' }),
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
      {
        triggerId: 'tr_neg_overflow',
        kind: 'room_message',
        relation: 'target',
        description: 'Design triage',
        prompt: 'Summarize new issues in the Design channel',
        targetRoomId: ROOM_ID,
        targetThreadId: '$thread1',
        threadMode: 'thread',
        enabled: true,
        disabledReason: null,
        lastFiredAt: null,
        ownerUserId: '@alice:example.org',
        canManage: true,
      },
    ]);
    expect(parseRoomTriggersResponse({ triggers: 'bad' })).toBeNull();
  });

  it('distinguishes empty 200, 404 null, and network throw, and sends PATCH/DELETE mutations', async () => {
    sendMock.mockResolvedValueOnce(new Response(JSON.stringify({ triggers: [] }), { status: 200 }));
    expect(await fetchRoomTriggers(mx, API_URL, ROOM_ID)).toEqual([]);
    expect(sendMock).toHaveBeenCalledWith(
      '/api/rooms/!ops%3Aexample.org/triggers',
      expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) })
    );

    sendMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect(await fetchRoomTriggers(mx, API_URL, ROOM_ID)).toBeNull();

    sendMock.mockRejectedValueOnce(new Error('offline'));
    await expect(fetchRoomTriggers(mx, API_URL, ROOM_ID)).rejects.toThrow('offline');

    sendMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await setRoomTriggerEnabled(mx, API_URL, ROOM_ID, 'tr_123', false);
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
    await expect(deleteRoomTrigger(mx, API_URL, ROOM_ID, 'tr_123')).rejects.toThrow('403');
  });

  it('keeps both caller abort and deadline active while reading res.json()', async () => {
    const abortableResponse = (signal: AbortSignal) =>
      ({
        ok: true,
        json: () =>
          new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(new Error('body aborted')), {
              once: true,
            });
          }),
      }) as unknown as Response;

    // Caller abort during body read aborts the request signal.
    const caller = new AbortController();
    sendMock.mockImplementationOnce(async (_path: string, init: RequestInit) =>
      abortableResponse(init.signal!)
    );
    const callerPending = fetchRoomTriggers(mx, API_URL, ROOM_ID, caller.signal);
    await Promise.resolve();
    caller.abort();
    await expect(callerPending).rejects.toThrow('body aborted');

    // Timeout during body read also aborts the request signal.
    vi.useFakeTimers();
    sendMock.mockImplementationOnce(async (_path: string, init: RequestInit) =>
      abortableResponse(init.signal!)
    );
    const timedPending = fetchRoomTriggers(mx, API_URL, ROOM_ID);
    const settled = expect(timedPending).rejects.toThrow('body aborted');
    await vi.advanceTimersByTimeAsync(10_000);
    await settled;
  });
});
