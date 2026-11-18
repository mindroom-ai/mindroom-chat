import { createInstance, type TFunction } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '../i18n/englishResources';
import type { BackgroundJob } from '../matrix/protocol/backgroundJobsContract';
import type { ToolTraceEvent } from '../matrix/protocol/toolTrace';
import type { SubagentRun } from '../messages/live/subagentRunStore';
import { presentBackgroundJobs } from './backgroundJobsPresentation';

let t: TFunction;
const none = () => false;

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
  startedAt: `2026-10-11T00:00:0${jobId.slice(-1)}+00:00`,
  ...overrides,
});

describe('presentBackgroundJobs', () => {
  it('returns nothing without jobs', () => {
    expect(presentBackgroundJobs([], none, t)).toBeNull();
  });

  it('names a single running job', () => {
    expect(presentBackgroundJobs([job('job_1')], none, t)?.title).toBe('Running: run_tests');
  });

  it('names a single job waiting for approval', () => {
    const presented = presentBackgroundJobs(
      [job('job_1', { status: 'awaiting_approval' })],
      none,
      t
    );
    expect(presented?.title).toBe('Waiting for approval: run_tests');
    expect(presented?.items[0]).toMatchObject({ name: 'run_tests', waiting: false });
  });

  it('marks a job whose cancel was already requested as stopping', () => {
    const presented = presentBackgroundJobs(
      [job('job_1', { status: 'cancel_requested' }), job('job_2')],
      none,
      t
    );
    expect(presented?.items.map((item) => item.stopping)).toEqual([true, false]);
  });

  it('names a single job that is stopping, whether its cancel was sent here or elsewhere', () => {
    const elsewhere = presentBackgroundJobs(
      [job('job_1', { status: 'cancel_requested' })],
      none,
      t
    );
    expect(elsewhere?.title).toBe('Stopping: run_tests');
    const here = presentBackgroundJobs([job('job_1')], (jobId) => jobId === 'job_1', t);
    expect(here?.title).toBe('Stopping: run_tests');
    expect(here?.items[0]!.stopping).toBe(true);
  });

  it('names finished jobs as finished, with nothing left to stop', () => {
    const finished = { status: 'finished' };
    const one = presentBackgroundJobs([job('job_1', finished)], (jobId) => jobId === 'job_1', t);
    expect(one?.title).toBe('Finished: run_tests');
    expect(one?.items[0]).toMatchObject({ finished: true, stopping: false, waiting: false });
    const several = presentBackgroundJobs(
      [job('job_1', finished), job('job_2', finished)],
      none,
      t,
      90
    );
    expect(several?.title).toBe('2 background jobs finished');
    expect(several?.items.map((item) => item.finished)).toEqual([true, true]);
    expect(presentBackgroundJobs([job('job_1')], none, t)?.items[0]!.finished).toBe(false);
  });

  it('counts several jobs and lists them in order', () => {
    const presented = presentBackgroundJobs(
      [job('job_1'), job('job_2', { tool: 'download' })],
      none,
      t
    );
    expect(presented?.title).toBe('2 background jobs');
    expect(presented?.items.map((item) => item.name)).toEqual(['run_tests', 'download']);
  });

  it('counts the live jobs the agents did not list, and how many it shows', () => {
    const jobs = [job('job_1'), job('job_2')];
    expect(presentBackgroundJobs(jobs, none, t, 90)?.title).toBe('90 background jobs (showing 2)');
    expect(presentBackgroundJobs(jobs, none, t, 90)?.items).toHaveLength(2);
    expect(presentBackgroundJobs(jobs, none, t, 2)?.title).toBe('2 background jobs');
  });

  it('marks a job waiting for approval among several', () => {
    const presented = presentBackgroundJobs(
      [job('job_1'), job('job_2', { tool: 'shell', status: 'awaiting_approval' })],
      none,
      t
    );
    expect(presented?.items.map((item) => item.waiting)).toEqual([false, true]);
    expect(presented?.items.map((item) => item.name)).toEqual(['run_tests', 'shell']);
  });

  it('shows a job with an unknown status as running and stoppable', () => {
    const presented = presentBackgroundJobs([job('job_1', { status: 'paused' })], none, t);
    expect(presented?.title).toBe('Running: run_tests');
    expect(presented?.items[0]).toMatchObject({ name: 'run_tests', stopping: false });
  });

  it('labels a subagent by its tool and an unknown kind by its tool', () => {
    const presented = presentBackgroundJobs(
      [job('job_1', { kind: 'subagent', tool: 'run_subagent' }), job('job_2', { kind: 'new' })],
      none,
      t
    );
    expect(presented?.items.map((item) => item.name)).toEqual([
      'run_subagent (subagent)',
      'run_tests',
    ]);
    // A sub-agent's row opens the Sub-agents panel.
    expect(presented?.items.map((item) => item.subagent)).toEqual([true, false]);
  });
});

