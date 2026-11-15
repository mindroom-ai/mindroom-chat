// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockMedia, restoreMedia } from './__tests__/media';
import { SCENE_START_DELAY_MS, type TourStep } from './tourSteps';
import { TYPING_INTERVAL_MS, useScenePhase, useTypedLength } from './useScenePhase';

const THREE: TourStep = { id: 'reply', chapter: 'basics', phases: [1000, 500, 0] };
const TWO: TourStep = { id: 'title', chapter: 'basics', phases: [300, 0] };
const ONE: TourStep = { id: 'states', chapter: 'basics', phases: [0] };

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

/** Plays the three-phase step to its end: each phase's timer starts once the one before fired. */
const playThree = () => {
  advance(SCENE_START_DELAY_MS + 1000);
  advance(500);
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  restoreMedia();
});

describe('useScenePhase', () => {
  it('waits the start delay, then goes through the phases and stays in the last', () => {
    const { result } = renderHook(() => useScenePhase(THREE));
    expect(result.current).toMatchObject({ phase: 0, settled: false });

    advance(SCENE_START_DELAY_MS + 999);
    expect(result.current.phase).toBe(0);
    advance(1);
    expect(result.current).toMatchObject({ phase: 1, settled: false });
    advance(499);
    expect(result.current.phase).toBe(1);
    advance(1);
    expect(result.current).toMatchObject({ phase: 2, settled: true });
    advance(60_000);
    expect(result.current).toMatchObject({ phase: 2, settled: true });
  });

  it('is settled from the start for a scene of one phase', () => {
    const { result } = renderHook(() => useScenePhase(ONE));
    expect(result.current).toMatchObject({ phase: 0, settled: true });
  });

  it('starts over when the step changes, in the same render', () => {
    const { result, rerender } = renderHook(({ step }) => useScenePhase(step), {
      initialProps: { step: THREE },
    });
    playThree();
    expect(result.current.phase).toBe(2);

    const phases: number[] = [];
    const { rerender: rerenderSeen } = renderHook(
      ({ step }) => {
        const { phase } = useScenePhase(step);
        phases.push(phase);
        return phase;
      },
      { initialProps: { step: THREE } }
    );
    playThree();
    expect(phases.at(-1)).toBe(2);
    phases.length = 0;
    rerenderSeen({ step: TWO });
    // No render of the new step shows the old step's phase.
    expect(phases.every((phase) => phase === 0)).toBe(true);

    rerender({ step: TWO });
    expect(result.current).toMatchObject({ phase: 0, settled: false });
    // The old step's timers are gone: the new one takes its own delay and length.
    advance(SCENE_START_DELAY_MS + 299);
    expect(result.current.phase).toBe(0);
    advance(1);
    expect(result.current).toMatchObject({ phase: 1, settled: true });
  });

  it('starts over on Replay', () => {
    const { result } = renderHook(() => useScenePhase(TWO));
    advance(SCENE_START_DELAY_MS + 300);
    expect(result.current.settled).toBe(true);

    act(() => result.current.replay());
    expect(result.current).toMatchObject({ phase: 0, settled: false });
    advance(SCENE_START_DELAY_MS + 300);
    expect(result.current).toMatchObject({ phase: 1, settled: true });
  });

  it('shows the last phase at once with reduced motion, also after a step change', () => {
    mockMedia({ reducedMotion: true });
    const { result, rerender } = renderHook(({ step }) => useScenePhase(step), {
      initialProps: { step: THREE },
    });
    expect(result.current).toMatchObject({ phase: 2, settled: true });
    rerender({ step: TWO });
    expect(result.current).toMatchObject({ phase: 1, settled: true });
    act(() => result.current.replay());
    expect(result.current).toMatchObject({ phase: 1, settled: true });
  });
});

describe('useTypedLength', () => {
  it('holds the whole text until typing starts, then grows by one at a time', () => {
    const { result, rerender } = renderHook(({ typing }) => useTypedLength(5, typing), {
      initialProps: { typing: false },
    });
    expect(result.current).toBe(5);

    rerender({ typing: true });
    expect(result.current).toBe(0);
    advance(TYPING_INTERVAL_MS);
    expect(result.current).toBe(1);
    advance(TYPING_INTERVAL_MS * 2);
    expect(result.current).toBe(3);
    advance(TYPING_INTERVAL_MS * 10);
    expect(result.current).toBe(5);

    rerender({ typing: false });
    expect(result.current).toBe(5);
    // Typing again starts from nothing.
    rerender({ typing: true });
    expect(result.current).toBe(0);
  });
});
