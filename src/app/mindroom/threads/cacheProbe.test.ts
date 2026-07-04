import { beforeEach, describe, expect, it } from 'vitest';
import {
  countCacheProbe,
  getCacheProbeSnapshot,
  markCacheHydrateEnd,
  markCacheHydrateStart,
  recordRenderTargetSource,
  replaceFallbackInstanceRegistry,
  resetCacheProbe,
} from './cacheProbe';

// Test double for a MatrixEvent-shaped fallback instance whose
// `.replacingEvent()` return value can be mutated between calls, so we
// can drive the RG4d transitions (never-had, first-arm, lost) from tests.
type FakeFallbackInstance = {
  replacingEvent: () => unknown | null;
  setReplacement: (next: unknown | null) => void;
};
const makeFallbackInstance = (initial: unknown | null = null): FakeFallbackInstance => {
  let replacement: unknown | null = initial;
  return {
    replacingEvent: () => replacement,
    setReplacement: (next) => {
      replacement = next;
    },
  };
};

describe('cacheProbe', () => {
  beforeEach(() => {
    resetCacheProbe();
  });

  it('starts with all counters at zero', () => {
    const snapshot = getCacheProbeSnapshot();
    Object.values(snapshot).forEach((value) => expect(value).toBe(0));
  });

  it('increments counters by one and by amount', () => {
    countCacheProbe('threadSaveCalls');
    countCacheProbe('threadEventPuts', 42);
    countCacheProbe('writeErrors');
    countCacheProbe('writeErrors');

    const snapshot = getCacheProbeSnapshot();
    expect(snapshot.threadSaveCalls).toBe(1);
    expect(snapshot.threadEventPuts).toBe(42);
    expect(snapshot.writeErrors).toBe(2);
    expect(snapshot.roomSaveCalls).toBe(0);
  });

  it('returns an independent snapshot copy', () => {
    countCacheProbe('roomEventPuts', 3);
    const snapshot = getCacheProbeSnapshot();
    countCacheProbe('roomEventPuts', 4);

    expect(snapshot.roomEventPuts).toBe(3);
    expect(getCacheProbeSnapshot().roomEventPuts).toBe(7);
  });

  it('resets all counters', () => {
    countCacheProbe('roomMetaPuts', 5);
    resetCacheProbe();
    expect(getCacheProbeSnapshot().roomMetaPuts).toBe(0);
  });

  it('tolerates hydrate end without a start mark', () => {
    expect(() => markCacheHydrateEnd('room')).not.toThrow();
    markCacheHydrateStart('room');
    expect(() => markCacheHydrateEnd('room')).not.toThrow();
  });
});

