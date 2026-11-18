import { describe, expect, it } from 'vitest';
import type { MatrixEvent } from 'matrix-js-sdk';
import {
  planThreadTurnFolds,
  viewThreadTurnFolds,
  type ThreadTurnFold,
  type ThreadTurnRules,
} from './threadTurnFolds';

/**
 * One row of a thread: `p` a person's message, `a` an agent's message, `m` a quiet marker,
 * `n` an agent's notice, `e` an edit (no row of its own). Flags: `s` streaming or waiting on the
 * reader, `h` hidden by another plan.
 */
type Row = string;

const toEvent = (row: Row, index: number): MatrixEvent => {
  const [kind] = row;
  const id = `$${index}${row}`;
  return {
    getId: () => id,
    getType: () => 'm.room.message',
    getStateKey: () => undefined,
    getRelation: () => (kind === 'e' ? { rel_type: 'm.replace', event_id: '$0p' } : null),
    isRedaction: () => false,
    row,
  } as unknown as MatrixEvent;
};

const rowOf = (event: MatrixEvent): Row => (event as unknown as { row: Row }).row;

const plan = (rows: Row[], rules: Partial<ThreadTurnRules> = {}) => {
  const events = rows.map(toEvent);
  const folds = planThreadTurnFolds(events, {
    isPersonMessage: (event) => rowOf(event).startsWith('p'),
    isSkipped: (event) => rowOf(event).includes('h'),
    isAnswer: (event) => rowOf(event).startsWith('a'),
    isQuietMarker: (event) => rowOf(event).startsWith('m'),
    holdsTurn: (event) => rowOf(event).includes('s'),
    pinnedIds: new Set(),
    lastTurnBusy: false,
    ...rules,
  });
  // Each fold as `key: hidden rows -> answer (count)`, rows by their index in `rows`.
  const at = (id: string) => Number(/^\$(\d+)/.exec(id)?.[1]);
  return folds.map(
    (fold) =>
      `${at(fold.key)}: ${fold.hiddenIds.map(at).join(',')} -> ${at(fold.answerId)} (${fold.count})`
  );
};

describe('planThreadTurnFolds', () => {
  it.each<[string, Row[], string[]]>([
    [
      'folds the rows between the question and the last agent message',
      ['p', 'a', 'a', 'a'],
      ['0: 1,2 -> 3 (2)'],
    ],
    ['leaves a turn with one message before its answer', ['p', 'a', 'a'], []],
    ['leaves a turn without an agent message', ['p', 'm', 'm'], []],
    [
      'keeps the markers after the answer in view',
      ['p', 'a', 'a', 'a', 'm', 'm'],
      ['0: 1,2 -> 3 (2)'],
    ],
    [
      'counts messages, not the quiet markers among them',
      ['p', 'a', 'm', 'a', 'a'],
      ['0: 1,2,3 -> 4 (2)'],
    ],
    ['needs two messages, however many markers', ['p', 'a', 'm', 'm', 'a'], []],
    ['answers with a message, not a notice', ['p', 'a', 'a', 'a', 'n'], ['0: 1,2 -> 3 (2)']],
    [
      'folds each turn on its own',
      ['p', 'a', 'a', 'a', 'p', 'a', 'a', 'a', 'a'],
      ['0: 1,2 -> 3 (2)', '4: 5,6,7 -> 8 (3)'],
    ],
    [
      'starts a turn at each of back-to-back messages',
      ['p', 'p', 'a', 'a', 'a'],
      ['1: 2,3 -> 4 (2)'],
    ],
    ['folds nothing before the first person message', ['a', 'a', 'a', 'p', 'a'], []],
    ['skips edits, which have no row', ['p', 'a', 'e', 'a', 'e', 'a', 'e'], ['0: 1,3 -> 5 (2)']],
    ['leaves rows other plans hide out of the count', ['p', 'a', 'ah', 'a'], []],
    [
      'keeps a turn with a streaming reply unfolded',
      ['p', 'a', 'as', 'a', 'p', 'a', 'a', 'a'],
      ['4: 5,6 -> 7 (2)'],
    ],
    ['keeps a turn whose hidden request waits unfolded', ['p', 'a', 'mhs', 'a', 'a'], []],
  ])('%s', (_name, rows, expected) => {
    expect(plan(rows)).toEqual(expected);
  });

  it('folds the newest turn only once the thread stops working on it', () => {
    const rows = ['p', 'a', 'a', 'a', 'p', 'a', 'a', 'a'];
    expect(plan(rows, { lastTurnBusy: true })).toEqual(['0: 1,2 -> 3 (2)']);
    expect(plan(rows)).toEqual(['0: 1,2 -> 3 (2)', '4: 5,6 -> 7 (2)']);
  });

  it('tells the rule whether a row is in the newest turn', () => {
    // A waiting question holds only the newest turn: a later message answered an earlier one.
    const holdsTurn = (event: MatrixEvent, lastTurn: boolean) =>
      lastTurn && rowOf(event).includes('q');
    const rows = ['p', 'aq', 'a', 'a', 'p', 'aq', 'a', 'a'];
    expect(plan(rows, { holdsTurn })).toEqual(['0: 1,2 -> 3 (2)']);
  });

  it('keeps a turn unfolded that would hide a pinned row', () => {
    const rows = ['p', 'a', 'a', 'a', 'p', 'a', 'a', 'a'];
    // The route opened the second turn's first reply; the answer itself may be pinned.
    expect(plan(rows, { pinnedIds: new Set(['$5a', '$3a']) })).toEqual(['0: 1,2 -> 3 (2)']);
  });
});

describe('viewThreadTurnFolds', () => {
  const folds: ThreadTurnFold[] = [
    { key: '$q1', hiddenIds: ['$1', '$2'], count: 2, answerId: '$3' },
    { key: '$q2', hiddenIds: ['$5', '$6', '$7'], count: 3, answerId: '$8' },
  ];

  it('hides the rows of closed turns and puts every break on its first hidden row', () => {
    const view = viewThreadTurnFolds(folds, (fold) => fold.key === '$q2');
    expect([...view.hiddenIds]).toEqual(['$1', '$2']);
    expect([...view.breaks].map(([id, { fold, open }]) => [id, fold.key, open])).toEqual([
      ['$1', '$q1', false],
      ['$5', '$q2', true],
    ]);
  });

  it('shows nothing without folds', () => {
    const view = viewThreadTurnFolds([], () => false);
    expect(view.hiddenIds.size).toBe(0);
    expect(view.breaks.size).toBe(0);
  });
});
