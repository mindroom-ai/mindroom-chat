import { expect, it } from 'vitest';
import { indexThreadBackgroundJobs } from './threadBackgroundJobs';
import type { BackgroundJob } from './backgroundJobsContract';

const job = (threadId: string | null, status: string): BackgroundJob => ({
  jobId: status,
  threadId,
  status,
  agentId: '@mindroom_agent:example.org',
  kind: 'tool',
  tool: 'shell',
  startedAt: '2026-11-15T00:00:00Z',
});
it('joins by root only, ignores room-wide jobs, and retains approval alongside work', () => {
  expect(
    indexThreadBackgroundJobs([
      job(null, 'running'),
      job('$active', 'running'),
      job('$active', 'awaiting_approval'),
      job('$queued', 'queued'),
    ])
  ).toEqual(
    new Map([
      ['$active', { hasBackgroundJob: true, hasBackgroundApproval: true }],
      ['$queued', { hasBackgroundJob: true, hasBackgroundApproval: false }],
    ])
  );
});

it('reuses the room join until trusted state or agent membership changes', async () => {
  const { MatrixEvent } = await import('matrix-js-sdk');
  const { roomThreadBackgroundJobs } = await import('./threadBackgroundJobs');
  const agent = '@mindroom_agent:example.org';
  let membership = 'join';
  const event = (status: string, sender = agent) =>
    new MatrixEvent({
      type: 'io.mindroom.background_jobs',
      state_key: agent,
      sender,
      content: {
        jobs: [
          {
            job_id: 'job',
            thread_id: '$root',
            status,
            kind: 'tool',
            tool: 'shell',
            started_at: '2026-11-15T00:00:00Z',
          },
        ],
      },
    });
  let events = [event('running')];
  const room = {
    myUserId: '@reader:example.org',
    currentState: { getStateEvents: () => events },
    getMember: () => ({ membership }),
  } as unknown as import('matrix-js-sdk').Room;
  const first = roomThreadBackgroundJobs(room);
  expect(first.get('$root')?.hasBackgroundJob).toBe(true);
  expect(roomThreadBackgroundJobs(room)).toBe(first);
  events = [event('awaiting_approval')];
  expect(roomThreadBackgroundJobs(room).get('$root')).toEqual({
    hasBackgroundApproval: true,
    hasBackgroundJob: false,
  });
  events = [
    new MatrixEvent({
      type: 'io.mindroom.background_jobs',
      state_key: agent,
      sender: agent,
      content: { jobs: [] },
    }),
  ];
  expect(roomThreadBackgroundJobs(room).size).toBe(0);
  events = [event('running')];
  membership = 'leave';
  expect(roomThreadBackgroundJobs(room).size).toBe(0);
  membership = 'join';
  events = [event('running', '@impostor:example.org')];
  expect(roomThreadBackgroundJobs(room).size).toBe(0);
});
