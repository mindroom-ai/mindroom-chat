import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { Cron } from 'croner';
import {
  parsePendingScheduledTaskStateEvent,
  SCHEDULED_TASK_CRON_FIELD_TOKEN_LIMITS,
  SCHEDULED_TASK_CRON_MAX_EXPRESSION_LENGTH,
  SCHEDULED_TASK_CRON_MAX_FIELD_LENGTHS,
  SCHEDULED_TASK_CRON_MAX_TOKEN_LENGTH,
  type ParsedScheduledTask,
} from './scheduledTaskContract';

export type ThreadScheduledStatus = {
  scheduledTaskCount: number;
  nextScheduledTs?: number;
  /** Refresh-only boundary for a known sibling; never safe to display as the aggregate next run. */
  nextScheduledRefreshTs?: number;
  hasDeferredCronEvaluation?: true;
};

export const EMPTY_THREAD_SCHEDULED_STATUS: ThreadScheduledStatus = Object.freeze({
  scheduledTaskCount: 0,
});

export type ThreadScheduledTaskCountStatus = {
  scheduledTaskCount: number;
  nextScheduledRefreshTs?: number;
};

type CronOccurrenceCacheEntry = {
  evaluatedAt: number;
  nextTs?: number;
};

type ParsedPendingTaskSnapshot = {
  scheduledTaskEvents: readonly MatrixEvent[];
  stateVersion: unknown;
  tasks: ParsedScheduledTask[];
  continuationTaskVisits: number;
  continuationExhausted: boolean;
};

type CronEvaluationCache = {
  results: Map<string, CronOccurrenceCacheEntry | typeof CRON_FAILURE>;
  parsedPendingTasks?: ParsedPendingTaskSnapshot;
};

type CronEvaluationBudget = {
  remainingCronerCalls: number;
  remainingWorkUnits: number;
};

export type RoomThreadScheduledStatusResolver = {
  resolve: (
    scheduledTaskEvents: readonly MatrixEvent[],
    now: number,
    priorityThreadRootId?: string,
    stateVersion?: unknown
  ) => Map<string, ThreadScheduledStatus>;
};

type ParsedCronField = {
  containsWildcard: boolean;
  coversFullCycle: boolean;
  hasUnsteppedWildcard: boolean;
  normalized: string;
  values: number[];
};

const CRON_FIELD_BOUNDS = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
] as const;
const MAX_DAYS_BY_MONTH = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
const MAX_CRONER_CALLS_PER_BUILD = 32;
const MAX_CRON_WORK_UNITS_PER_BUILD = 64;
const MAX_CRON_CONTINUATION_TASK_VISITS = 4096;
const CRON_FAILURE = Symbol('cronFailure');
const CRON_DEFERRED = Symbol('cronDeferred');
const roomScheduledStatusResolvers = new WeakMap<Room, RoomThreadScheduledStatusResolver>();

const isOneShotScheduledTask = (task: ParsedScheduledTask): boolean =>
  task.scheduleType === 'once' ||
  (task.scheduleType === null && task.cronSchedule === null && task.cronScheduleMalformed !== true);

const parseScheduledTimestamp = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
};

const areParsedTasksEqual = (
  previousTasks: readonly ParsedScheduledTask[],
  nextTasks: readonly ParsedScheduledTask[]
): boolean => {
  if (previousTasks.length !== nextTasks.length) return false;
  const nextTasksById = new Map(nextTasks.map((task) => [task.taskId, task]));
  if (nextTasksById.size !== nextTasks.length) return false;

  return previousTasks.every((previousTask) => {
    const nextTask = nextTasksById.get(previousTask.taskId);
    return (
      nextTask !== undefined &&
      previousTask.status === nextTask.status &&
      previousTask.scheduleType === nextTask.scheduleType &&
      previousTask.threadId === nextTask.threadId &&
      previousTask.newThread === nextTask.newThread &&
      previousTask.executeAt === nextTask.executeAt &&
      previousTask.cronSchedule === nextTask.cronSchedule &&
      previousTask.cronScheduleMalformed === nextTask.cronScheduleMalformed &&
      previousTask.nextRunAt === nextTask.nextRunAt
    );
  });
};

