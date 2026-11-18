import { describe, expect, it } from 'vitest';
import type { MatrixEvent } from 'matrix-js-sdk';
import {
  planThreadTurnFolds,
  threadRowAuthor,
  viewThreadTurnFolds,
  type ThreadTurnFold,
  type ThreadTurnRules,
} from './threadTurnFolds';

/**
 * One row of a thread: `p` a person's message, `a` an agent's message, `m` a quiet marker,
 * `n` an agent's notice, `e` an edit (no row of its own). Flags: `s` streaming or waiting on the
 * reader, `h` hidden by another plan, `r` a run's reply, `i` an attachment.
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
    answerRank: (event) => (rowOf(event).includes('r') ? 0 : rowOf(event).includes('i') ? 2 : 1),
    isQuietMarker: (event) => rowOf(event).startsWith('m'),
    holdsTurn: (event) => rowOf(event).includes('s'),
    pinnedIds: new Set(),
    lastTurnBusy: false,
    ...rules,
  });
  // Each fold as `key: hidden rows (count)`, rows by their index in `rows`.
  const at = (id: string) => Number(/^\$(\d+)/.exec(id)?.[1]);
  return folds.map(
    (fold) => `${at(fold.key)}: ${fold.hiddenIds.map(at).join(',')} (${fold.count})`
  );
};

describe('planThreadTurnFolds', () => {
  it.each<[string, Row[], string[]]>([
    [
      'folds the rows between the question and the last agent message',
      ['p', 'a', 'a', 'a'],
      ['0: 1,2 (2)'],
    ],
    ['leaves a turn with one message before its answer', ['p', 'a', 'a'], []],
    ['leaves a turn without an agent message', ['p', 'm', 'm'], []],
    ['leaves a turn whose agent sent only notices', ['p', 'n', 'n', 'n'], []],
    ['keeps the markers after the answer in view', ['p', 'a', 'a', 'a', 'm', 'm'], ['0: 1,2 (2)']],
    [
      'counts messages, not the quiet markers among them',
      ['p', 'a', 'm', 'a', 'a'],
      ['0: 1,2,3 (2)'],
    ],
    ['needs two messages, however many markers', ['p', 'a', 'm', 'm', 'a'], []],
    ['answers with a message, not a notice', ['p', 'a', 'a', 'a', 'n'], ['0: 1,2 (2)']],
    [
      'folds each turn on its own',
      ['p', 'a', 'a', 'a', 'p', 'a', 'a', 'a', 'a'],
      ['0: 1,2 (2)', '4: 5,6,7 (3)'],
    ],
    ['starts a turn at each of back-to-back messages', ['p', 'p', 'a', 'a', 'a'], ['1: 2,3 (2)']],
    ['folds nothing before the first person message', ['a', 'a', 'a', 'p', 'a'], []],
    ['skips edits, which have no row', ['p', 'a', 'e', 'a', 'e', 'a', 'e'], ['0: 1,3 (2)']],
    ['leaves rows other plans hide out of the count', ['p', 'a', 'ah', 'a'], []],
    [
      'keeps a turn with a streaming reply unfolded',
      ['p', 'a', 'as', 'a', 'p', 'a', 'a', 'a'],
      ['4: 5,6 (2)'],
    ],
    ['keeps a turn whose hidden request waits unfolded', ['p', 'a', 'mhs', 'a', 'a'], []],
    [
      "answers with the last run's reply, what the run posted after it in view",
      ['p', 'ar', 'a', 'ar', 'a', 'ai', 'ai'],
      ['0: 1,2 (2)'],
    ],
    ["leaves a turn whose run's reply comes first", ['p', 'ar', 'a', 'ai', 'ai'], []],
    [
      'answers without a run with the last message that is not an attachment',
      ['p', 'a', 'a', 'a', 'ai', 'ai'],
      ['0: 1,2 (2)'],
    ],
    ['answers with the last attachment when all are', ['p', 'ai', 'ai', 'ai'], ['0: 1,2 (2)']],
  ])('%s', (_name, rows, expected) => {
    expect(plan(rows)).toEqual(expected);
  });

  it('folds the newest turn only once the thread stops working on it', () => {
    const rows = ['p', 'a', 'a', 'a', 'p', 'a', 'a', 'a'];
    expect(plan(rows, { lastTurnBusy: true })).toEqual(['0: 1,2 (2)']);
    expect(plan(rows)).toEqual(['0: 1,2 (2)', '4: 5,6 (2)']);
  });

  it('keeps an earlier turn unfolded while its row waits, whatever came after it', () => {
    // An unanswered question in the first turn holds it, though the person wrote since.
    const rows = ['p', 'as', 'a', 'a', 'p', 'a', 'a', 'a'];
    expect(plan(rows)).toEqual(['4: 5,6 (2)']);
  });

  it('keeps a turn unfolded that would hide a pinned row', () => {
    const rows = ['p', 'a', 'a', 'a', 'p', 'a', 'a', 'a'];
    // The route opened the second turn's first reply; the answer itself may be pinned.
    expect(plan(rows, { pinnedIds: new Set(['$5a', '$3a']) })).toEqual(['0: 1,2 (2)']);
  });
});

describe('viewThreadTurnFolds', () => {
  const folds: ThreadTurnFold[] = [
    { key: '$q1', hiddenIds: ['$1', '$2'], count: 2 },
    { key: '$q2', hiddenIds: ['$5', '$6', '$7'], count: 3 },
  ];

  it('hides the rows of closed turns and puts every break on its first hidden row', () => {
    const view = viewThreadTurnFolds(folds, (fold) => fold.key === '$q2');
    expect([...view.hiddenIds]).toEqual(['$2']);
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

describe('threadRowAuthor', () => {
  const event = ({
    type = 'm.room.message',
    sender = '@sam:example.org',
    content = { msgtype: 'm.text', body: 'Hello' },
    stateKey,
    redacted = false,
    failed = false,
  }: {
    type?: string;
    sender?: string;
    content?: Record<string, unknown>;
    stateKey?: string;
    redacted?: boolean;
    failed?: boolean;
  }) =>
    ({
      getType: () => type,
      getSender: () => sender,
      getContent: () => content,
      getStateKey: () => stateKey,
      isRedacted: () => redacted,
      isDecryptionFailure: () => failed,
    } as unknown as MatrixEvent);
  const AGENT = '@mindroom_helper:example.org';

  it.each<[string, MatrixEvent, string]>([
    ["a person's message", event({}), 'person'],
    ["a person's sticker", event({ type: 'm.sticker', content: { body: 'sticker' } }), 'person'],
    ["an agent's message", event({ sender: AGENT }), 'agent'],
    [
      'a message with agent run metadata from another name',
      event({ content: { body: 'Done', 'io.mindroom.ai_run': { status: 'completed' } } }),
      'agent',
    ],
    ["a person's redacted message", event({ redacted: true, content: {} }), 'person'],
    ["an agent's redacted message", event({ sender: AGENT, redacted: true, content: {} }), 'agent'],
    ['a message not decrypted', event({ type: 'm.room.encrypted', content: {} }), 'unknown'],
    ['a message that failed to decrypt', event({ failed: true }), 'unknown'],
    [
      "an agent's message not decrypted",
      event({ sender: AGENT, type: 'm.room.encrypted' }),
      'unknown',
    ],
    ['a membership notice', event({ type: 'm.room.member', stateKey: '@sam:example.org' }), 'none'],
    ['a tool approval card', event({ type: 'io.mindroom.tool_approval', sender: AGENT }), 'none'],
  ])('reads %s', (_name, row, author) => {
    expect(threadRowAuthor(row)).toBe(author);
  });
});
