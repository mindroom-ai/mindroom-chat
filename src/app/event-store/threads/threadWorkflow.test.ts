import { describe, expect, it } from 'vitest';
import {
  classifyThreadWorkflow,
  threadReturnTs,
  type ThreadWorkflowStatus,
} from './threadWorkflow';

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