const getParsedPendingTasks = (
  scheduledTaskEvents: readonly MatrixEvent[],
  evaluationCache: CronEvaluationCache,
  stateVersion: unknown
): ParsedPendingTaskSnapshot => {
  const cached = evaluationCache.parsedPendingTasks;
  if (
    cached &&
    cached.scheduledTaskEvents === scheduledTaskEvents &&
    cached.stateVersion === stateVersion
  ) {
    return cached;
  }

  const tasks = scheduledTaskEvents.reduce<ParsedScheduledTask[]>((pendingTasks, event) => {
    const parsedTask = parsePendingScheduledTaskStateEvent(event);
    if (parsedTask) pendingTasks.push(parsedTask);
    return pendingTasks;
  }, []);
  // The source/version controls reparsing, but only parsed schedule content owns the episode.
  if (cached && areParsedTasksEqual(cached.tasks, tasks)) {
    cached.scheduledTaskEvents = scheduledTaskEvents;
    cached.stateVersion = stateVersion;
    cached.tasks = tasks;
    return cached;
  }

  const snapshot: ParsedPendingTaskSnapshot = {
    scheduledTaskEvents,
    stateVersion,
    tasks,
    continuationTaskVisits: 0,
    continuationExhausted: false,
  };
  evaluationCache.parsedPendingTasks = snapshot;
  return snapshot;
};

const buildNumberRange = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_value, index) => from + index);

