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
  const question = {
    eventId: '$q',
    text: 'Ship it?',
    options: [
      { key: '✅', label: 'Yes' },
      { key: '❌', label: 'No' },
    ],
  };
  const reaction = (sender: string, key: string) =>
    new MatrixEvent({
      event_id: `$${sender}${key}`,
      sender,
      type: 'm.reaction',
      content: { 'm.relates_to': { rel_type: RelationType.Annotation, event_id: '$q', key } },
    });
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

  it("answers past the agent's own option reactions", async () => {
    const mx = client();
    await answerQuestion(
      mx,
      roomWith([reaction('@mindroom_code:x', '✅')]),
      '$root',
      question,
      '✅'
    );
    expect(mx.sendEvent).toHaveBeenCalledTimes(1);
  });

  it('sends nothing once the question has an answer, by the user or by anyone else', async () => {
    const mx = client();
    await answerQuestion(mx, roomWith([reaction(ME, '✅')]), '$root', question, '✅');
    await answerQuestion(mx, roomWith([reaction(ME, '❌')]), '$root', question, '✅');
    await answerQuestion(mx, roomWith([reaction('@bob:x', '❌')]), '$root', question, '✅');
    expect(mx.sendEvent).not.toHaveBeenCalled();
  });
});
