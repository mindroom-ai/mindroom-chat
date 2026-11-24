import { describe, expect, it } from 'vitest';
import {
  classifyThreadWorkflow,
  isQuietThread,
  isWaitingOnYou,
  nextThreadQuietTs,
  QUIET_AFTER_MS,
  threadQuietActivityTs,
  threadReturnTs,
  type ThreadWorkflowStatus,
} from './threadWorkflow';
import sharedCases from './fixtures/thread-workflow-cases.json';

const idle: ThreadWorkflowStatus = { isResolved: false, isStreaming: false, scheduledTaskCount: 0 };
describe('classifyThreadWorkflow', () => {
  it.each([
    [{}, 'needsYou'],
    [
      {
        isResolved: true,
        snoozedUntilTs: 200,
        hasBackgroundApproval: true,
        isStreaming: true,
        scheduledTaskCount: 1,
      },
      'done',
    ],
    [{ snoozedUntilTs: 200, hasBackgroundApproval: true, isStreaming: true }, 'later'],
    [{ snoozedUntilTs: 100 }, 'needsYou'],
    [{ snoozedUntilTs: 99 }, 'needsYou'],
    [{ snoozedUntilTs: Number.NaN }, 'needsYou'],
    [
      {
        hasBackgroundApproval: true,
        isStreaming: true,
        hasBackgroundJob: true,
        scheduledTaskCount: 1,
      },
      'needsYou',
    ],
    [{ isStreaming: true, scheduledTaskCount: 1 }, 'working'],
    [{ hasBackgroundJob: true, scheduledTaskCount: 1 }, 'working'],
    [{ scheduledTaskCount: 1 }, 'later'],
  ] as const)('classifies %j as %s', (status, bucket) => {
    expect(classifyThreadWorkflow({ ...idle, ...status }, 100)).toBe(bucket);
  });
});

describe('threadReturnTs', () => {
  it('is the end of an active snooze, else the next scheduled run, else unknown', () => {
    expect(threadReturnTs({ snoozedUntilTs: 300, nextScheduledTs: 200 }, 100)).toBe(300);
    expect(threadReturnTs({ snoozedUntilTs: 50, nextScheduledTs: 200 }, 100)).toBe(200);
    expect(threadReturnTs({ nextScheduledTs: 200 }, 100)).toBe(200);
    expect(threadReturnTs({}, 100)).toBe(Infinity);
  });
});

/** One case of the file the backend's `matrix_room` threads action runs too (mindroom `tests/fixtures`). */
type SharedCase = {
  name: string;
  now: number;
  status: {
    is_resolved?: boolean;
    snoozed_until_ts?: number;
    is_streaming?: boolean;
    has_background_job?: boolean;
    has_background_approval?: boolean;
    scheduled_task_count?: number;
    next_scheduled_ts?: number;
    pending_approval?: boolean;
    pending_question?: boolean;
  };
  expected: { workflow: string; why?: string; back_at?: number };
};

const cases: SharedCase[] = sharedCases.cases;
const BACKEND_WORKFLOW = {
  needsYou: 'needs_you',
  working: 'working',
  later: 'later',
  done: 'done',
} as const;

/** Why a needs-you thread waits, as the backend names it. */
const whyOf = (status: SharedCase['status'], waits: boolean): string => {
  if (!waits) return 'your_turn';
  if (status.pending_approval || (status.has_background_approval && !status.is_resolved)) {
    return 'approval';
  }
  return 'question';
};

describe('the workflow cases shared with the backend', () => {
  it('reads every case of the file', () => {
    expect(cases.length).toBe(22);
  });

  it.each(cases)('$name', ({ now, status, expected }) => {
    const clientStatus: ThreadWorkflowStatus = {
      isResolved: status.is_resolved ?? false,
      isStreaming: status.is_streaming ?? false,
      scheduledTaskCount: status.scheduled_task_count ?? 0,
      hasBackgroundJob: status.has_background_job ?? false,
      hasBackgroundApproval: status.has_background_approval ?? false,
      ...(status.snoozed_until_ts !== undefined ? { snoozedUntilTs: status.snoozed_until_ts } : {}),
    };
    // The Threads page's combination (threadGroups.ts): waiting on you first, then the workflow bucket.
    const waits = isWaitingOnYou(
      { pendingApproval: status.pending_approval, pendingQuestion: status.pending_question },
      { isResolved: clientStatus.isResolved, threadRecord: { status: clientStatus } }
    );
    const workflow = waits
      ? 'needs_you'
      : BACKEND_WORKFLOW[classifyThreadWorkflow(clientStatus, now)];

    expect(workflow).toBe(expected.workflow);
    expect(workflow === 'needs_you' ? whyOf(status, waits) : undefined).toBe(expected.why);
    if (workflow === 'later') {
      const returnStatus = {
        ...(clientStatus.snoozedUntilTs !== undefined
          ? { snoozedUntilTs: clientStatus.snoozedUntilTs }
          : {}),
        ...(status.next_scheduled_ts !== undefined
          ? { nextScheduledTs: status.next_scheduled_ts }
          : {}),
      };
      expect(threadReturnTs(returnStatus, now)).toBe(expected.back_at ?? Infinity);
    } else {
      expect(expected.back_at).toBeUndefined();
    }
  });
});

