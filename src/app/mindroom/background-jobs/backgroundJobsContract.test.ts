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

const jobsEvent = (jobs: unknown, { sender = AGENT, stateKey = sender } = {}) =>
  new MatrixEvent({
    content: { jobs },
    event_id: `$${stateKey}`,
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender,
    state_key: stateKey,
    type: MINDROOM_BACKGROUND_JOBS_EVENT,
  });

const viewer = '@alice:example.org';
const joined = () => true;

describe('parseBackgroundJobsStateEvent', () => {
  it('parses each listed job', () => {
    expect(parseBackgroundJobsStateEvent(jobsEvent([job('job_1')]))).toEqual([
      {
        jobId: 'job_1',
        threadId: '$thread',
        kind: 'tool',
        tool: 'run_tests',
        status: 'running',
        startedAt: '2026-10-11T00:00:01+00:00',
      },
    ]);
  });

  it('ignores state whose state key is not its sender', () => {
    const event = jobsEvent([job('job_1')], { stateKey: '@mindroom_other:example.org' });
    expect(parseBackgroundJobsStateEvent(event)).toEqual([]);
  });

  it('drops malformed items and keeps the rest', () => {
    const jobs = [job('job_1'), { job_id: 7 }, 'nonsense', job('job_2', { tool: null })];
    expect(parseBackgroundJobsStateEvent(jobsEvent(jobs)).map((item) => item.jobId)).toEqual([
      'job_1',
    ]);
  });

  it('maps a missing thread to the main timeline', () => {
    const [parsed] = parseBackgroundJobsStateEvent(jobsEvent([job('job_1', { thread_id: null })]));
    expect(parsed.threadId).toBeNull();
  });
});

describe('selectBackgroundJobs', () => {
  it('ignores state from a non-agent sender', () => {
    const event = jobsEvent([job('job_1')], { sender: '@mallory:example.org' });
    expect(selectBackgroundJobs([event], viewer, joined)).toEqual([]);
  });

  it('ignores state from an agent that left the room', () => {
    expect(selectBackgroundJobs([jobsEvent([job('job_1')])], viewer, () => false)).toEqual([]);
  });

  it('shows a thread only its own jobs, and the main timeline every job of the room', () => {
    const events = [
      jobsEvent([job('job_1'), job('job_2', { thread_id: '$other' })]),
      jobsEvent([job('job_3', { thread_id: null })], { sender: '@mindroom_research:example.org' }),
    ];
    const jobs = selectBackgroundJobs(events, viewer, joined);
    const ids = (threadId: string | null) => jobsInView(jobs, threadId).map((item) => item.jobId);
    expect(ids('$thread')).toEqual(['job_1']);
    expect(ids(null)).toEqual(['job_1', 'job_2', 'job_3']);
  });
});
