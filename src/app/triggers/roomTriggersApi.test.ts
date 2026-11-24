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

describe('parseRoomTriggersResponse', () => {
  it('parses valid rows, ignores unknown fields, accepts null/missing optionals, and drops malformed rows', () => {
    const parsed = parseRoomTriggersResponse({
      extra_envelope_field: true,
      triggers: [
        validRow({ unknown_future_field: 'ignored', secret_like: 'ignored' }),
        {
          trigger_id: 'tr_hook',
          kind: 'webhook',
          relation: 'watch',
          description: '',
          thread_mode: 'room',
          enabled: false,
          disabled_reason: 'future_reason',
          owner_user_id: '@bob:example.org',
          can_manage: false,
        },
        validRow({ kind: 'unknown_kind' }),
        validRow({ trigger_id: '   ' }),
        validRow({ enabled: 'yes' }),
        null,
        'not-an-object',
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
        triggerId: 'tr_hook',
        kind: 'webhook',
        relation: 'watch',
        description: '',
        prompt: null,
        targetRoomId: null,
        targetThreadId: null,
        threadMode: 'room',
        enabled: false,
        disabledReason: 'future_reason',
        lastFiredAt: null,
        ownerUserId: '@bob:example.org',
        canManage: false,
      },
    ]);
  });

  it('returns an empty list for non-object or missing triggers payloads', () => {
    expect(parseRoomTriggersResponse(null)).toEqual([]);
    expect(parseRoomTriggersResponse({ triggers: 'bad' })).toEqual([]);
  });
});

describe('room triggers HTTP requests', () => {
  it('fetches with redirect error and returns empty on 404, 403, or network failure', async () => {
    sendMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ triggers: [validRow()] }), { status: 200 })
    );
    const rows = await fetchRoomTriggers(mx, API_URL, ROOM_ID);
    expect(rows).toHaveLength(1);
    expect(sendMock).toHaveBeenCalledWith(
      '/api/rooms/!ops%3Aexample.org/triggers',
      expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) })
    );

    sendMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect(await fetchRoomTriggers(mx, API_URL, ROOM_ID)).toEqual([]);

    sendMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
    expect(await fetchRoomTriggers(mx, API_URL, ROOM_ID)).toEqual([]);

    sendMock.mockRejectedValueOnce(new Error('offline'));
    expect(await fetchRoomTriggers(mx, API_URL, ROOM_ID)).toEqual([]);
  });

  it('rethrows when the caller aborts the fetch', async () => {
    const controller = new AbortController();
    controller.abort();
    sendMock.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));
    await expect(fetchRoomTriggers(mx, API_URL, ROOM_ID, controller.signal)).rejects.toThrow();
  });

  it('sends PATCH for enable/disable and DELETE for removal, throwing with status on non-OK', async () => {
    sendMock.mockResolvedValueOnce(
      new Response(JSON.stringify(validRow({ enabled: false, disabled_reason: 'manual' })), {
        status: 200,
      })
    );
    const updated = await setRoomTriggerEnabled(mx, API_URL, ROOM_ID, 'tr_123', false);
    expect(updated?.enabled).toBe(false);
    expect(sendMock).toHaveBeenCalledWith(
      '/api/rooms/!ops%3Aexample.org/triggers/tr_123',
      expect.objectContaining({
        method: 'PATCH',
        redirect: 'error',
        body: JSON.stringify({ enabled: false }),
      })
    );

    sendMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(setRoomTriggerEnabled(mx, API_URL, ROOM_ID, 'tr_123', true)).rejects.toMatchObject(
      { status: 403 }
    );

    sendMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await deleteRoomTrigger(mx, API_URL, ROOM_ID, 'tr_123');
    expect(sendMock).toHaveBeenLastCalledWith(
      '/api/rooms/!ops%3Aexample.org/triggers/tr_123',
      expect.objectContaining({ method: 'DELETE', redirect: 'error' })
    );

    sendMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(deleteRoomTrigger(mx, API_URL, ROOM_ID, 'tr_123')).rejects.toMatchObject({
      status: 404,
    });
  });
});
