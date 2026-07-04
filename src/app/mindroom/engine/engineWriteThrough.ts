/**
 * CINNY-207 P3.1: engine write-through layer (Commit 1 skeleton).
 *
 * Commit 3 (P3.1 close) will move the real Tier-1 persistence here
 * (compaction, redaction lifecycle, thread attribution, tailLoaded
 * semantics). For Commit 1 we only bump the `engineLiveWrites` probe
 * counter when the engine reports a live event — that gives us a
 * measurable signal in tests that the plumbing (listener attach + live
 * mode gate + dispatch to write-through) is intact end-to-end before
 * we start moving persistence code around.
 */

import { countCacheProbe } from '../threads/cacheProbe';
import type { EngineLiveEventHandler } from './types';

export type EngineWriteThrough = {
  handleLiveEvent: EngineLiveEventHandler;
  /**
   * Flush any pending compaction work. Commit 1 has none; commit 3
   * wires this to the moved edit-compaction scheduler so `stop()`
   * can drain before teardown.
   */
  flush(): void;
};

export const createEngineWriteThrough = (): EngineWriteThrough => {
  const handleLiveEvent: EngineLiveEventHandler = () => {
    countCacheProbe('engineLiveWrites');
  };

  const flush = () => {
    // Commit 1: no scheduler to flush. Commit 3 wires this up.
  };

  return { handleLiveEvent, flush };
};
