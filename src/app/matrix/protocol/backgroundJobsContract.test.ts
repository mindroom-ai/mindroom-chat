import { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import { describe, expect, it } from 'vitest';
import {
  MINDROOM_BACKGROUND_JOBS_EVENT,
  parseBackgroundJobsStateEvent,
  jobsInView,
  selectBackgroundJobs,
} from './backgroundJobsContract';

const AGENT = '@mindroom_code:example.org';

const job = (jobId: string, overrides: Record<string, unknown> = {}) => ({
  job_id: jobId,
  thread_id: '$thread',
  kind: 'tool',
  tool: 'run_tests',
  status: 'running',
  requester_id: '@alice:example.org',
  started_at: `2026-10-11T00:00:0${jobId.slice(-1)}+00:00`,
  ...overrides,
});

const jobsEvent = (
  jobs: unknown,
  {
    sender = AGENT,
    stateKey = sender,
    total,
  }: { sender?: string; stateKey?: string; total?: unknown } = {}
) =>
  new MatrixEvent({
    content: total === undefined ? { jobs } : { jobs, total },
    event_id: `$${stateKey}`,
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender,
    state_key: stateKey,
    type: MINDROOM_BACKGROUND_JOBS_EVENT,
  });

describe('parseBackgroundJobsStateEvent', () => {
  it('parses each listed job', () => {
    expect(parseBackgroundJobsStateEvent(jobsEvent([job('job_1')]))).toEqual([
      {
        jobId: 'job_1',
        agentId: AGENT,
        threadId: '$thread',
        kind: 'tool',
        tool: 'run_tests',
        status: 'running',
        startedAt: '2026-10-11T00:00:01+00:00',
      },
    ]);
  });

  it('drops malformed items and keeps the rest', () => {
    const jobs = [job('job_1'), { job_id: 7 }, 'nonsense', job('job_2', { tool: null })];
    expect(parseBackgroundJobsStateEvent(jobsEvent(jobs)).map((item) => item.jobId)).toEqual([
      'job_1',
    ]);
  });

  it('maps a missing thread to the main timeline', () => {
    const [parsed] = parseBackgroundJobsStateEvent(jobsEvent([job('job_1', { thread_id: null })]));
    expect(parsed!.threadId).toBeNull();
  });
});

describe('selectBackgroundJobs', () => {
  it('orders jobs by start time as written, also a time without a fraction', () => {
    const events = [
      jobsEvent([
        job('job_2', { started_at: '2026-10-11T00:00:00.123456+00:00' }),
        job('job_1', { started_at: '2026-10-11T00:00:00+00:00' }),
      ]),
    ];
    expect(selectBackgroundJobs(events).jobs.map((item) => item.jobId)).toEqual(['job_1', 'job_2']);
  });

  it('shows a thread only its own jobs, and the main timeline every job of the room', () => {
    const events = [
      jobsEvent([job('job_1'), job('job_2', { thread_id: '$other' })]),
      jobsEvent([job('job_3', { thread_id: null })], { sender: '@mindroom_research:example.org' }),
    ];
    const { jobs } = selectBackgroundJobs(events);
    const ids = (threadId: string | null) => jobsInView(jobs, threadId).map((item) => item.jobId);
    expect(ids('$thread')).toEqual(['job_1']);
    expect(ids(null)).toEqual(['job_1', 'job_2', 'job_3']);
  });

  it('counts each agent by its stated total, or its listed jobs when it states none', () => {
    const events = [
      jobsEvent([job('job_1'), job('job_2')], { total: 90 }),
      jobsEvent([job('job_3')], { sender: '@mindroom_research:example.org' }),
    ];
    expect(selectBackgroundJobs(events)).toMatchObject({ total: 91 });
    expect(selectBackgroundJobs(events).jobs).toHaveLength(3);
  });

  it('ignores a total that is no whole number or below the listed jobs', () => {
    [-1, 1, 2.5, '90', null, Number.MAX_VALUE].forEach((total) => {
      const events = [jobsEvent([job('job_1'), job('job_2')], { total })];
      expect(selectBackgroundJobs(events).total, String(total)).toBe(2);
    });
    const exact = [jobsEvent([job('job_1'), job('job_2')], { total: 2 })];
    expect(selectBackgroundJobs(exact).total).toBe(2);
  });
});
