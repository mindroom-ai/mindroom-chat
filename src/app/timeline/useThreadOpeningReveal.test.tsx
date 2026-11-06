// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THREAD_REVEAL_AFTER_MS, useThreadOpeningReveal } from './useThreadOpeningReveal';

type Geometry = { scrollHeight: number; clientHeight: number; scrollTop: number };

/** A scroll area whose geometry the test sets. */
const scrollArea = (geometry: Geometry) => geometry as unknown as HTMLElement;

type Props = {
  viewKey?: string;
  opensAtLatest?: boolean;
  rowCount?: number;
  geometry: Geometry;
  tookOver?: boolean;
};

const shown: { hidden?: boolean } = {};

function Harness({
  viewKey = '!room|$thread',
  opensAtLatest = true,
  rowCount = 21,
  geometry,
  tookOver = false,
}: Props) {
  shown.hidden = useThreadOpeningReveal({
    viewKey,
    opensAtLatest,
    rowCount,
    scrollRef: { current: scrollArea(geometry) },
    readerTookOver: () => tookOver,
  });
  return null;
}

const AT_TOP = { scrollHeight: 2400, clientHeight: 800, scrollTop: 0 };
const AT_END = { scrollHeight: 2400, clientHeight: 800, scrollTop: 1600 };

describe('useThreadOpeningReveal', () => {
  let renderer: ReactTestRenderer | undefined;
  const render = (props: Props) =>
    act(() => {
      if (renderer) renderer.update(<Harness {...props} />);
      else renderer = create(<Harness {...props} />);
    });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    vi.useRealTimers();
  });

  it('hides the rows of a thread opening at its newest reply until they rest at the end', () => {
    render({ geometry: AT_TOP });
    expect(shown.hidden).toBe(true);

    render({ geometry: AT_END });
    expect(shown.hidden).toBe(false);

    // Shown once, the rows stay shown, wherever the reader goes.
    render({ geometry: AT_TOP });
    expect(shown.hidden).toBe(false);
  });

  it('shows the rows of a thread opened at a target event at once', () => {
    render({ geometry: AT_TOP, opensAtLatest: false });
    expect(shown.hidden).toBe(false);
  });

  it('keeps an empty list hidden at the end, and shows a short thread that fits', () => {
    render({ geometry: { scrollHeight: 800, clientHeight: 800, scrollTop: 0 }, rowCount: 0 });
    expect(shown.hidden).toBe(true);
    render({ geometry: { scrollHeight: 800, clientHeight: 800, scrollTop: 0 }, rowCount: 2 });
    expect(shown.hidden).toBe(false);
  });

  it('shows the rows when the reader takes over, or after a while', () => {
    render({ geometry: AT_TOP });
    render({ geometry: AT_TOP, tookOver: true });
    expect(shown.hidden).toBe(false);

    render({ geometry: AT_TOP, viewKey: '!room|$other' });
    expect(shown.hidden).toBe(true);
    act(() => {
      vi.advanceTimersByTime(THREAD_REVEAL_AFTER_MS);
    });
    expect(shown.hidden).toBe(false);
  });
});