const subagentJob = (jobId: string, subagent?: string, run = subagent && `run-${subagent}`) =>
  job(jobId, {
    kind: 'subagent',
    tool: 'mindroom_dev',
    ...(subagent ? { subagent } : {}),
    ...(run ? { run } : {}),
  });

const subagentRun = (
  subagent: string,
  {
    parent = null,
    tools = [],
    run = `run-${subagent}`,
    startedAt = 1,
    status = 'running',
  }: {
    parent?: string | null;
    tools?: ToolTraceEvent[];
    run?: string;
    startedAt?: number;
    status?: SubagentRun['meta']['status'];
  } = {}
): SubagentRun => ({
  roomId: '!room:example.org',
  run,
  sender: '@mindroom_lead:example.org',
  sid: 'sid',
  seq: 0,
  lastFrameAt: 0,
  stale: false,
  docs: { md: '', reasoning: '', tools, status: 'streaming', activity: '', segments: [] },
  meta: {
    agent: 'mindroom_dev',
    subagent,
    caller: 'mindroom_lead',
    root: 'mindroom_lead',
    parent,
    threadId: '$thread',
    source: 'delegate',
    status,
    startedAt,
    endedAt: null,
  },
});

const lookups = (
  runs: SubagentRun[],
  calls: Record<string, { tool: string; preview?: string }> = {}
) => ({
  runs,
  toolCallFor: (jobId: string) => calls[jobId],
});

const present = (jobs: BackgroundJob[], found: ReturnType<typeof lookups>) =>
  presentBackgroundJobs(jobs, none, t, jobs.length, found);

