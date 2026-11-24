import type { TFunction } from 'i18next';
import type { BackgroundJob } from '../matrix/protocol/backgroundJobsContract';
import type { SubagentRun } from '../messages/live/subagentRunStore';
import type { WorkflowRunEntry } from '../messages/live/workflowRunStore';
import { workflowRunHeading } from '../messages/workflow-run/workflowRunLabels';
import { runToolCall, type ToolActivity } from '../subagents/runActivity';
import { runOfJob } from '../subagents/runJob';
import { plainToolName } from './toolNames';

export type BackgroundJobsBarItem = {
  jobId: string;
  // The job's own name, for its row, its Stop button and errors.
  name: string;
  plainName?: string;
  // Its row says it waits for approval.
  waiting: boolean;
  // Its cancel was sent from this client, or requested anywhere else.
  stopping: boolean;
  // It ended, and the bar keeps it while the agent's reply goes on; nothing is left to stop.
  finished: boolean;
  // A sub-agent's run, which the room's Sub-agents panel shows: its row's name opens the panel.
  subagent: boolean;
  // Workflow run job (`kind: 'workflow'`), holding its run ID (or empty string before arrival).
  workflow?: string;
  // Workflow waits on a user question rather than a tool approval.
  workflowWaiting?: boolean;
  // Live state of a workflow run job, joined by `job.workflow`.
  workflowRun?: WorkflowRunEntry;
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
  // What it does now: a tool job's own call in its reply, a sub-agent's run's current call.
  activity?: JobActivity;
  // How many listed sub-agent jobs it runs under, at most `MAX_JOB_DEPTH`.
  depth: number;
};

export type JobActivity = ToolActivity;

export type JobKind = 'workflow' | 'subagent' | 'tool';

export type JobState = 'running' | 'waiting' | 'stopping' | 'finished';

export type BackgroundJobsBarModel = {
  // How the jobs stand, the bar's name: one job's state and name, or how many run.
  title: string;
  // The listed bar's title line: how many jobs run, or ran.
  heading: string;
  // Sub-agents first, each child right under its parent, then tools; oldest first in each.
  items: BackgroundJobsBarItem[];
  // The items by kind, one group per kind present.
  groups: { kind: JobKind; items: BackgroundJobsBarItem[] }[];
  summary: { subagents: number; tools: number; waiting: number };
};

/** What the bar joins the jobs to: the room's sub-agent runs, and each tool job's call. */
export type BackgroundJobLookups = {
  runs: readonly SubagentRun[];
  // The call in the job's own agent's reply in the job's conversation.
  toolCallFor: (job: BackgroundJob) => JobActivity | undefined;
  // Workflow runs in the room keyed by run ID (`wf-...`).
  workflowRuns?: ReadonlyMap<string, WorkflowRunEntry>;
};

const NO_LOOKUPS: BackgroundJobLookups = {
  runs: [],
  toolCallFor: () => undefined,
  workflowRuns: new Map(),
};

export const MAX_JOB_DEPTH = 3;

const jobName = (job: BackgroundJob, t: TFunction, workflowRun?: WorkflowRunEntry): string => {
  if (job.kind === 'workflow') {
    return workflowRun
      ? workflowRunHeading(workflowRun.meta, t)
      : t('mindroomUi.workflowRun.title');
  }
  return job.kind === 'subagent'
    ? t('mindroomUi.backgroundJobs.subagent', { tool: job.tool })
    : job.tool;
};

const awaitingApproval = (job: BackgroundJob): boolean => job.status === 'awaiting_approval';

const workflowWaitKind = (
  job: BackgroundJob,
  workflowRun?: WorkflowRunEntry
): 'approval' | 'user' | null => {
  if (awaitingApproval(job)) return 'approval';
  const nodes = workflowRun?.graph.nodes;
  if (nodes?.some((n) => n.status === 'waiting' && n.waitingOn === 'approval')) return 'approval';
  if (nodes?.some((n) => n.status === 'waiting' && n.waitingOn === 'user')) return 'user';
  if (workflowRun?.meta.status !== 'waiting') return null;
  const waitingNodes = nodes?.filter((n) => n.status === 'waiting') ?? [];
  return waitingNodes.length > 0 && waitingNodes.every((n) => n.waitingOn === 'peer')
    ? null
    : 'user';
};

/** The status the bar gives the jobs it keeps after they ended; agents list only live jobs. */
export const FINISHED_JOB_STATUS = 'finished';

