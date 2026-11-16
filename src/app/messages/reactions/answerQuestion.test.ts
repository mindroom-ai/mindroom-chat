import { MatrixEvent, RelationType } from 'matrix-js-sdk';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { answerQuestion } from './answerQuestion';

const ME = '@alice:x';

const client = () =>
  ({
    getUserId: () => ME,
    makeTxnId: () => 'txn1',
    sendEvent: vi.fn(async () => ({ event_id: '$sent' })),
  } as unknown as MatrixClient & { sendEvent: ReturnType<typeof vi.fn> });

describe('answerQuestion', () => {
  const question = { eventId: '$q' };
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
