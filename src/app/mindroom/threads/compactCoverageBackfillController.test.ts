import React from 'react';
import type { Room } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import {
  COMPACT_COVERAGE_MAX_BATCHES,
  COMPACT_COVERAGE_TARGET_EVENTS,
  shouldRunCompactCoverageBackfill,
  useCompactCoverageBackfillController,
} from './compactCoverageBackfillController';

type HarnessProps = {
  enabled: boolean;
  loadedEventCount: number;
  canPaginateBack: boolean;
  hasMoreCachedBack: boolean;
  paginateBack: (backwards: boolean) => Promise<void>;
  room: Room;
  coverageEpoch?: number;
};

const CoverageHarness = (props: HarnessProps) => {
  useCompactCoverageBackfillController(props);
  return null;
};

const makeRoom = (roomId = '!room:example.org'): Room => ({ roomId } as unknown as Room);

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('shouldRunCompactCoverageBackfill', () => {
  it('runs only when enabled, below target, within budget, with a source', () => {
    const base = {
      enabled: true,
      loadedEventCount: 0,
      canPaginateBack: true,
      hasMoreCachedBack: false,
      batchesUsed: 0,
    };
    expect(shouldRunCompactCoverageBackfill(base)).toBe(true);
    expect(shouldRunCompactCoverageBackfill({ ...base, enabled: false })).toBe(false);
    expect(
      shouldRunCompactCoverageBackfill({
        ...base,
        loadedEventCount: COMPACT_COVERAGE_TARGET_EVENTS,
      })
    ).toBe(false);
    expect(
      shouldRunCompactCoverageBackfill({ ...base, batchesUsed: COMPACT_COVERAGE_MAX_BATCHES })
    ).toBe(false);
    expect(
      shouldRunCompactCoverageBackfill({ ...base, canPaginateBack: false })
    ).toBe(false);
    expect(
      shouldRunCompactCoverageBackfill({
        ...base,
        canPaginateBack: false,
        hasMoreCachedBack: true,
      })
    ).toBe(true);
  });
});