const joinJob = (
  job: BackgroundJob,
  { runs, toolCallFor, workflowRuns }: BackgroundJobLookups,
  details: boolean
): Pick<BackgroundJobsBarItem, 'run' | 'workflowRun' | 'activity' | 'agent'> => {
  if (job.kind === 'workflow') {
    const workflowRun = job.workflow ? workflowRuns?.get(job.workflow) : undefined;
    return {
      ...(workflowRun ? { workflowRun, agent: workflowRun.meta.agent } : {}),
    };
  }
  if (job.kind === 'subagent') {
    const run = runOfJob(runs, job);
    // A job the bar holds after it ended is done, though its run's last frame may not be in yet.
    const activity =
      details && run && job.status !== FINISHED_JOB_STATUS ? runToolCall(run) : undefined;
    return {
      agent: run?.meta.agent ?? job.tool,
      ...(run ? { run } : {}),
      ...(activity ? { activity } : {}),
    };
  }
  const activity = toolCallFor(job);
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
  lookups = NO_LOOKUPS,
  // Whether the reader shows the usage details (`showUsageDetails`), which name a tool job by its tool.
  details = true
): BackgroundJobsBarModel | null => {
  const [first] = jobs;
  if (!first) return null;
  const several = jobs.length > 1;
  const listed: BackgroundJobsBarItem[] = jobs.map((job) => {
    const joined = joinJob(job, lookups, details);
    const isWorkflow = job.kind === 'workflow';
    const finished = job.status === FINISHED_JOB_STATUS;
    const stopping = !finished && (job.status === 'cancel_requested' || cancelSent(job.jobId));
    const wfWait = !finished && isWorkflow ? workflowWaitKind(job, joined.workflowRun) : null;
    const waiting = !finished && (isWorkflow ? wfWait === 'approval' : awaitingApproval(job));
    const workflowWaiting = !finished && isWorkflow && wfWait === 'user';
    let state: JobState = 'running';
    if (finished) state = 'finished';
    else if (stopping) state = 'stopping';
    else if (waiting || workflowWaiting) state = 'waiting';
    const name = jobName(job, t, joined.workflowRun);
    return {
      jobId: job.jobId,
      name,
      ...(!details && job.kind !== 'subagent' && !isWorkflow
        ? { plainName: plainToolName(name, t) }
        : {}),
      waiting,
      ...(isWorkflow ? { workflow: job.workflow ?? '', workflowWaiting } : {}),
      stopping,
      finished,
      state,
      subagent: job.kind === 'subagent',
      threadId: job.threadId,
      startedAt: Date.parse(job.startedAt),
      depth: 0,
      ...joined,
    };
  });
  const workflows = listed.filter((item) => item.workflow !== undefined);
  const subagents = nest(
    listed.filter((item) => item.subagent),
    new Map(jobs.map((job) => [job.jobId, job.run]))
  );
  const tools = listed.filter((item) => !item.subagent && item.workflow === undefined);
  const groups = [
    { kind: 'workflow' as const, items: workflows },
    { kind: 'subagent' as const, items: subagents },
    { kind: 'tool' as const, items: tools },
  ].filter((group) => group.items.length > 0);
  const items = [...workflows, ...subagents, ...tools];
  const finished = items.every((item) => item.finished);
  const summary = {
    subagents: subagents.length,
    // Folded bar counts workflows alongside tools (as before the workflow group existed).
    tools: tools.length + workflows.length,
    // Only real approval waits count as "needs approval".
    waiting: items.filter((item) => item.waiting && !item.stopping).length,
  };
  if (several) {
    let title: string;
    if (finished) title = t('mindroomUi.backgroundJobs.jobCountFinished', { count: jobs.length });
    else if (total > jobs.length)
      title = t('mindroomUi.backgroundJobs.jobCountShowing', { count: total, shown: jobs.length });
    else title = t('mindroomUi.backgroundJobs.jobCount', { count: jobs.length });
    return { title, heading: title, items, groups, summary };
  }
  const tool = items[0]!.plainName ?? items[0]!.name;
  const heading = finished
    ? t('mindroomUi.backgroundJobs.jobTotalFinished', { count: 1 })
    : t('mindroomUi.backgroundJobs.jobTotal', { count: 1 });
  const one = { heading, items, groups, summary };
  if (finished) return { title: t('mindroomUi.backgroundJobs.finished', { tool }), ...one };
  if (items[0]!.stopping)
    return { title: t('mindroomUi.backgroundJobs.stoppingJob', { tool }), ...one };
  if (items[0]!.waiting)
    return { title: t('mindroomUi.backgroundJobs.awaitingApproval', { tool }), ...one };
  if (items[0]!.workflowWaiting)
    return { title: `${t('mindroomUi.workflowRun.status.waiting')}: ${tool}`, ...one };
  return { title: t('mindroomUi.backgroundJobs.running', { tool }), ...one };
};
