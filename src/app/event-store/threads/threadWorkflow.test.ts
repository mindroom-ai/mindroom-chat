import { describe, expect, it } from 'vitest';
import {
  classifyThreadWorkflow,
  isWaitingOnYou,
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
