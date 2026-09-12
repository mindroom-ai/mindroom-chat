import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { createClient, MatrixEvent, MatrixEventEvent, Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CryptoBackend } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend';
import {
  ThreadApprovalProvider,
  ThreadApprovals,
  useThreadApprovals,
} from './ThreadApprovalProvider';

const mocks = vi.hoisted(() => ({ backfill: vi.fn(), abort: vi.fn() }));
let mx: ReturnType<typeof createClient>;
let room: Room;
let ignored: string[];
const scheduler = { abort: mocks.abort };
vi.mock('../../hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../../hooks/useIgnoredUsers', () => ({ useIgnoredUsers: () => ignored }));
vi.mock('../engine', () => ({
  enqueueThreadApprovalBackfill: mocks.backfill,
  useMindroomSyncEngine: () => ({ scheduler }),
}));
vi.mock('../threads/roomLiveEventArrive', () => ({ useLiveEventArrive: () => undefined }));
let current: ThreadApprovals;
let renderer: ReactTestRenderer;
function Probe() {
  current = useThreadApprovals()!;
  return null;
}
const content = {
  approval_id: 'one',
  tool_name: 'invite',
  agent_name: 'assistant',
  arguments: { user: 'Jamie' },
  status: 'pending',
  requested_at: '2026-09-12T12:00:00Z',
  expires_at: '2999-09-12T12:00:00Z',
  thread_id: '$thread',
};
const event = (id = '$approval', value = content) =>
  new MatrixEvent({
    event_id: id,
    room_id: '!room:example.org',
    sender: '@router:example.org',
    origin_server_ts: 1,
    type: 'io.mindroom.tool_approval',
    content: value,
  });
const mount = async () => {
  await act(async () => {
    renderer = create(
      <ThreadApprovalProvider room={room} threadId="$thread">
        <Probe />
      </ThreadApprovalProvider>
    );
  });
};

beforeEach(() => {
  mocks.backfill.mockReset().mockResolvedValue({ events: [], repairedEventIds: [] });
  mocks.abort.mockReset();
  ignored = [];
  mx = createClient({ baseUrl: 'https://matrix.example.org', userId: '@alice:example.org' });
  room = new Room('!room:example.org', mx, '@alice:example.org');
  mx.store.storeRoom(room);
});
afterEach(() => {
  act(() => renderer?.unmount());
  vi.useRealTimers();
});

describe('thread approval provider lifecycle', () => {
  it('repairs a late-decrypted offscreen origin once through its direct SDK event subscription', async () => {
    const encrypted = new MatrixEvent({
      ...event().event,
      type: 'm.room.encrypted',
      content: { ciphertext: 'late keys' },
    });
    mocks.backfill.mockResolvedValueOnce({ events: [encrypted], repairedEventIds: [] });
    const edit = new MatrixEvent({
      ...event('$edit').event,
      origin_server_ts: 2,
      content: {
        'm.relates_to': { rel_type: 'm.replace', event_id: '$approval' },
        'm.new_content': { ...content, status: 'approved' },
      },
    });
    mocks.backfill.mockResolvedValueOnce({ events: [edit], repairedEventIds: ['$approval'] });
    await mount();
    expect(current.records).toEqual([]);
    expect(encrypted.listenerCount(MatrixEventEvent.Decrypted)).toBe(1);
    await act(async () => {
      await encrypted.attemptDecryption({
        decryptEvent: async () => ({ clearEvent: { type: 'io.mindroom.tool_approval', content } }),
      } as CryptoBackend);
    });
    expect(mocks.backfill).toHaveBeenCalledTimes(2);
    expect(mocks.backfill.mock.calls[1][4]).toEqual([encrypted]);
    expect(current.records[0].approval.status).toBe('approved');
    await act(async () => {
      encrypted.emit(MatrixEventEvent.Decrypted, encrypted);
    });
    expect(mocks.backfill).toHaveBeenCalledTimes(2);
    act(() => renderer.unmount());
    expect(encrypted.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
  });
  it('retains newer bundled replacements when an older fetch completes and removes ignored senders', async () => {
    let finish!: (value: { events: MatrixEvent[]; repairedEventIds: string[] }) => void;
    mocks.backfill.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await mount();
    await act(async () => {
      current.ingest([event()]);
    });
    const updated = event();
    updated.makeReplaced(
      new MatrixEvent({
        ...event('$edit').event,
        origin_server_ts: 2,
        content: {
          'm.relates_to': { rel_type: 'm.replace', event_id: '$approval' },
          'm.new_content': { ...content, status: 'approved' },
        },
      })
    );
    await act(async () => {
      current.ingest([updated]);
      finish({ events: [event()], repairedEventIds: ['$approval'] });
    });
    expect(current.records[0].approval.status).toBe('approved');
    ignored = ['@router:example.org'];
    await act(async () => {
      renderer.update(
        <ThreadApprovalProvider room={room} threadId="$thread">
          <Probe />
        </ThreadApprovalProvider>
      );
    });
    expect(current.records).toEqual([]);
  });
  it('settles local expiry at its deadline without a Matrix edit', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T12:00:00Z'));
    mocks.backfill.mockResolvedValue({
      events: [event('$approval', { ...content, expires_at: '2026-09-12T12:00:02Z' })],
      repairedEventIds: ['$approval'],
    });
    await mount();
    expect(current.records[0].approval.status).toBe('pending');
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(current.records[0].approval.status).toBe('expired');
  });
});
