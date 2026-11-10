import { MatrixEvent, RelationType } from 'matrix-js-sdk';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThreadApprovalRecord } from '../matrix/protocol/threadApprovalModel';
import type { ToolApprovalData } from '../matrix/protocol/toolApproval';
import type { ActivityRow } from './activityRows';
import { answerApproval, answerQuestion, markActivityRowsRead } from './activityActions';

const mocks = vi.hoisted(() => ({ markThreadAsRead: vi.fn(async () => undefined) }));
vi.mock('../notifications/readReceipts', () => ({ markThreadAsRead: mocks.markThreadAsRead }));

const ME = '@alice:x';

const client = () =>
  ({
    getUserId: () => ME,
    getSafeUserId: () => ME,
    makeTxnId: () => 'txn1',
    sendEvent: vi.fn(async () => ({ event_id: '$sent' })),
  } as unknown as MatrixClient & { sendEvent: ReturnType<typeof vi.fn> });

const record = (approval: Partial<ToolApprovalData>): ThreadApprovalRecord =>
  ({
    eventId: '$ask',
    sender: '@mindroom_code:x',
    wireStatus: 'pending',
    approval: {
      approverUserId: null,
      approvable: true,
      status: 'pending',
      threadId: '$root',
      expiresAt: '2099-01-01T00:00:00Z',
      ...approval,
    },
  } as ThreadApprovalRecord);

afterEach(() => vi.clearAllMocks());

describe('answerApproval', () => {
  it('sends the response in the approval thread', async () => {
    const mx = client();
    await answerApproval(mx, '!r:x', record({}), 'approved');
    expect(mx.sendEvent).toHaveBeenCalledWith(
      '!r:x',
      'io.mindroom.tool_approval_response',
      expect.objectContaining({
        status: 'approved',
        'm.relates_to': expect.objectContaining({
          rel_type: RelationType.Thread,
          event_id: '$root',
          'm.in_reply_to': { event_id: '$ask' },
        }),
      })
    );
  });

  it('refuses an approval meant for someone else, and approving what cannot be approved', async () => {
    const mx = client();
    await expect(
      answerApproval(mx, '!r:x', record({ approverUserId: '@bob:x' }), 'denied')
    ).rejects.toThrow();
    await expect(
      answerApproval(mx, '!r:x', record({ approvable: false }), 'approved')
    ).rejects.toThrow();
    expect(mx.sendEvent).not.toHaveBeenCalled();
  });
});

describe('answerQuestion', () => {
  const question = { eventId: '$q', senderId: '@mindroom_code:x', text: 'Which?', options: [] };
  const roomWith = (reactions: MatrixEvent[]) =>
    ({
      roomId: '!r:x',
      getEventForTxnId: () => null,
      getUnfilteredTimelineSet: () => ({
        relations: {
          getChildEventsForEvent: () =>
            reactions.length ? { getRelations: () => reactions } : undefined,
        },
      }),
    } as unknown as Room);

  it('answers with the option reaction in the thread', async () => {
    const mx = client();
    await answerQuestion(mx, roomWith([]), '$root', question, '✅');
    expect(mx.sendEvent).toHaveBeenCalledWith(
      '!r:x',
      '$root',
      'm.reaction',
      { 'm.relates_to': { rel_type: RelationType.Annotation, event_id: '$q', key: '✅' } },
      'txn1'
    );
  });

  it('never takes back an answer the user already gave', async () => {
    const mx = client();
    const own = new MatrixEvent({
      event_id: '$mine',
      sender: ME,
      type: 'm.reaction',
      content: { 'm.relates_to': { rel_type: RelationType.Annotation, event_id: '$q', key: '✅' } },
    });
    await answerQuestion(mx, roomWith([own]), '$root', question, '✅');
    expect(mx.sendEvent).not.toHaveBeenCalled();
  });
});

describe('markActivityRowsRead', () => {
  const threadRow = (key: string, kind: ActivityRow['kind'], unread: boolean) =>
    ({
      type: 'thread',
      key,
      kind,
      unread,
      entry: { roomId: `!${key}:x`, threadRootId: `$${key}` },
    } as unknown as ActivityRow);

  it('reads the unread threads and leaves what waits for an answer', async () => {
    const mx = client();
    await markActivityRowsRead(
      mx,
      [
        threadRow('a', 'reply', true),
        threadRow('b', 'reply', false),
        threadRow('c', 'approval', true),
        { type: 'invite', key: 'invite:!i:x', kind: 'invite', roomId: '!i:x', unread: true, ts: 1 },
        threadRow('d', 'mention', true),
      ],
      false
    );
    expect(mocks.markThreadAsRead.mock.calls).toEqual([
      [mx, '!a:x', '$a', false],
      [mx, '!d:x', '$d', false],
    ]);
  });
});
