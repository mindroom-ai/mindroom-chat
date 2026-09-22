import { EventStatus, MatrixEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionId } from '../../state/sessions';
import { getMindroomThreadSummaryInfo } from '../messages/threadSummary';
import { requestThreadSummary, saveThreadSummary } from './threadSummaryActions';
import { clearThreadSummarySharedState, getThreadSummaryStateSnapshot } from './threadSummaryState';

vi.mock('./cacheStore', () => ({
  loadCachedThreadSummaries: vi.fn().mockResolvedValue(new Map()),
  saveCachedThreadSummary: vi.fn().mockResolvedValue(undefined),
}));

const getStoredSummary = () =>
  getThreadSummaryStateSnapshot(
    createSessionId('https://matrix.test', '@me:test'),
    '!room:test'
  ).get('$root');

const setup = () => {
  const root = new MatrixEvent({
    event_id: '$root',
    room_id: '!room:test',
    sender: '@me:test',
    origin_server_ts: 1,
    type: 'm.room.message',
    content: { msgtype: 'm.text', body: 'Root' },
  });
  const room = {
    roomId: '!room:test',
    getThread: () => undefined,
    getEventForTxnId: () => undefined,
    findEventById: (id: string) => (id === '$root' ? root : undefined),
    getMember: (id: string) =>
      id === '@mindroom_helper:test' ? { membership: 'join' } : undefined,
    getMyMembership: () => 'join',
    currentState: { maySendEvent: () => true },
  } as unknown as Room;
  const sendMessage = vi.fn().mockResolvedValue({ event_id: '$summary' });
  const mx = {
    sendMessage,
    getSafeUserId: () => '@me:test',
    getHomeserverUrl: () => 'https://matrix.test',
    makeTxnId: () => 'summary-transaction',
    cancelPendingEvent: vi.fn(),
  } as unknown as MatrixClient;
  return { room, mx, sendMessage };
};

describe('thread summary actions', () => {
  beforeEach(() => clearThreadSummarySharedState());

  it('updates shared overview and banner state only after the server accepts a manual summary', async () => {
    const { room, mx, sendMessage } = setup();
    let accept!: (value: { event_id: string }) => void;
    sendMessage.mockReturnValue(
      new Promise((resolve) => {
        accept = resolve;
      })
    );
    const save = saveThreadSummary(mx, room, '$root', 'New title');
    expect(getStoredSummary()).toBeUndefined();
    accept({ event_id: '$summary' });
    await save;
    expect(getStoredSummary()).toMatchObject({ summaryText: 'New title', isManual: true });
  });
  it('removes its failed local echo so a retry does not leave a stale summary or block sends', async () => {
    const { room, mx, sendMessage } = setup();
    const pending = new MatrixEvent({
      event_id: '~local',
      type: 'm.room.message',
      content: { body: 'Failed summary', msgtype: 'm.notice' },
    });
    pending.setStatus(EventStatus.NOT_SENT);
    room.getEventForTxnId = vi.fn().mockReturnValue(pending);
    sendMessage.mockRejectedValue(new Error('Offline'));
    await expect(saveThreadSummary(mx, room, '$root', 'Failed summary')).rejects.toThrow('Offline');
    expect(room.getEventForTxnId).toHaveBeenCalledWith('summary-transaction');
    expect(mx.cancelPendingEvent).toHaveBeenCalledWith(pending);
  });
  it('publishes a normalized manual summary through the shared notice format in the selected thread', async () => {
    const { room, mx, sendMessage } = setup();
    await saveThreadSummary(mx, room, '$root', '  Updated\n summary  ');
    const [roomId, threadId, content] = sendMessage.mock.calls[0];
    expect([roomId, threadId]).toEqual(['!room:test', '$root']);
    expect(content).toMatchObject({
      msgtype: 'm.notice',
      body: 'Updated summary',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
      'io.mindroom.thread_summary': { version: 1, summary: 'Updated summary', model: 'manual' },
    });
    expect(getMindroomThreadSummaryInfo(content)?.summaryText).toBe('Updated summary');
    expect(getMindroomThreadSummaryInfo(content)?.generatedTs).toBeGreaterThan(0);
  });

  it.each(['', '  ', 'x'.repeat(301)])(
    'rejects invalid summary text without sending',
    async (text) => {
      const { room, mx, sendMessage } = setup();
      await expect(saveThreadSummary(mx, room, '$root', text)).rejects.toThrow();
      expect(sendMessage).not.toHaveBeenCalled();
    }
  );

  it.each(['~pending', '$missing'])(
    'does not mutate an unconfirmed or unknown thread: %s',
    async (rootId) => {
      const { room, mx, sendMessage } = setup();
      await expect(saveThreadSummary(mx, room, rootId, 'Summary')).rejects.toThrow();
      await expect(
        requestThreadSummary(mx, room, rootId, '@mindroom_helper:test')
      ).rejects.toThrow();
      expect(sendMessage).not.toHaveBeenCalled();
    }
  );

  it('requests regeneration from exactly the selected agent inside the selected thread', async () => {
    const { room, mx, sendMessage } = setup();
    await requestThreadSummary(mx, room, '$root', '@mindroom_helper:test');
    expect(sendMessage).toHaveBeenCalledWith(
      '!room:test',
      '$root',
      expect.objectContaining({
        msgtype: 'm.text',
        'm.mentions': { user_ids: ['@mindroom_helper:test'] },
        'm.relates_to': expect.objectContaining({ rel_type: 'm.thread', event_id: '$root' }),
      }),
      'summary-transaction'
    );
    expect(sendMessage.mock.calls[0][2].body).toContain('set_thread_summary');
    expect(sendMessage.mock.calls[0][2].body).toContain('pin=false');
  });

  it('rejects an agent that is no longer joined', async () => {
    const { room, mx, sendMessage } = setup();
    await expect(
      requestThreadSummary(mx, room, '$root', '@mindroom_absent:test')
    ).rejects.toThrow();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('propagates send failure so the editor can retain the draft', async () => {
    const { room, mx, sendMessage } = setup();
    sendMessage.mockRejectedValue(new Error('Offline'));
    await expect(saveThreadSummary(mx, room, '$root', 'Keep this draft')).rejects.toThrow(
      'Offline'
    );
    expect(getStoredSummary()).toBeUndefined();
  });
});
