import { createInstance, type TFunction } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '../../locales/en.json';
import type { BackgroundJob } from './backgroundJobsContract';
import { presentBackgroundJobs } from './backgroundJobsPresentation';

let t: TFunction;

beforeAll(async () => {
  const language = createInstance();
  await language.init({ lng: 'en', resources: { en: { translation: en } } });
  t = language.t;
});

const job = (jobId: string, overrides: Partial<BackgroundJob> = {}): BackgroundJob => ({
  jobId,
  agentId: '@mindroom_code:example.org',
  threadId: '$thread',
  kind: 'tool',
  tool: 'run_tests',
  status: 'running',
  requesterId: '@alice:example.org',
  startedAt: `2026-10-11T00:00:0${jobId.slice(-1)}+00:00`,
  ...overrides,
});

describe('presentBackgroundJobs', () => {
  it('returns nothing without jobs', () => {
    expect(presentBackgroundJobs([], t)).toBeNull();
  });

  it('names a single running job', () => {
    expect(presentBackgroundJobs([job('job_1')], t)?.title).toBe('Running: run_tests');
  });

  it('names a single job waiting for approval', () => {
    const presented = presentBackgroundJobs([job('job_1', { status: 'awaiting_approval' })], t);
    expect(presented?.title).toBe('Waiting for approval: run_tests');
    expect(presented?.items[0].waitingForApproval).toBe(true);
  });

  it('counts several jobs and lists them in order', () => {
    const presented = presentBackgroundJobs([job('job_1'), job('job_2', { tool: 'download' })], t);
    expect(presented?.title).toBe('2 background jobs');
    expect(presented?.items.map((item) => item.label)).toEqual(['run_tests', 'download']);
  });

  it('labels a subagent by its tool and an unknown kind by its tool', () => {
    const presented = presentBackgroundJobs(
      [job('job_1', { kind: 'subagent', tool: 'run_subagent' }), job('job_2', { kind: 'new' })],
      t
    );
    expect(presented?.items.map((item) => item.label)).toEqual([
      'Subagent: run_subagent',
      'run_tests',
    ]);
  });
});