describe('quiet thread rules', () => {
  const NOW = 10 * QUIET_AFTER_MS;
  const oldTs = NOW - QUIET_AFTER_MS;

  it('computes quiet activity time from outcome, non-streaming news, activity and expired snooze', () => {
    expect(
      threadQuietActivityTs({ lastActivityTs: 100, newsTs: 300, isStreaming: true, now: 500 })
    ).toBe(100);
    expect(
      threadQuietActivityTs({ lastActivityTs: 100, newsTs: 300, outcomeTs: 400, now: 500 })
    ).toBe(400);
    expect(threadQuietActivityTs({ lastActivityTs: 100, snoozedUntilTs: 450, now: 500 })).toBe(450);
    expect(threadQuietActivityTs({ lastActivityTs: 100, snoozedUntilTs: 600, now: 500 })).toBe(100);
  });

  it('folds read inactive threads at the 5-day boundary, respects disqualifiers, missing signals and expired snoozes', () => {
    expect(isQuietThread({ lastActivityTs: oldTs + 1 }, NOW)).toBe(false);
    expect(isQuietThread({ lastActivityTs: oldTs }, NOW)).toBe(true);
    expect(isQuietThread({ lastActivityTs: 0 }, NOW)).toBe(false);
    expect(isQuietThread({ lastActivityTs: oldTs, replyCount: 0 }, NOW)).toBe(true);
    expect(isQuietThread({ lastActivityTs: oldTs, replyCount: 2 }, NOW)).toBe(false);
    expect(
      isQuietThread({ lastActivityTs: oldTs, replyCount: 2, signals: { newCount: 0 } }, NOW)
    ).toBe(true);
    expect(isQuietThread({ lastActivityTs: 1, snoozedUntilTs: oldTs + 1 }, NOW)).toBe(false);
    expect(isQuietThread({ lastActivityTs: 1, snoozedUntilTs: oldTs + 1 }, NOW + 1)).toBe(true);

    const disqualifiers = [
      { isPinned: true },
      { isUnread: true },
      { hasPendingSend: true },
      { hasFailedSend: true },
      { hasBackgroundApproval: true },
      { signals: { pendingApproval: {} } },
      { signals: { pendingQuestion: {} } },
      { signals: { newCount: 1 } },
      { signals: { mentionedMe: true } },
    ];
    for (const extra of disqualifiers) {
      expect(isQuietThread({ lastActivityTs: oldTs, ...extra }, NOW)).toBe(false);
    }
  });

  it('computes nextThreadQuietTs for countdowns and waiting threads', () => {
    expect(nextThreadQuietTs({ lastActivityTs: oldTs + 10 }, NOW)).toBe(NOW + 10);
    expect(nextThreadQuietTs({ lastActivityTs: oldTs }, NOW)).toBeUndefined();
    expect(nextThreadQuietTs({ lastActivityTs: oldTs + 10, isPinned: true }, NOW)).toBeUndefined();
    expect(nextThreadQuietTs({ lastActivityTs: oldTs + 10, isUnread: true }, NOW)).toBeUndefined();
    expect(
      nextThreadQuietTs({ lastActivityTs: oldTs + 10, signals: { newCount: 1 } }, NOW)
    ).toBeUndefined();
    expect(
      nextThreadQuietTs({ lastActivityTs: oldTs + 10, signals: { mentionedMe: true } }, NOW)
    ).toBeUndefined();
    expect(
      nextThreadQuietTs({ lastActivityTs: oldTs + 10, signals: { pendingApproval: {} } }, NOW)
    ).toBeUndefined();
    expect(
      nextThreadQuietTs(
        { lastActivityTs: oldTs, signals: { pendingQuestion: {}, waitsUntil: NOW + 50 } },
        NOW
      )
    ).toBe(NOW + 50);
    expect(
      nextThreadQuietTs(
        { lastActivityTs: oldTs + 100, signals: { pendingApproval: {}, waitsUntil: NOW + 50 } },
        NOW
      )
    ).toBe(NOW + 100);
  });
});