// CINNY-207 AC2 render-gap RG4c/RG4d (2026-07-04): source-tag + instance-
// identity classifier and temporal lost-replacement detector for the
// render-pipeline seam. Verifies:
//  - RG4c invariant: `renderTargetLackedReplacement ==
//    renderTargetSourceNoFallback + renderTargetSourceFallbackAlsoLacked
//    + renderTargetSourceSdkFallbackAlsoLacked + renderTargetSourceSdkFallbackRepaired`
//    (the outer bump is done by the caller in utils/room.ts — the
//    classifier itself must sum to the number of lack-replacement calls
//    it received).
//  - RG4d invariant: `renderTargetSourceFallbackAlsoLacked ==
//    renderTargetFallbackNeverHadReplacement + renderTargetLostReplacement`.
//  - RG4d transitions: never-had, first-arm, lost-after-arm, latch reset
//    on identity swap via replaceFallbackInstanceRegistry.
describe('cacheProbe RG4c/RG4d classifier', () => {
  beforeEach(() => {
    resetCacheProbe();
  });

  it('classifies no-fallback when the id was never registered', () => {
    const someInstance = {};
    recordRenderTargetSource('$evt', someInstance);
    const snap = getCacheProbeSnapshot();
    expect(snap.renderTargetSourceNoFallback).toBe(1);
    expect(snap.renderTargetSourceFallbackAlsoLacked).toBe(0);
    expect(snap.renderTargetSourceSdkFallbackAlsoLacked).toBe(0);
    expect(snap.renderTargetSourceSdkFallbackRepaired).toBe(0);
    expect(snap.renderTargetFallbackNeverHadReplacement).toBe(0);
    expect(snap.renderTargetLostReplacement).toBe(0);
  });

  it('classifies fallback-also-lacked as never-had until a replacement is observed', () => {
    const fallback = makeFallbackInstance(null);
    replaceFallbackInstanceRegistry([['$evt', fallback]]);
    // Render is holding the fallback instance itself, replacement null,
    // latch never armed → never-had bucket.
    recordRenderTargetSource('$evt', fallback);
    recordRenderTargetSource('$evt', fallback);
    const snap = getCacheProbeSnapshot();
    expect(snap.renderTargetSourceFallbackAlsoLacked).toBe(2);
    expect(snap.renderTargetFallbackNeverHadReplacement).toBe(2);
    expect(snap.renderTargetLostReplacement).toBe(0);
  });

  it('detects lost-replacement after arming and clearing on the same instance', () => {
    const fallback = makeFallbackInstance(null);
    replaceFallbackInstanceRegistry([['$evt', fallback]]);
    // Pass 1: replacement is set on the fallback → arms latch. Since
    // .replacingEvent() is non-null, the outer caller in utils/room.ts
    // would not have called recordRenderTargetSource — but the applier-
    // side arming can happen via a call where the caller HAS observed
    // non-null (recordRenderTargetSource only bumps counters; it doesn't
    // require the caller's `.replacingEvent()` to be null). Simulate:
    fallback.setReplacement({ id: '$edit' });
    recordRenderTargetSource('$evt', fallback);
    // Pass 2: replacement cleared → same instance, latch armed → lost.
    fallback.setReplacement(null);
    recordRenderTargetSource('$evt', fallback);
    recordRenderTargetSource('$evt', fallback);
    const snap = getCacheProbeSnapshot();
    // Total also-lacked calls: 2 (passes 2 and 3). Pass 1 had non-null
    // replacement, so it goes into the contradiction fold (also-lacked,
    // classified as lost because latch armed intra-call). That's the
    // documented behavior — the invariant must still hold.
    expect(snap.renderTargetSourceFallbackAlsoLacked).toBe(3);
    expect(
      snap.renderTargetFallbackNeverHadReplacement + snap.renderTargetLostReplacement,
    ).toBe(snap.renderTargetSourceFallbackAlsoLacked);
    expect(snap.renderTargetLostReplacement).toBe(3);
    expect(snap.renderTargetFallbackNeverHadReplacement).toBe(0);
  });

  it('classifies SDK-repaired-fallback as fourth-shape when render holds a sibling', () => {
    const fallback = makeFallbackInstance({ id: '$edit' });
    const sdkSibling = {}; // different identity than fallback
    replaceFallbackInstanceRegistry([['$evt', fallback]]);
    recordRenderTargetSource('$evt', sdkSibling);
    const snap = getCacheProbeSnapshot();
    expect(snap.renderTargetSourceSdkFallbackRepaired).toBe(1);
    expect(snap.renderTargetSourceSdkFallbackAlsoLacked).toBe(0);
    expect(snap.renderTargetSourceFallbackAlsoLacked).toBe(0);
    expect(snap.renderTargetLostReplacement).toBe(0);
    expect(snap.renderTargetFallbackNeverHadReplacement).toBe(0);
  });

  it('classifies SDK-not-repaired-fallback when fallback also lacks replacement', () => {
    const fallback = makeFallbackInstance(null);
    const sdkSibling = {};
    replaceFallbackInstanceRegistry([['$evt', fallback]]);
    recordRenderTargetSource('$evt', sdkSibling);
    const snap = getCacheProbeSnapshot();
    expect(snap.renderTargetSourceSdkFallbackAlsoLacked).toBe(1);
    expect(snap.renderTargetSourceSdkFallbackRepaired).toBe(0);
    // The RG4d split only applies on the same-instance path, so a
    // sibling-holding render does NOT touch never-had or lost buckets.
    expect(snap.renderTargetFallbackNeverHadReplacement).toBe(0);
    expect(snap.renderTargetLostReplacement).toBe(0);
  });

  it('resets the latch when a fresh instance is registered for the same id', () => {
    // Realistic sequence: fallback initially null, some earlier merge
    // pass arms the latch (simulated by transiently setting replacement
    // to non-null and calling recordRenderTargetSource once). Then the
    // clear happens and subsequent lack-replacement calls classify as
    // lost. Then a fresh instance swaps in → latch reset.
    const fallbackA = makeFallbackInstance(null);
    replaceFallbackInstanceRegistry([['$evt', fallbackA]]);
    // Arm latch: the classifier will observe .replacingEvent() non-null
    // this call and record everHadReplacement=true. This call also
    // bumps also-lacked + lost per the contradiction fold rule (since
    // the outer caller in production would normally only reach here
    // with null; a non-null in the classifier means an inter-call
    // flip). One same-instance also-lacked call, latch armed intra-call
    // → the fold puts it in the `lost` bucket.
    fallbackA.setReplacement({ id: '$edit-A' });
    recordRenderTargetSource('$evt', fallbackA); // arm + fold as lost
    // Same instance re-registered → latch preserved.
    replaceFallbackInstanceRegistry([['$evt', fallbackA]]);
    fallbackA.setReplacement(null);
    recordRenderTargetSource('$evt', fallbackA); // classic lost
    expect(getCacheProbeSnapshot().renderTargetLostReplacement).toBe(2);

    // Different instance swapped in → latch reset for the new instance.
    const fallbackB = makeFallbackInstance(null);
    replaceFallbackInstanceRegistry([['$evt', fallbackB]]);
    recordRenderTargetSource('$evt', fallbackB); // never-had (fresh latch)
    const snap = getCacheProbeSnapshot();
    expect(snap.renderTargetLostReplacement).toBe(2);
    expect(snap.renderTargetFallbackNeverHadReplacement).toBe(1);
    // RG4d invariant still holds.
    expect(
      snap.renderTargetFallbackNeverHadReplacement + snap.renderTargetLostReplacement,
    ).toBe(snap.renderTargetSourceFallbackAlsoLacked);
  });

  it('drops the registry entry when a subsequent replace omits the id', () => {
    const fallback = makeFallbackInstance(null);
    replaceFallbackInstanceRegistry([['$evt', fallback]]);
    replaceFallbackInstanceRegistry([]);
    recordRenderTargetSource('$evt', fallback);
    // No registry entry → no-fallback bucket, not also-lacked.
    const snap = getCacheProbeSnapshot();
    expect(snap.renderTargetSourceNoFallback).toBe(1);
    expect(snap.renderTargetSourceFallbackAlsoLacked).toBe(0);
  });

  it('resetCacheProbe clears the fallback registry', () => {
    const fallback = makeFallbackInstance({ id: '$edit' });
    replaceFallbackInstanceRegistry([['$evt', fallback]]);
    resetCacheProbe();
    recordRenderTargetSource('$evt', fallback);
    // Post-reset, no registry entry.
    expect(getCacheProbeSnapshot().renderTargetSourceNoFallback).toBe(1);
    expect(getCacheProbeSnapshot().renderTargetSourceFallbackAlsoLacked).toBe(0);
  });
});
