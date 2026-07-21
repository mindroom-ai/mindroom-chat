import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';

export const MINDROOM_SCHEDULED_TASK_EVENT = 'com.mindroom.scheduled.task';

export const SCHEDULED_TASK_CRON_FIELD_TOKEN_LIMITS = [60, 24, 31, 12, 8] as const;
export const SCHEDULED_TASK_CRON_MAX_TOKEN_LENGTH = 24;
export const SCHEDULED_TASK_CRON_MAX_FIELD_LENGTHS = SCHEDULED_TASK_CRON_FIELD_TOKEN_LIMITS.map(
  (tokenLimit) => tokenLimit * (SCHEDULED_TASK_CRON_MAX_TOKEN_LENGTH + 1) - 1
);
export const SCHEDULED_TASK_CRON_MAX_EXPRESSION_LENGTH =
  SCHEDULED_TASK_CRON_MAX_FIELD_LENGTHS.reduce((total, fieldLength) => total + fieldLength, 4);

type ScheduledTaskStateEventContent = {
  status?: unknown;
  workflow?: unknown;
  thread_id?: unknown;
  new_thread?: unknown;
  execute_at?: unknown;
  scheduled_at?: unknown;
  cron_schedule?: unknown;
  next_run_at?: unknown;
};

type ScheduledTaskCronSchedule = {
  minute?: unknown;
  hour?: unknown;
  day?: unknown;
  month?: unknown;
  weekday?: unknown;
};

type ScheduledTaskWorkflow = {
  schedule_type?: unknown;
  thread_id?: unknown;
  new_thread?: unknown;
  execute_at?: unknown;
  scheduled_at?: unknown;
  cron_schedule?: unknown;
};

export type ScheduledTaskScheduleType = 'once' | 'cron';
export type ParsedScheduledTaskScheduleType = ScheduledTaskScheduleType | 'unsupported' | null;

type ParsedWorkflow = {
  scheduleType?: ParsedScheduledTaskScheduleType;
  threadId?: string | null;
  newThread?: boolean;
  executeAt?: string | null;
  cronSchedule?: string | null;
  cronScheduleMalformed?: true;
};

export type ParsedScheduledTask = {
  taskId: string;
  status: string;
  scheduleType: ParsedScheduledTaskScheduleType;
  threadId: string | null;
  newThread: boolean;
  executeAt: string | null;
  cronSchedule: string | null;
  cronScheduleMalformed?: true;
  nextRunAt: string | null;
};

const parseThreadId = (value: unknown): string | null | undefined => {
  if (typeof value === 'string') return value;
  if (value === null) return null;
  return undefined;
};

const parseNewThread = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

const parseScheduledAt = (value: unknown): string | null | undefined => {
  if (typeof value === 'string') return value;
  if (value === null) return null;
  return undefined;
};

const parseScheduleType = (
  value: unknown
): Exclude<ParsedScheduledTaskScheduleType, null> | undefined => {
  if (value === 'once' || value === 'cron') return value;
  return value === undefined ? undefined : 'unsupported';
};

const parseCronSchedule = (value: unknown): string | null | undefined => {
  if (typeof value === 'string') {
    if (value.length > SCHEDULED_TASK_CRON_MAX_EXPRESSION_LENGTH) return null;
    const fields = value.trim().split(/\s+/);
    if (fields.length !== 5) return null;
    if (
      fields.some((field, index) => field.length > SCHEDULED_TASK_CRON_MAX_FIELD_LENGTHS[index])
    ) {
      return null;
    }
    return fields.join(' ');
  }
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const { minute, hour, day, month, weekday } = value as ScheduledTaskCronSchedule;
  const fields = [minute, hour, day, month, weekday];
  const normalizedFields: string[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (typeof field !== 'string') return null;
    if (field.length > SCHEDULED_TASK_CRON_MAX_FIELD_LENGTHS[index]) return null;
    const normalizedField = field.trim();
    if (!/^\S+$/.test(normalizedField)) return null;
    normalizedFields.push(normalizedField);
  }

  return normalizedFields.join(' ');
};

const isMalformedCronSchedule = (
  value: unknown,
  parsedCronSchedule: string | null | undefined
): boolean => value !== undefined && value !== null && parsedCronSchedule === null;

