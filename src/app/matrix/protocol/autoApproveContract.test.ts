import { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import { describe, expect, it } from 'vitest';
import {
  MINDROOM_AUTO_APPROVE_EVENT,
  openAutoApproveWindowsInThread,
  parseAutoApproveStateEvent,
  selectAutoApproveWindows,
  type AutoApproveWindow,
} from './autoApproveContract';

const STEWARD_A = '@mindroom_alpha:example.org';
const STEWARD_B = '@mindroom_beta:example.org';
const ALICE = '@alice:example.org';

const window = (overrides: Record<string, unknown> = {}) => ({
  thread_id: '$thread',
  requester_id: ALICE,
  // The backend writes Python's isoformat(), with microseconds.
  expires_at: '2026-10-22T15:30:00.123456+00:00',
  ...overrides,
});

const windowsEvent = (
  windows: unknown,
  { sender = STEWARD_A, ts = 1 }: { sender?: string; ts?: number } = {}
) =>
  new MatrixEvent({
    content: { windows },
    event_id: `$windows-${sender}-${ts}`,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender,
    state_key: sender,
    type: MINDROOM_AUTO_APPROVE_EVENT,
  });

describe('parseAutoApproveStateEvent', () => {
  it('parses each listed window with its end as a timestamp', () => {
    expect(
      parseAutoApproveStateEvent(windowsEvent([window(), window({ thread_id: null })]))
    ).toEqual([
      {
        threadId: '$thread',
        requesterId: ALICE,
        expiresAt: Date.parse('2026-10-22T15:30:00.123Z'),
      },
      { threadId: null, requesterId: ALICE, expiresAt: Date.parse('2026-10-22T15:30:00.123Z') },
    ]);
  });

  it('drops malformed windows and keeps the rest', () => {
    const windows = [
      window(),
      window({ expires_at: 'soon' }),
      window({ requester_id: 7 }),
      window({ thread_id: undefined }),
      'nonsense',
    ];
    expect(parseAutoApproveStateEvent(windowsEvent(windows))).toHaveLength(1);
    expect(parseAutoApproveStateEvent(windowsEvent('nonsense'))).toEqual([]);
  });
});

describe('selectAutoApproveWindows', () => {
  it('returns nothing without any auto-approve state events', () => {
    expect(selectAutoApproveWindows([])).toEqual([]);
  });

  it('shows nothing when an older steward has a window and a newer steward cleared windows', () => {
    const older = windowsEvent([window()], { sender: STEWARD_A, ts: 100 });
    const newer = windowsEvent([], { sender: STEWARD_B, ts: 200 });
    expect(selectAutoApproveWindows([older, newer])).toEqual([]);
    expect(selectAutoApproveWindows([newer, older])).toEqual([]);
  });

  it('shows the newer steward window when an older steward has none', () => {
    const older = windowsEvent([], { sender: STEWARD_A, ts: 100 });
    const newer = windowsEvent([window()], { sender: STEWARD_B, ts: 200 });
    const expected = [
      {
        threadId: '$thread',
        requesterId: ALICE,
        expiresAt: Date.parse('2026-10-22T15:30:00.123Z'),
      },
    ];
    expect(selectAutoApproveWindows([older, newer])).toEqual(expected);
    expect(selectAutoApproveWindows([newer, older])).toEqual(expected);
  });

  it('breaks equal timestamp ties by picking the lowest sender Matrix ID', () => {
    const lower = windowsEvent([window({ requester_id: ALICE })], { sender: STEWARD_A, ts: 100 });
    const higher = windowsEvent([window({ requester_id: '@bob:example.org' })], {
      sender: STEWARD_B,
      ts: 100,
    });
    expect(selectAutoApproveWindows([higher, lower]).map((item) => item.requesterId)).toEqual([
      ALICE,
    ]);
    expect(selectAutoApproveWindows([lower, higher]).map((item) => item.requesterId)).toEqual([
      ALICE,
    ]);
  });

  it('does not duplicate a requester present in both an older and a newer steward event', () => {
    const older = windowsEvent([window({ expires_at: '2026-10-22T15:30:00+00:00' })], {
      sender: STEWARD_A,
      ts: 100,
    });
    const newer = windowsEvent([window({ expires_at: '2026-10-22T16:00:00+00:00' })], {
      sender: STEWARD_B,
      ts: 200,
    });
    expect(selectAutoApproveWindows([older, newer])).toEqual([
      {
        threadId: '$thread',
        requesterId: ALICE,
        expiresAt: Date.parse('2026-10-22T16:00:00Z'),
      },
    ]);
  });
});

describe('openAutoApproveWindowsInThread', () => {
  const at = (iso: string) => Date.parse(iso);
  const windows: AutoApproveWindow[] = [
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
    const open = openAutoApproveWindowsInThread(windows, '$thread', at('2026-10-22T15:00:00Z'));
    expect(open.map((item) => item.requesterId)).toEqual([ALICE, '@bob:example.org']);
  });
});
