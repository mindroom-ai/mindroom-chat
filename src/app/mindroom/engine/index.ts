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
export type { EngineWriteThrough } from './engineWriteThrough';
export { createEngineGapTracker } from './engineGapTracker';
export type { EngineGapTracker } from './engineGapTracker';
export type {
  EngineLifecycle,
  EngineLiveEventHandler,
  EngineLiveEventMeta,
  MindroomSyncEngine,
} from './types';