const parseCronNumber = (value: string): number | undefined => {
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

const parseSupportedCronField = (
  field: string,
  fieldIndex: number,
  min: number,
  max: number
): ParsedCronField | undefined => {
  if (field.length > SCHEDULED_TASK_CRON_MAX_FIELD_LENGTHS[fieldIndex]) return undefined;
  const parts = field.split(',');
  if (
    parts.length > SCHEDULED_TASK_CRON_FIELD_TOKEN_LIMITS[fieldIndex] ||
    parts.some((part) => part.length === 0 || part.length > SCHEDULED_TASK_CRON_MAX_TOKEN_LENGTH)
  ) {
    return undefined;
  }
  const values = new Set<number>();
  const cycleMax = fieldIndex === 4 ? 6 : max;
  const fullCycle = buildNumberRange(min, cycleMax);

  for (const part of parts) {
    const stepParts = part.split('/');
    if (stepParts.length > 2) return undefined;
    const [base, stepValue] = stepParts;
    const step = stepValue === undefined ? 1 : parseCronNumber(stepValue);
    if (step === undefined || step < 1) return undefined;

    let baseValues: number[];
    if (base === '*') {
      baseValues = fullCycle;
    } else {
      const rangeMatch = /^(\d+)-(\d+)$/.exec(base);
      if (rangeMatch) {
        const from = parseCronNumber(rangeMatch[1]);
        const to = parseCronNumber(rangeMatch[2]);
        if (
          from === undefined ||
          to === undefined ||
          from < min ||
          from > max ||
          to < min ||
          to > max ||
          from > to
        ) {
          return undefined;
        }
        // croniter treats an equal-ended range as a full cycle before applying its step.
        baseValues = from === to ? fullCycle : buildNumberRange(from, to);
      } else {
        const value = parseCronNumber(base);
        if (value === undefined || value < min || value > max) return undefined;
        // A stepped value at the field maximum also wraps to the field minimum in croniter.
        baseValues =
          stepValue === undefined
            ? [value]
            : value >= cycleMax
            ? fullCycle
            : buildNumberRange(value, cycleMax);
      }
    }

    baseValues.forEach((value, index) => {
      if (index % step !== 0) return;
      values.add(fieldIndex === 4 && value === 7 ? 0 : value);
    });
  }

  const sortedValues = [...values].sort((left, right) => left - right);
  if (sortedValues.length === 0) return undefined;
  // An unstepped wildcard dominates sibling list values, but */n remains restricted.
  const hasUnsteppedWildcard = parts.includes('*');
  const coversFullCycle = sortedValues.length === fullCycle.length;
  return {
    containsWildcard: field.includes('*'),
    coversFullCycle,
    hasUnsteppedWildcard,
    normalized: hasUnsteppedWildcard || coversFullCycle ? '*' : sortedValues.join(','),
    values: sortedValues,
  };
};

const getSupportedCronExpressionGroups = (cronSchedule: string): string[][] | undefined => {
  if (cronSchedule.length > SCHEDULED_TASK_CRON_MAX_EXPRESSION_LENGTH) return undefined;
  const fields = cronSchedule.split(' ');
  if (fields.length !== CRON_FIELD_BOUNDS.length) return undefined;
  const parsedFields: ParsedCronField[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const parsedField = parseSupportedCronField(
      fields[index],
      index,
      CRON_FIELD_BOUNDS[index][0],
      CRON_FIELD_BOUNDS[index][1]
    );
    if (!parsedField) return undefined;
    parsedFields.push(parsedField);
  }
  const normalizedFields = parsedFields.map(({ normalized }) => normalized);
  const dayOfMonth = parsedFields[2];
  const dayOfWeek = parsedFields[4];
  // croniter collapses a full day field to wildcard only when the other raw day field
  // contains `*`; otherwise the full value set remains a restricted Vixie OR arm.
  const dayOfMonthRestricted =
    !dayOfMonth.hasUnsteppedWildcard && !(dayOfMonth.coversFullCycle && dayOfWeek.containsWildcard);
  const dayOfWeekRestricted =
    !dayOfWeek.hasUnsteppedWildcard && !(dayOfWeek.coversFullCycle && dayOfMonth.containsWildcard);
  if (!dayOfMonthRestricted) return [[normalizedFields.join(' ')]];

  const months = parsedFields[3].values;
  const hasPossibleDayOfMonth = dayOfMonth.values.some((day) =>
    months.some((month) => day <= MAX_DAYS_BY_MONTH[month])
  );
  if (!hasPossibleDayOfMonth) return [];

  // Split DOM values so an impossible value cannot hide valid siblings in Croner's search.
  const dayOfMonthExpressions = dayOfMonth.values.map((day) => {
    const expressionFields = [...normalizedFields];
    expressionFields[2] = String(day);
    expressionFields[4] = '*';
    return expressionFields.join(' ');
  });
  if (!dayOfWeekRestricted) return [dayOfMonthExpressions];

  const dayOfWeekArm = [...normalizedFields];
  dayOfWeekArm[2] = '*';
  return [dayOfMonthExpressions, [dayOfWeekArm.join(' ')]];
};

const getNextCronOccurrence = (
  cronSchedule: string,
  now: number,
  evaluationCache: CronEvaluationCache,
  evaluationBudget: CronEvaluationBudget
): number | undefined | typeof CRON_DEFERRED => {
  const cached = evaluationCache.results.get(cronSchedule);
  if (cached === CRON_FAILURE) return undefined;
  if (cached && cached.evaluatedAt <= now) {
    if (cached.nextTs === undefined) return undefined;
    if (cached.nextTs > now) return cached.nextTs;
  }

  if (evaluationBudget.remainingWorkUnits === 0) return CRON_DEFERRED;
  evaluationBudget.remainingWorkUnits -= 1;

  const expressionGroups = getSupportedCronExpressionGroups(cronSchedule);
  if (!expressionGroups || expressionGroups.length === 0) {
    evaluationCache.results.set(cronSchedule, CRON_FAILURE);
    return undefined;
  }

  let nextTs: number | undefined;
  for (const expressions of expressionGroups) {
    let groupNextTs: number | undefined;
    for (const expression of expressions) {
      if (
        evaluationBudget.remainingCronerCalls === 0 ||
        evaluationBudget.remainingWorkUnits === 0
      ) {
        return CRON_DEFERRED;
      }
      evaluationBudget.remainingCronerCalls -= 1;
      evaluationBudget.remainingWorkUnits -= 1;
      try {
        const candidate = Cron(expression, {
          legacyMode: true,
          utcOffset: 0,
        }).nextRun(new Date(now));
        const candidateTs = candidate?.getTime();
        if (
          candidateTs !== undefined &&
          Number.isFinite(candidateTs) &&
          candidateTs > now &&
          (groupNextTs === undefined || candidateTs < groupNextTs)
        ) {
          groupNextTs = candidateTs;
        }
      } catch {
        // A single impossible DOM value does not invalidate other values in the same logical arm.
      }
    }
    if (groupNextTs === undefined) {
      evaluationCache.results.set(cronSchedule, { evaluatedAt: now });
      return undefined;
    }
    if (nextTs === undefined || groupNextTs < nextTs) nextTs = groupNextTs;
  }

  if (nextTs === undefined) {
    evaluationCache.results.set(cronSchedule, { evaluatedAt: now });
    return undefined;
  }
  evaluationCache.results.set(cronSchedule, { evaluatedAt: now, nextTs });
  return nextTs;
};

const resolveRoomThreadScheduledStatusMap = (
  cronEvaluationCache: CronEvaluationCache,
  scheduledTaskEvents: readonly MatrixEvent[],
  now: number,
  priorityThreadRootId?: string,
  stateVersion: unknown = undefined
): Map<string, ThreadScheduledStatus> => {
  const statusMap = new Map<string, ThreadScheduledStatus>();
  const activeCronSchedules = new Set<string>();
  const parsedTaskSnapshot = getParsedPendingTasks(
    scheduledTaskEvents,
    cronEvaluationCache,
    stateVersion
  );
  const parsedTasks = parsedTaskSnapshot.tasks;
  // A deferred result may re-arm only when both this full scan and its successor fit the
  // state-local lifecycle ceiling. The final allowed scan terminally degrades its overflow.
  const canContinueAfterThisBuild =
    !parsedTaskSnapshot.continuationExhausted &&
    parsedTaskSnapshot.continuationTaskVisits + parsedTasks.length * 2 <=
      MAX_CRON_CONTINUATION_TASK_VISITS;
  const cronEvaluationBudget: CronEvaluationBudget = {
    remainingCronerCalls: parsedTaskSnapshot.continuationExhausted ? 0 : MAX_CRONER_CALLS_PER_BUILD,
    remainingWorkUnits: parsedTaskSnapshot.continuationExhausted
      ? 0
      : MAX_CRON_WORK_UNITS_PER_BUILD,
  };
  const orderedTasks = priorityThreadRootId
    ? [
        ...parsedTasks.filter(({ threadId }) => threadId === priorityThreadRootId),
        ...parsedTasks.filter(({ threadId }) => threadId !== priorityThreadRootId),
      ]
    : parsedTasks;

  const threadsWithUnknownOccurrence = new Set<string>();
  const earliestKnownOccurrenceByThread = new Map<string, number>();
  let encounteredDeferredCronEvaluation = false;

  orderedTasks.forEach((parsedTask) => {
    if (parsedTask.newThread) return;
    if (!parsedTask.threadId) return;

    let nextTaskTs: number | undefined;
    let hasDeferredCronEvaluation = false;
    let hasElapsedScheduledAt = false;
    const isOneShot = isOneShotScheduledTask(parsedTask);
    if (parsedTask.nextRunAt) {
      const parsedScheduledAtTs = parseScheduledTimestamp(parsedTask.nextRunAt);
      if (parsedScheduledAtTs !== undefined) {
        if (parsedScheduledAtTs <= now) {
          hasElapsedScheduledAt = true;
          if (isOneShot) return;
        } else {
          nextTaskTs = parsedScheduledAtTs;
        }
      }
    }
    if (
      nextTaskTs === undefined &&
      parsedTask.scheduleType !== 'cron' &&
      parsedTask.scheduleType !== 'unsupported' &&
      parsedTask.executeAt
    ) {
      const parsedScheduledAtTs = parseScheduledTimestamp(parsedTask.executeAt);
      if (parsedScheduledAtTs !== undefined) {
        if (parsedScheduledAtTs <= now) {
          hasElapsedScheduledAt = true;
        } else {
          nextTaskTs = parsedScheduledAtTs;
        }
      }
    }

    const canEvaluateCron = parsedTask.scheduleType === 'cron' || parsedTask.scheduleType === null;
    if (nextTaskTs === undefined && canEvaluateCron && parsedTask.cronSchedule) {
      activeCronSchedules.add(parsedTask.cronSchedule);
      const cronResolution = getNextCronOccurrence(
        parsedTask.cronSchedule,
        now,
        cronEvaluationCache,
        cronEvaluationBudget
      );
      if (cronResolution === CRON_DEFERRED) {
        encounteredDeferredCronEvaluation = true;
        hasDeferredCronEvaluation = canContinueAfterThisBuild;
      } else {
        nextTaskTs = cronResolution;
      }
    }

    if (nextTaskTs === undefined && hasElapsedScheduledAt && isOneShot) return;

    const current = statusMap.get(parsedTask.threadId) ?? EMPTY_THREAD_SCHEDULED_STATUS;
    if (nextTaskTs !== undefined) {
      const earliestKnownOccurrence = earliestKnownOccurrenceByThread.get(parsedTask.threadId);
      if (earliestKnownOccurrence === undefined || nextTaskTs < earliestKnownOccurrence) {
        earliestKnownOccurrenceByThread.set(parsedTask.threadId, nextTaskTs);
      }
    }
    if (nextTaskTs === undefined && !hasDeferredCronEvaluation) {
      threadsWithUnknownOccurrence.add(parsedTask.threadId);
    }
    const threadHasDeferredCronEvaluation =
      current.hasDeferredCronEvaluation === true || hasDeferredCronEvaluation;
    const nextScheduledTs =
      threadHasDeferredCronEvaluation || threadsWithUnknownOccurrence.has(parsedTask.threadId)
        ? undefined
        : nextTaskTs === undefined
        ? current.nextScheduledTs
        : current.nextScheduledTs === undefined || nextTaskTs < current.nextScheduledTs
        ? nextTaskTs
        : current.nextScheduledTs;

    statusMap.set(parsedTask.threadId, {
      scheduledTaskCount: current.scheduledTaskCount + 1,
      nextScheduledTs,
      ...(threadsWithUnknownOccurrence.has(parsedTask.threadId) &&
      earliestKnownOccurrenceByThread.has(parsedTask.threadId)
        ? {
            nextScheduledRefreshTs: earliestKnownOccurrenceByThread.get(parsedTask.threadId),
          }
        : {}),
      ...(threadHasDeferredCronEvaluation ? { hasDeferredCronEvaluation: true as const } : {}),
    });
  });

  if (
    !parsedTaskSnapshot.continuationExhausted &&
    (cronEvaluationBudget.remainingCronerCalls !== MAX_CRONER_CALLS_PER_BUILD ||
      cronEvaluationBudget.remainingWorkUnits !== MAX_CRON_WORK_UNITS_PER_BUILD)
  ) {
    parsedTaskSnapshot.continuationTaskVisits += parsedTasks.length;
  }
  if (!encounteredDeferredCronEvaluation) {
    parsedTaskSnapshot.continuationTaskVisits = 0;
  }
  if (encounteredDeferredCronEvaluation && !canContinueAfterThisBuild) {
    parsedTaskSnapshot.continuationExhausted = true;
  }

  cronEvaluationCache.results.forEach((_result, cronSchedule) => {
    if (!activeCronSchedules.has(cronSchedule)) cronEvaluationCache.results.delete(cronSchedule);
  });

  return statusMap;
};

export const createRoomThreadScheduledStatusResolver = (): RoomThreadScheduledStatusResolver => {
  const evaluationCache: CronEvaluationCache = {
    results: new Map<string, CronOccurrenceCacheEntry | typeof CRON_FAILURE>(),
  };

  return {
    resolve: (scheduledTaskEvents, now, priorityThreadRootId, stateVersion) =>
      resolveRoomThreadScheduledStatusMap(
        evaluationCache,
        scheduledTaskEvents,
        now,
        priorityThreadRootId,
        stateVersion
      ),
  };
};

export const getRoomThreadScheduledStatusResolver = (
  room: Room
): RoomThreadScheduledStatusResolver => {
  const cached = roomScheduledStatusResolvers.get(room);
  if (cached) return cached;
  const resolver = createRoomThreadScheduledStatusResolver();
  roomScheduledStatusResolvers.set(room, resolver);
  return resolver;
};

/** Stateless compatibility entry point; continuation-capable UI uses the room-owned resolver. */
export const buildRoomThreadScheduledStatusMap = (
  scheduledTaskEvents: readonly MatrixEvent[],
  now: number,
  priorityThreadRootId?: string,
  stateVersion: unknown = undefined
): Map<string, ThreadScheduledStatus> =>
  createRoomThreadScheduledStatusResolver().resolve(
    scheduledTaskEvents,
    now,
    priorityThreadRootId,
    stateVersion
  );

const getRoomScheduledTaskCountStatusMap = (
  scheduledTaskEvents: readonly MatrixEvent[],
  now: number
): Map<string, ThreadScheduledTaskCountStatus> => {
  const countStatusMap = new Map<string, ThreadScheduledTaskCountStatus>();
  scheduledTaskEvents.forEach((event) => {
    const parsedTask = parsePendingScheduledTaskStateEvent(event);
    if (!parsedTask || parsedTask.newThread || !parsedTask.threadId) {
      return;
    }

    const current = countStatusMap.get(parsedTask.threadId) ?? { scheduledTaskCount: 0 };
    let nextScheduledRefreshTs = current.nextScheduledRefreshTs;
    if (isOneShotScheduledTask(parsedTask)) {
      const nextRunTs = parseScheduledTimestamp(parsedTask.nextRunAt);
      const expiryTs = nextRunTs ?? parseScheduledTimestamp(parsedTask.executeAt);
      if (expiryTs !== undefined) {
        if (expiryTs <= now) return;
        if (nextScheduledRefreshTs === undefined || expiryTs < nextScheduledRefreshTs) {
          nextScheduledRefreshTs = expiryTs;
        }
      }
    }

    countStatusMap.set(parsedTask.threadId, {
      scheduledTaskCount: current.scheduledTaskCount + 1,
      ...(nextScheduledRefreshTs === undefined ? {} : { nextScheduledRefreshTs }),
    });
  });

  return countStatusMap;
};

export const getThreadScheduledTaskCountStatus = (
  scheduledTaskEvents: readonly MatrixEvent[],
  threadRootId: string | undefined,
  now: number
): ThreadScheduledTaskCountStatus => {
  if (!threadRootId) return { scheduledTaskCount: 0 };
  return (
    getRoomScheduledTaskCountStatusMap(scheduledTaskEvents, now).get(threadRootId) ?? {
      scheduledTaskCount: 0,
    }
  );
};

export const getThreadScheduledStatus = (
  scheduledStatusMap: ReadonlyMap<string, ThreadScheduledStatus>,
  threadRootId: string | undefined
): ThreadScheduledStatus =>
  threadRootId
    ? scheduledStatusMap.get(threadRootId) ?? EMPTY_THREAD_SCHEDULED_STATUS
    : EMPTY_THREAD_SCHEDULED_STATUS;

export const getRoomScheduledTaskCounts = (
  scheduledTaskEvents: readonly MatrixEvent[],
  now: number
): Map<string, number> => {
  const counts = new Map<string, number>();
  getRoomScheduledTaskCountStatusMap(scheduledTaskEvents, now).forEach((status, threadRootId) => {
    counts.set(threadRootId, status.scheduledTaskCount);
  });
  return counts;
};

export const getNextThreadScheduledTs = (
  scheduledTaskEvents: readonly MatrixEvent[],
  threadRootId: string | undefined,
  now: number
): number | undefined =>
  getThreadScheduledStatus(
    buildRoomThreadScheduledStatusMap(scheduledTaskEvents, now, threadRootId),
    threadRootId
  ).nextScheduledTs;
