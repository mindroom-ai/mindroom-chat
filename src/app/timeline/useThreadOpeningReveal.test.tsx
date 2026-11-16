// @vitest-environment jsdom
import { MatrixEvent } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THREAD_REVEAL_AFTER_MS, useThreadOpeningReveal } from './useThreadOpeningReveal';

type Geometry = {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
  /** The virtual list's mounted rows, by index. */
  mounted?: number[];
};

/** A scroll area whose geometry and mounted rows the test sets. */
const scrollArea = ({ mounted = [20], ...geometry }: Geometry) =>
  ({
    ...geometry,
    querySelector: (selector: string) =>
      mounted.some((index) => selector === `[data-index="${index}"]`) ? {} : null,
  } as unknown as HTMLElement);

const message = (index: number) =>
  new MatrixEvent({ event_id: `$${index}`, type: 'm.room.message', content: { body: `${index}` } });
const edit = (index: number) =>
  new MatrixEvent({
    event_id: `$edit${index}`,
    type: 'm.room.message',
    content: { body: '* edited', 'm.relates_to': { rel_type: 'm.replace', event_id: '$1' } },
  });
const messages = (count: number) => Array.from({ length: count }, (_, index) => message(index));

type Props = {
  viewKey?: string;
  opensAtLatest?: boolean;
  rows?: MatrixEvent[];
  geometry: Geometry;
  tookOver?: boolean;
};

const shown: { hidden?: boolean } = {};

function Harness({
  viewKey = '!room|$thread',
  opensAtLatest = true,
  rows = messages(21),
  geometry,
  tookOver = false,
}: Props) {
  shown.hidden = useThreadOpeningReveal({
    viewKey,
    opensAtLatest,
    rows,
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

    // At the end of the range while the list still holds the rows of the top.
    render({ geometry: { ...AT_END, mounted: [0, 1, 2] } });
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
    render({ geometry: { scrollHeight: 800, clientHeight: 800, scrollTop: 0 }, rows: [] });
    expect(shown.hidden).toBe(true);
    render({
      geometry: { scrollHeight: 800, clientHeight: 800, scrollTop: 0, mounted: [0, 1] },
      rows: messages(2),
    });
    expect(shown.hidden).toBe(false);
  });

  it('shows the rows at the end of a thread whose last rows are edits, which have no tiles', () => {
    // Streamed replies leave their edits at the end of the list; once they measure to no height
    // they have no tile, so the last tile is the last message's.
    const rows = [...messages(21), edit(21), edit(22), edit(23)];
    render({ geometry: { ...AT_END, mounted: [0, 1, 2] }, rows });
    expect(shown.hidden).toBe(true);

    render({ geometry: { ...AT_END, mounted: [18, 19, 20] }, rows });
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
