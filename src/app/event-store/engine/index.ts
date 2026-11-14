/**
 * ISSUE-207 P3.1: SyncEngine barrel.
 *
 * Consumers should import from here so future internal reshuffles
 * don't ripple across the codebase.
 */

export { createSyncEngine } from './syncEngine';
export type { CreateSyncEngineOptions } from './syncEngine';
export { SyncEngineProvider, useSyncEngine } from './engineContext';
export type { SyncEngineProviderProps } from './engineContext';
export { createEngineWriteThrough } from './engineWriteThrough';
export type { EngineWriteThrough, EngineWriteThroughOptions } from './engineWriteThrough';
export { createEngineGapTracker } from './engineGapTracker';
export type {
  EngineGapTracker,
  EngineGapTrackerOptions,
  GapFillJob,
  GapFillReason,
} from './engineGapTracker';
export type {
  EngineLifecycle,
  EngineLiveEventHandler,
  EngineLiveEventMeta,
  SyncEngine,
} from './types';
export { createEnginePersistFacade } from './enginePersistFacade';
export type {
  EnginePersistFacade,
  PersistRoomEventCache,
  PersistThreadEventCache,
} from './enginePersistFacade';
export {
  MAX_CONCURRENT_BACKFILL_JOBS,
  buildBackfillJobKey,
  createBackfillScheduler,
} from './backfillScheduler';
export type {
  BackfillJob,
  BackfillJobExecutor,
  BackfillJobKind,
  BackfillJobPriority,
  BackfillScheduler,
  CreateBackfillSchedulerOptions,
  EnqueueJobArgs,
} from './backfillScheduler';
export {
  CURRENT_ROOM_DEEP_HISTORY_TARGET,
  DEFAULT_PREFETCH_SCOPE,
  ROOM_TAIL_PREFETCH_DEPTH,
  resolvePrefetchConfig,
  sanitizePrefetchDepth,
  sanitizePrefetchScope,
} from './prefetchPolicy';
export type { PrefetchConfig, PrefetchScope } from './prefetchPolicy';
export { createGapFillExecutor } from './gapFillExecutor';
export type { GapFillExecutor, GapFillExecutorOptions } from './gapFillExecutor';
export { enqueueRoomDeepHistoryJob } from './deepHistoryJob';
export type { HistoryPage } from './deepHistoryJob';
export { scheduleReconcile } from './reconciler';
export type { ReconcileResult, ScheduleReconcileArgs } from './reconciler';
export {
  fetchAllThreadRelations,
  MAX_THREAD_FETCH_EVENTS,
  MAX_THREAD_FETCH_ITERATIONS,
} from './threadRelationsFetcher';
export type { ThreadRelationPageResult } from './threadRelationsFetcher';
export { enqueueThreadBackfillJob } from './threadBackfillJob';
export { enqueueThreadApprovalBackfill } from './threadApprovalBackfill';
export type { EnqueueThreadBackfillArgs, ThreadBackfillResult } from './threadBackfillJob';
