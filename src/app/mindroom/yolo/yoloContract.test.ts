import { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import { describe, expect, it } from 'vitest';
import {
  MINDROOM_YOLO_EVENT,
  openYoloWindowsInThread,
  parseYoloStateEvent,
  type YoloWindow,
} from './yoloContract';

const ROUTER = '@mindroom_router:example.org';
const ALICE = '@alice:example.org';

const window = (overrides: Record<string, unknown> = {}) => ({
  thread_id: '$thread',
  requester_id: ALICE,
  expires_at: '2026-10-22T15:30:00+00:00',
  ...overrides,
});

const windowsEvent = (windows: unknown, { sender = ROUTER, stateKey = sender } = {}) =>
  new MatrixEvent({
    content: { windows },
    event_id: `$${stateKey}`,
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender,
    state_key: stateKey,
    type: MINDROOM_YOLO_EVENT,
  });

describe('parseYoloStateEvent', () => {
  it('parses each listed window with its end as a timestamp', () => {
    expect(parseYoloStateEvent(windowsEvent([window(), window({ thread_id: null })]))).toEqual([
      { threadId: '$thread', requesterId: ALICE, expiresAt: Date.parse('2026-10-22T15:30:00Z') },
      { threadId: null, requesterId: ALICE, expiresAt: Date.parse('2026-10-22T15:30:00Z') },
    ]);
  });

  it('ignores state whose state key is not its sender', () => {
    expect(parseYoloStateEvent(windowsEvent([window()], { stateKey: ALICE }))).toEqual([]);
  });

  it('drops malformed windows and keeps the rest', () => {
    const windows = [
      window(),
      window({ expires_at: 'soon' }),
      window({ requester_id: 7 }),
      window({ thread_id: undefined }),
      'nonsense',
    ];
    expect(parseYoloStateEvent(windowsEvent(windows))).toHaveLength(1);
    expect(parseYoloStateEvent(windowsEvent('nonsense'))).toEqual([]);
  });
});

describe('openYoloWindowsInThread', () => {
  const at = (iso: string) => Date.parse(iso);
  const windows: YoloWindow[] = [
    { threadId: '$thread', requesterId: '@bob:example.org', expiresAt: at('2026-10-22T16:00:00Z') },
    { threadId: '$thread', requesterId: ALICE, expiresAt: at('2026-10-22T15:30:00Z') },
    { threadId: '$other', requesterId: ALICE, expiresAt: at('2026-10-22T16:00:00Z') },
    {
      threadId: '$thread',
      requesterId: '@carol:example.org',
      expiresAt: at('2026-10-22T15:00:00Z'),
    },
  ];

  it('keeps the thread’s windows that have not ended, the earliest-ending first', () => {
    const open = openYoloWindowsInThread(windows, '$thread', at('2026-10-22T15:00:00Z'));
    expect(open.map((item) => item.requesterId)).toEqual([ALICE, '@bob:example.org']);
  });
});
