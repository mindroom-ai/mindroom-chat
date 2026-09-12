import { createClient, Room } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { createBackfillScheduler } from './backfillScheduler';
import { enqueueThreadApprovalBackfill } from './threadApprovalBackfill';
import { collectThreadApprovals } from '../messages/threadApprovalModel';

const roomId = '!room:example.org';
const threadId = '$thread';
const original = {
  room_id: roomId,
  event_id: '$approval',
  sender: '@router:example.org',
  type: 'io.mindroom.tool_approval',
  origin_server_ts: 1,
  content: {
    approval_id: 'one',
    tool_name: 'invite',
    agent_name: 'assistant',
    arguments: { user: 'Jamie' },
    status: 'pending',
    requested_at: '2026-09-12T12:00:00Z',
    expires_at: '2999-09-12T12:00:00Z',
    thread_id: threadId,
  },
};
const setup = () => {
  const mx = createClient({ baseUrl: 'https://matrix.example.org' });
  const room = new Room(roomId, mx, '@alice:example.org');
  mx.store.storeRoom(room);
  return { mx, room, scheduler: createBackfillScheduler({ mx }) };
};

describe('thread approval backfill', () => {
  it('drains empty pages and repairs an old decision outside the visible timeline', async () => {
    const { mx, scheduler } = setup();
    const edit = {
      ...original,
      event_id: '$decision',
      origin_server_ts: 2,
      content: {
        'm.relates_to': { rel_type: 'm.replace', event_id: '$approval' },
        'm.new_content': { ...original.content, status: 'approved' },
      },
    };
    const fetch = vi
      .spyOn(mx, 'fetchRelations')
      .mockResolvedValueOnce({ chunk: [], next_batch: 'next' })
      .mockResolvedValueOnce({ chunk: [original] })
      .mockResolvedValueOnce({ chunk: [edit] });
    const result = await enqueueThreadApprovalBackfill(mx, scheduler, roomId, threadId);
    expect(result.error).toBeUndefined();
    expect(fetch.mock.calls.map((call) => [call[1], call[4]?.from])).toEqual([
      [threadId, undefined],
      [threadId, 'next'],
      ['$approval', undefined],
    ]);
    expect(collectThreadApprovals(result.events, roomId, threadId)[0].approval.status).toBe(
      'approved'
    );
    expect(result.repairedEventIds).toEqual(['$approval']);
  });
  it('retains undecrypted events for late-key recovery instead of silently discarding them', async () => {
    const { mx, room, scheduler } = setup();
    vi.spyOn(room, 'hasEncryptionStateEvent').mockReturnValue(true);
    const encrypted = {
      ...original,
      type: 'm.room.encrypted',
      content: { ciphertext: 'waiting for keys' },
    };
    vi.spyOn(mx, 'fetchRelations').mockResolvedValue({ chunk: [encrypted] });
    const decrypt = vi.spyOn(mx, 'decryptEventIfNeeded').mockResolvedValue();
    const result = await enqueueThreadApprovalBackfill(mx, scheduler, roomId, threadId);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].getType()).toBe('m.room.encrypted');
    expect(decrypt).toHaveBeenCalledWith(result.events[0]);
    expect(result.repairedEventIds).toEqual([]);
  });
  it('returns partial history with an error and never loops on repeated pagination tokens', async () => {
    const { mx, scheduler } = setup();
    const fetch = vi
      .spyOn(mx, 'fetchRelations')
      .mockResolvedValue({ chunk: [original], next_batch: 'same' });
    const result = await enqueueThreadApprovalBackfill(mx, scheduler, roomId, threadId);
    expect(result.error).toBeTruthy();
    expect(result.events.length).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('stops before another request after a running job is cancelled', async () => {
    const { mx, scheduler } = setup();
    let release!: (value: { chunk: typeof original[]; next_batch: string }) => void;
    const fetch = vi.spyOn(mx, 'fetchRelations').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    const job = enqueueThreadApprovalBackfill(mx, scheduler, roomId, threadId);
    const outcome = job.catch(() => undefined);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    scheduler.abort(roomId, threadId, 'thread-approvals');
    release({ chunk: [original], next_batch: 'more' });
    await outcome;
    expect(fetch).toHaveBeenCalledOnce();
  });
});
