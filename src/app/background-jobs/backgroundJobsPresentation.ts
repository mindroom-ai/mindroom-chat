import type { TFunction } from 'i18next';
import type { BackgroundJob } from '../matrix/protocol/backgroundJobsContract';
import type { SubagentRun } from '../messages/live/subagentRunStore';

export type BackgroundJobsBarItem = {
  jobId: string;
  // The job's own name, for its row, its Stop button and errors.
  name: string;
  // Among several, its row says it waits for approval; one job's title says so.
  waiting: boolean;
  // Its cancel was sent from this client, or requested anywhere else.
  stopping: boolean;
  // It ended, and the bar keeps it while the agent's reply goes on; nothing is left to stop.
  finished: boolean;
  // A sub-agent's run, which the room's Sub-agents panel shows: its row's name opens the panel.
  subagent: boolean;
  // The thread it runs for (its root's ID), or null for the room's own timeline.
  threadId: string | null;
  // How it stands, as its row's dot shows it.
  state: JobState;
  // A sub-agent job's agent: its run's, else the job's tool, which names the agent it delegates to.
  agent?: string;
  // When it started, in ms; NaN when its time does not parse.
  startedAt: number;
  // A sub-agent's newest turn, joined by the sub-agent the job names; none before its first frame.
  run?: SubagentRun;
  // What it does now: a sub-agent's newest tool call, or a tool job's own call in its reply.
  activity?: JobActivity;
  // How many listed sub-agent jobs it runs under, at most `MAX_JOB_DEPTH`.
  depth: number;
};

export type JobActivity = { tool: string; preview?: string };

export type JobKind = 'subagent' | 'tool';

export type JobState = 'running' | 'waiting' | 'stopping' | 'finished';

export type BackgroundJobsBarModel = {
  title: string;
  // Sub-agents first, each child right under its parent, then tools; oldest first in each.
  items: BackgroundJobsBarItem[];
  // The items by kind, one group per kind present.
  groups: { kind: JobKind; items: BackgroundJobsBarItem[] }[];
  // Several jobs only.
  summary?: { subagents: number; tools: number; waiting: number };
};

/** What the bar joins the jobs to: a sub-agent's newest run, and a tool call in an agent's reply. */
export type BackgroundJobLookups = {
  runFor: (subagent: string) => SubagentRun | undefined;
  toolCallFor: (toolCallId: string) => JobActivity | undefined;
};

const NO_LOOKUPS: BackgroundJobLookups = { runFor: () => undefined, toolCallFor: () => undefined };

export const MAX_JOB_DEPTH = 3;

const jobName = (job: BackgroundJob, t: TFunction): string =>
  job.kind === 'subagent' ? t('mindroomUi.backgroundJobs.subagent', { tool: job.tool }) : job.tool;

const awaitingApproval = (job: BackgroundJob): boolean => job.status === 'awaiting_approval';

/** The status the bar gives the jobs it keeps after they ended; agents list only live jobs. */
export const FINISHED_JOB_STATUS = 'finished';

const newestToolCall = (run: SubagentRun | undefined): JobActivity | undefined => {
  const { tool_name: tool, args_preview: preview } = run?.docs.tools.at(-1) ?? {};
  if (typeof tool !== 'string' || !tool) return undefined;
  return typeof preview === 'string' && preview ? { tool, preview } : { tool };
};

const joinJob = (
  job: BackgroundJob,
  { runFor, toolCallFor }: BackgroundJobLookups
): Pick<BackgroundJobsBarItem, 'run' | 'activity' | 'agent'> => {
  if (job.kind === 'subagent') {
    const run = job.subagent === undefined ? undefined : runFor(job.subagent);
    const activity = newestToolCall(run);
    return {
      agent: run?.meta.agent ?? job.tool,
      ...(run ? { run } : {}),
      ...(activity ? { activity } : {}),
    };
  }
  const activity = job.toolCallId === undefined ? undefined : toolCallFor(job.toolCallId);
  return activity ? { activity } : {};
};

