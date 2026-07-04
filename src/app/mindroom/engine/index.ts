/**
 * CINNY-207 P3.1: MindroomSyncEngine barrel.
 *
 * Consumers should import from here so future internal reshuffles
 * don't ripple across the codebase.
 */

export { createMindroomSyncEngine } from './mindroomSyncEngine';
export type { CreateMindroomSyncEngineOptions } from './mindroomSyncEngine';
export {
  MindroomSyncEngineProvider,
  useMindroomSyncEngine,
  useMindroomSyncEngineOptional,
} from './engineContext';
export type { MindroomSyncEngineProviderProps } from './engineContext';
export { createEngineWriteThrough } from './engineWriteThrough';
export type { EngineWriteThrough, EngineWriteThroughOptions } from './engineWriteThrough';
export {
  createEngineGapTracker,
  createInMemoryGapFillScheduler,
} from './engineGapTracker';
export type {
  EngineGapTracker,
  EngineGapTrackerOptions,
  GapFillJob,
  GapFillReason,
  GapFillScheduler,
} from './engineGapTracker';
export type {
  EngineLifecycle,
  EngineLiveEventHandler,
  EngineLiveEventMeta,
  MindroomSyncEngine,
} from './types';
export { createEnginePersistFacade } from './enginePersistFacade';
export type {
  EnginePersistFacade,
  PersistRoomEventCache,
  PersistThreadEventCache,
  PersistThreadCacheFromRoomEvents,
  QueueRoomThreadCachePersist,
} from './enginePersistFacade';