describe('useCompactCoverageBackfillController', () => {
  it('paginates back when the compact view is enabled and coverage is shallow', async () => {
    const paginateBack = vi.fn().mockImplementation(() => new Promise<void>(() => {
          // never settles — pins the in-flight state
        }));

    await act(async () => {
      create(
        React.createElement(CoverageHarness, {
          enabled: true,
          loadedEventCount: 10,
          canPaginateBack: true,
          hasMoreCachedBack: false,
          paginateBack,
          room: makeRoom(),
        })
      );
    });

    expect(paginateBack).toHaveBeenCalledWith(true);
    expect(paginateBack).toHaveBeenCalledTimes(1);
  });

  it('does not paginate when disabled or when coverage is already satisfied', async () => {
    const paginateBack = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      create(
        React.createElement(CoverageHarness, {
          enabled: false,
          loadedEventCount: 10,
          canPaginateBack: true,
          hasMoreCachedBack: false,
          paginateBack,
          room: makeRoom(),
        })
      );
    });
    await act(async () => {
      create(
        React.createElement(CoverageHarness, {
          enabled: true,
          loadedEventCount: COMPACT_COVERAGE_TARGET_EVENTS,
          canPaginateBack: true,
          hasMoreCachedBack: false,
          paginateBack,
          room: makeRoom(),
        })
      );
    });

    expect(paginateBack).not.toHaveBeenCalled();
  });

  it('keeps batching after a settled page even when inputs are unchanged', async () => {
    let resolveBatch: (() => void) | undefined;
    const paginateBack = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveBatch = resolve;
        })
    );

    await act(async () => {
      create(
        React.createElement(CoverageHarness, {
          enabled: true,
          loadedEventCount: 10,
          canPaginateBack: true,
          hasMoreCachedBack: false,
          paginateBack,
          room: makeRoom(),
        })
      );
    });
    expect(paginateBack).toHaveBeenCalledTimes(1);

    // A page of fully-filtered events changes no reactive input; the settle
    // tick alone must drive the next batch.
    await act(async () => {
      resolveBatch?.();
    });
    await flush();

    expect(paginateBack).toHaveBeenCalledTimes(2);
  });

  it('does not start a second batch while one is in flight', async () => {
    const paginateBack = vi.fn().mockImplementation(() => new Promise<void>(() => {
          // never settles — pins the in-flight state
        }));
    let renderer: ReturnType<typeof create> | undefined;
    const room = makeRoom();

    await act(async () => {
      renderer = create(
        React.createElement(CoverageHarness, {
          enabled: true,
          loadedEventCount: 10,
          canPaginateBack: true,
          hasMoreCachedBack: false,
          paginateBack,
          room,
        })
      );
    });
    await act(async () => {
      renderer?.update(
        React.createElement(CoverageHarness, {
          enabled: true,
          loadedEventCount: 30,
          canPaginateBack: true,
          hasMoreCachedBack: false,
          paginateBack,
          room,
        })
      );
    });

    expect(paginateBack).toHaveBeenCalledTimes(1);
  });

  it('stops at the per-mount batch budget', async () => {
    const paginateBack = vi.fn().mockResolvedValue(undefined);
    const room = makeRoom();

    await act(async () => {
      create(
        React.createElement(CoverageHarness, {
          enabled: true,
          loadedEventCount: 10,
          canPaginateBack: true,
          hasMoreCachedBack: false,
          paginateBack,
          room,
        })
      );
    });
    for (let i = 0; i < COMPACT_COVERAGE_MAX_BATCHES * 2; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await flush();
    }

    expect(paginateBack).toHaveBeenCalledTimes(COMPACT_COVERAGE_MAX_BATCHES);
  });

  it('stops once coverage reaches the target', async () => {
    let resolveBatch: (() => void) | undefined;
    const paginateBack = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveBatch = resolve;
        })
    );
    const room = makeRoom();
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(CoverageHarness, {
          enabled: true,
          loadedEventCount: 10,
          canPaginateBack: true,
          hasMoreCachedBack: false,
          paginateBack,
          room,
        })
      );
    });
    expect(paginateBack).toHaveBeenCalledTimes(1);

    // The batch lands enough events to satisfy coverage, THEN settles.
    await act(async () => {
      renderer?.update(
        React.createElement(CoverageHarness, {
          enabled: true,
          loadedEventCount: COMPACT_COVERAGE_TARGET_EVENTS,
          canPaginateBack: true,
          hasMoreCachedBack: false,
          paginateBack,
          room,
        })
      );
    });
    await act(async () => {
      resolveBatch?.();
    });
    await flush();

    expect(paginateBack).toHaveBeenCalledTimes(1);
  });

  it('refreshes the batch budget when the coverage epoch bumps', async () => {
    const paginateBack = vi.fn().mockResolvedValue(undefined);
    const room = makeRoom();
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(CoverageHarness, {
          enabled: true,
          loadedEventCount: 10,
          canPaginateBack: true,
          hasMoreCachedBack: false,
          paginateBack,
          room,
          coverageEpoch: 0,
        })
      );
    });
    for (let i = 0; i < COMPACT_COVERAGE_MAX_BATCHES * 2; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await flush();
    }
    expect(paginateBack).toHaveBeenCalledTimes(COMPACT_COVERAGE_MAX_BATCHES);

    // Gappy-sync relink installs a shallow chain and bumps the epoch: the
    // spent budget must not block restoring depth after the gap.
    await act(async () => {
      renderer?.update(
        React.createElement(CoverageHarness, {
          enabled: true,
          loadedEventCount: 10,
          canPaginateBack: true,
          hasMoreCachedBack: false,
          paginateBack,
          room,
          coverageEpoch: 1,
        })
      );
    });
    await flush();

    expect(paginateBack.mock.calls.length).toBeGreaterThan(COMPACT_COVERAGE_MAX_BATCHES);
  });

  it('refreshes the batch budget when the room changes', async () => {
    const paginateBack = vi.fn().mockResolvedValue(undefined);
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(CoverageHarness, {
          enabled: true,
          loadedEventCount: 10,
          canPaginateBack: true,
          hasMoreCachedBack: false,
          paginateBack,
          room: makeRoom('!a:example.org'),
        })
      );
    });
    for (let i = 0; i < COMPACT_COVERAGE_MAX_BATCHES * 2; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await flush();
    }
    expect(paginateBack).toHaveBeenCalledTimes(COMPACT_COVERAGE_MAX_BATCHES);

    await act(async () => {
      renderer?.update(
        React.createElement(CoverageHarness, {
          enabled: true,
          loadedEventCount: 10,
          canPaginateBack: true,
          hasMoreCachedBack: false,
          paginateBack,
          room: makeRoom('!b:example.org'),
        })
      );
    });
    await flush();

    expect(paginateBack.mock.calls.length).toBeGreaterThan(COMPACT_COVERAGE_MAX_BATCHES);
  });

  it('swallows pagination errors and continues within budget', async () => {
    const paginateBack = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(undefined);

    await act(async () => {
      create(
        React.createElement(CoverageHarness, {
          enabled: true,
          loadedEventCount: 10,
          canPaginateBack: true,
          hasMoreCachedBack: false,
          paginateBack,
          room: makeRoom(),
        })
      );
    });
    await flush();

    expect(paginateBack.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