/** Each sub-agent job right after the listed job whose run started it, one step deeper. */
const nest = (items: BackgroundJobsBarItem[], runs: Map<string, string | undefined>) => {
  const byRun = new Map<string, BackgroundJobsBarItem>();
  items.forEach((item) => {
    const run = item.run?.run ?? runs.get(item.jobId);
    if (run) byRun.set(run, item);
  });
  const parentOf = (item: BackgroundJobsBarItem) => {
    const parent = item.run?.meta.parent;
    return parent ? byRun.get(parent) : undefined;
  };
  // A job is on top when no listed job started it, or when its parents lead back to itself.
  const onTop = (item: BackgroundJobsBarItem) => {
    const seen = new Set([item]);
    for (let above = parentOf(item); above; above = parentOf(above)) {
      if (seen.has(above)) return true;
      seen.add(above);
    }
    return !parentOf(item);
  };
  const placed: BackgroundJobsBarItem[] = [];
  const place = (item: BackgroundJobsBarItem, depth: number) => {
    placed.push({ ...item, depth: Math.min(depth, MAX_JOB_DEPTH) });
    items
      .filter((child) => parentOf(child) === item && !onTop(child))
      .forEach((child) => place(child, depth + 1));
  };
  items.filter(onTop).forEach((item) => place(item, 0));
  return placed;
};

/** The jobs bar for a view's background jobs, or nothing when it has none. */
export const presentBackgroundJobs = (
  jobs: BackgroundJob[],
  // Whether this client sent a cancel for the job.
  cancelSent: (jobId: string) => boolean,
  t: TFunction,
  // The view's live jobs, listed or not; more than listed when the agents list only their newest.
  total = jobs.length,
  lookups = NO_LOOKUPS
): BackgroundJobsBarModel | null => {
  const [first] = jobs;
  if (!first) return null;
  const several = jobs.length > 1;
  const listed: BackgroundJobsBarItem[] = jobs.map((job) => {
    const finished = job.status === FINISHED_JOB_STATUS;
    const stopping = !finished && (job.status === 'cancel_requested' || cancelSent(job.jobId));
    let state: JobState = 'running';
    if (finished) state = 'finished';
    else if (stopping) state = 'stopping';
    else if (awaitingApproval(job)) state = 'waiting';
    return {
      jobId: job.jobId,
      name: jobName(job, t),
      waiting: !finished && several && awaitingApproval(job),
      stopping,
      finished,
      state,
      subagent: job.kind === 'subagent',
      threadId: job.threadId,
      startedAt: Date.parse(job.startedAt),
      depth: 0,
      ...joinJob(job, lookups),
    };
  });
  const subagents = nest(
    listed.filter((item) => item.subagent),
    new Map(jobs.map((job) => [job.jobId, job.run]))
  );
  const tools = listed.filter((item) => !item.subagent);
  const groups = [
    { kind: 'subagent' as const, items: subagents },
    { kind: 'tool' as const, items: tools },
  ].filter((group) => group.items.length > 0);
  const items = [...subagents, ...tools];
  const finished = items.every((item) => item.finished);
  if (several) {
    const summary = {
      subagents: subagents.length,
      tools: tools.length,
      waiting: items.filter((item) => item.waiting).length,
    };
    let title: string;
    if (finished) title = t('mindroomUi.backgroundJobs.jobCountFinished', { count: jobs.length });
    else if (total > jobs.length)
      title = t('mindroomUi.backgroundJobs.jobCountShowing', { count: total, shown: jobs.length });
    else title = t('mindroomUi.backgroundJobs.jobCount', { count: jobs.length });
    return { title, items, groups, summary };
  }
  const tool = items[0]!.name;
  const one = { items, groups };
  if (finished) return { title: t('mindroomUi.backgroundJobs.finished', { tool }), ...one };
  if (items[0]!.stopping)
    return { title: t('mindroomUi.backgroundJobs.stoppingJob', { tool }), ...one };
  if (awaitingApproval(first))
    return { title: t('mindroomUi.backgroundJobs.awaitingApproval', { tool }), ...one };
  return { title: t('mindroomUi.backgroundJobs.running', { tool }), ...one };
};
