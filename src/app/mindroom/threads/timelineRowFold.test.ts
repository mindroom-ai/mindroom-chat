import { describe, expect, it } from 'vitest';
import type { MatrixEvent } from 'matrix-js-sdk';
import { foldTimelineRowContexts } from './timelineRowFold';

const MINUTE = 60_000;
const START = Date.UTC(2026, 10, 3, 9, 0);

type Row = { id: string; sender: string; type: string; minute: number; stateKey?: string };

const toEvent = ({ id, sender, type, minute, stateKey }: Row) =>
  ({
    getId: () => id,
    getSender: () => sender,
    getType: () => type,
    getTs: () => START + minute * MINUTE,
    getStateKey: () => stateKey,
    getRelation: () => null,
    isRedaction: () => false,
  } as unknown as MatrixEvent);

const fold = (rows: Row[]) => {
  const events = rows.map(toEvent);
  const contexts = foldTimelineRowContexts({
    indexes: events.map((_, index) => index),
    getEvent: (index) => events[index],
    isSkipped: () => false,
  });
  return rows.map((row, index) => [row.id, contexts.get(index)?.collapse]);
};

describe('foldTimelineRowContexts', () => {
  it('keeps an agent reply, its approval card and its summary notice under one author line', () => {
    expect(
      fold([
        { id: '$ask', sender: '@maya:x', type: 'm.room.message', minute: 0 },
        { id: '$reply', sender: '@code:x', type: 'm.room.message', minute: 1 },
        { id: '$approval', sender: '@code:x', type: 'io.mindroom.tool_approval', minute: 1 },
        { id: '$summary', sender: '@code:x', type: 'm.room.message', minute: 2 },
      ])
    ).toEqual([
      ['$ask', false],
      ['$reply', false],
      ['$approval', true],
      ['$summary', true],
    ]);
  });

  it('starts a new author line for another sender, a long pause, or a state event', () => {
    expect(
      fold([
        { id: '$a', sender: '@code:x', type: 'm.room.message', minute: 0 },
        { id: '$b', sender: '@maya:x', type: 'io.mindroom.tool_approval', minute: 0 },
        { id: '$c', sender: '@maya:x', type: 'm.room.message', minute: 5 },
        { id: '$d', sender: '@maya:x', type: 'm.room.name', minute: 5, stateKey: '' },
        { id: '$e', sender: '@maya:x', type: 'm.room.name', minute: 5, stateKey: '' },
        { id: '$f', sender: '@maya:x', type: 'm.room.message', minute: 5 },
      ])
    ).toEqual([
      ['$a', false],
      ['$b', false],
      ['$c', false],
      ['$d', false],
      ['$e', true],
      ['$f', false],
    ]);
  });
});