describe('presentBackgroundJobs, rich rows', () => {
  it('joins a sub-agent job to its run by its sub-agent only', () => {
    const runs = [subagentRun('s1')];
    const [joined, unjoined] = present(
      [subagentJob('job_1', 's1'), subagentJob('job_2')],
      lookups(runs)
    )!.items;
    expect(joined).toMatchObject({
      run: runs[0],
      startedAt: Date.parse('2026-10-11T00:00:01+00:00'),
    });
    // An older backend names no sub-agent: no join by agent name or thread.
    expect(unjoined).not.toHaveProperty('run');
    expect(presentBackgroundJobs([subagentJob('job_1')], none, t)?.items[0]).not.toHaveProperty(
      'run'
    );
  });

  it("shows a follow-up turn's job nothing of the turn before it until its own run's frame", () => {
    // Job_1 runs turn B of sub-agent s1; only its ended turn A has sent frames.
    const turnA = subagentRun('s1', { run: 'run-a', status: 'completed' });
    const turnB = subagentRun('s1', { run: 'run-b', startedAt: 1791676801 });
    const followUp = subagentJob('job_1', 's1', 'run-b');
    expect(present([followUp], lookups([turnA]))!.items[0]).not.toHaveProperty('run');
    expect(present([followUp], lookups([turnA, turnB]))!.items[0]!.run).toBe(turnB);
  });

  it('joins a job that names no run to a turn of its sub-agent that started with it or later', () => {
    // MindRoom before `run`: the job started at 2026-10-11T00:00:01Z, Unix 1791676801.
    const legacy = job('job_1', { kind: 'subagent', tool: 'mindroom_dev', subagent: 's1' });
    const before = subagentRun('s1', { run: 'run-a', startedAt: 1791676800 });
    const after = subagentRun('s1', { run: 'run-b', startedAt: 1791676801 });
    expect(present([legacy], lookups([before]))!.items[0]).not.toHaveProperty('run');
    expect(present([legacy], lookups([before, after]))!.items[0]!.run).toBe(after);
  });

  it('keeps a job whose run has no frame yet, without a run', () => {
    const [item] = present([subagentJob('job_1', 's1')], lookups([]))!.items;
    expect(item).toMatchObject({ name: 'mindroom_dev (subagent)', depth: 0 });
    expect(item).not.toHaveProperty('run');
    expect(item).not.toHaveProperty('activity');
  });

  it("takes a sub-agent's activity from its run's newest tool, with its preview when sent", () => {
    const tools = [
      { type: 'tool_call_completed', tool_name: 'read_file', args_preview: 'a.ts' },
      { type: 'tool_call_started', tool_name: 'run_shell_command', args_preview: 'just test' },
    ];
    const withPreview = present(
      [subagentJob('job_1', 's1')],
      lookups([subagentRun('s1', { tools })])
    );
    expect(withPreview?.items[0]!.activity).toEqual({
      tool: 'run_shell_command',
      preview: 'just test',
    });
    // With `show_tool_calls` off the frame carries no previews.
    const bare = [{ type: 'tool_call_started', tool_name: 'run_shell_command' }];
    const withoutPreview = present(
      [subagentJob('job_1', 's1')],
      lookups([subagentRun('s1', { tools: bare })])
    );
    expect(withoutPreview?.items[0]!.activity).toEqual({ tool: 'run_shell_command' });
    const none = present([subagentJob('job_1', 's1')], lookups([subagentRun('s1')]));
    expect(none?.items[0]).not.toHaveProperty('activity');
  });

  it("takes a tool job's activity from its reply's call, and none without the call's ID", () => {
    const calls = { job_1: { tool: 'run_shell_command', preview: 'pytest -x' } };
    const presented = present(
      [job('job_1', { toolCallId: 'call_1' }), job('job_2')],
      lookups([], calls)
    );
    expect(presented?.items[0]!.activity).toEqual(calls.job_1);
    expect(presented?.items[1]).not.toHaveProperty('activity');
  });

  it('nests a child job right under its parent, and keeps one whose parent is not listed on top', () => {
    const runs = [
      subagentRun('s1'),
      subagentRun('s2', { parent: 'run-s1' }),
      subagentRun('s3', { parent: 'run-gone' }),
    ];
    const jobs = [
      subagentJob('job_1', 's1'),
      subagentJob('job_2', 's3'),
      subagentJob('job_3', 's2'),
    ];
    const items = present(jobs, lookups(runs))!.items;
    expect(items.map((item) => [item.jobId, item.depth])).toEqual([
      ['job_1', 0],
      ['job_3', 1],
      ['job_2', 0],
    ]);
  });

  it('lists jobs whose runs name each other as parents on top', () => {
    const runs = [subagentRun('s1', { parent: 'run-s2' }), subagentRun('s2', { parent: 'run-s1' })];
    const items = present(
      [subagentJob('job_1', 's1'), subagentJob('job_2', 's2')],
      lookups(runs)
    )!.items;
    expect(items.map((item) => [item.jobId, item.depth])).toEqual([
      ['job_1', 0],
      ['job_2', 0],
    ]);
  });

  it('caps the nesting at three steps', () => {
    const ids = ['s1', 's2', 's3', 's4', 's5'];
    const runs = ids.map((id, index) =>
      subagentRun(id, { parent: index ? `run-${ids[index - 1]}` : null })
    );
    const items = present(
      ids.map((id, index) => subagentJob(`job_${index + 1}`, id)),
      lookups(runs)
    )!.items;
    expect(items.map((item) => item.depth)).toEqual([0, 1, 2, 3, 3]);
  });

  it('groups sub-agents before tools, oldest first in each, and counts them', () => {
    const jobs = [
      job('job_1'),
      subagentJob('job_2', 's2'),
      job('job_3', { status: 'awaiting_approval' }),
      subagentJob('job_4', 's4'),
    ];
    const presented = present(jobs, lookups([]));
    expect(
      presented?.groups.map(({ kind, items }) => [kind, items.map((item) => item.jobId)])
    ).toEqual([
      ['subagent', ['job_2', 'job_4']],
      ['tool', ['job_1', 'job_3']],
    ]);
    expect(presented?.items.map((item) => item.jobId)).toEqual([
      'job_2',
      'job_4',
      'job_1',
      'job_3',
    ]);
    expect(presented?.summary).toEqual({ subagents: 2, tools: 2, waiting: 1 });
  });

  it('counts a job waiting for approval no longer once it is being stopped', () => {
    const jobs = [job('job_1'), job('job_2', { status: 'awaiting_approval' })];
    const stopped = presentBackgroundJobs(jobs, (jobId) => jobId === 'job_2', t, 2, lookups([]));
    expect(stopped?.summary?.waiting).toBe(0);
  });

  it('has one group and no summary for a single job', () => {
    const presented = present([job('job_1')], lookups([]));
    expect(presented?.groups.map(({ kind }) => kind)).toEqual(['tool']);
    expect(presented).not.toHaveProperty('summary');
  });
});