const parseWorkflow = (workflow: unknown): ParsedWorkflow | null => {
  if (workflow === undefined) return {};

  let parsedWorkflow: unknown = workflow;

  if (typeof workflow === 'string') {
    try {
      parsedWorkflow = JSON.parse(workflow);
    } catch {
      return null;
    }
  }

  if (!parsedWorkflow || typeof parsedWorkflow !== 'object' || Array.isArray(parsedWorkflow)) {
    return null;
  }

  const {
    schedule_type: scheduleTypeValue,
    thread_id: threadIdValue,
    new_thread: newThreadValue,
    execute_at: executeAtValue,
    scheduled_at: scheduledAtValue,
    cron_schedule: cronScheduleValue,
  } = parsedWorkflow as ScheduledTaskWorkflow;
  const cronSchedule = parseCronSchedule(cronScheduleValue);
  const cronScheduleMalformed = isMalformedCronSchedule(cronScheduleValue, cronSchedule);

  return {
    scheduleType: parseScheduleType(scheduleTypeValue) ?? null,
    threadId: parseThreadId(threadIdValue),
    newThread: parseNewThread(newThreadValue),
    executeAt: parseScheduledAt(executeAtValue) ?? parseScheduledAt(scheduledAtValue) ?? null,
    cronSchedule: cronSchedule ?? null,
    ...(cronScheduleMalformed ? { cronScheduleMalformed: true as const } : {}),
  };
};

const parseScheduledTaskStateEventContent = (
  event: MatrixEvent,
  content: ScheduledTaskStateEventContent
): ParsedScheduledTask | null => {
  const taskId = event.getStateKey();
  if (typeof taskId !== 'string') return null;

  const {
    status,
    thread_id: topLevelThreadId,
    new_thread: topLevelNewThread,
    execute_at: topLevelExecuteAt,
    scheduled_at: topLevelScheduledAt,
    cron_schedule: topLevelCronSchedule,
    next_run_at: topLevelNextRunAt,
    workflow,
  } = content;
  if (typeof status !== 'string') return null;

  const parsedWorkflow = parseWorkflow(workflow);
  const parsedTopLevelThreadId = parseThreadId(topLevelThreadId);
  const parsedTopLevelNewThread = parseNewThread(topLevelNewThread);
  const parsedTopLevelExecuteAt =
    parseScheduledAt(topLevelExecuteAt) ?? parseScheduledAt(topLevelScheduledAt);
  const parsedTopLevelCronSchedule = parseCronSchedule(topLevelCronSchedule);
  const cronScheduleMalformed =
    isMalformedCronSchedule(topLevelCronSchedule, parsedTopLevelCronSchedule) ||
    parsedWorkflow?.cronScheduleMalformed === true;

  if (
    workflow !== undefined &&
    parsedWorkflow === null &&
    (parsedTopLevelThreadId === undefined ||
      (topLevelNewThread !== undefined && parsedTopLevelNewThread === undefined))
  ) {
    return null;
  }

  return {
    taskId,
    status,
    scheduleType:
      workflow !== undefined && parsedWorkflow === null
        ? 'unsupported'
        : parsedWorkflow?.scheduleType ?? null,
    threadId: parsedTopLevelThreadId ?? parsedWorkflow?.threadId ?? null,
    newThread: parsedTopLevelNewThread ?? parsedWorkflow?.newThread ?? false,
    executeAt: parsedTopLevelExecuteAt ?? parsedWorkflow?.executeAt ?? null,
    cronSchedule: parsedTopLevelCronSchedule ?? parsedWorkflow?.cronSchedule ?? null,
    ...(cronScheduleMalformed ? { cronScheduleMalformed: true as const } : {}),
    nextRunAt: parseScheduledAt(topLevelNextRunAt) ?? null,
  };
};

const getScheduledTaskStateEventContent = (
  event: MatrixEvent
): ScheduledTaskStateEventContent | null => {
  const content = event.getContent<ScheduledTaskStateEventContent>();
  return content && typeof content === 'object' ? content : null;
};

export const parseScheduledTaskStateEvent = (event: MatrixEvent): ParsedScheduledTask | null => {
  const content = getScheduledTaskStateEventContent(event);
  return content ? parseScheduledTaskStateEventContent(event, content) : null;
};

export const parsePendingScheduledTaskStateEvent = (
  event: MatrixEvent
): ParsedScheduledTask | null => {
  const content = getScheduledTaskStateEventContent(event);
  if (!content || content.status !== 'pending') return null;
  return parseScheduledTaskStateEventContent(event, content);
};
