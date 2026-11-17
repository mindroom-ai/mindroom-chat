// @vitest-environment jsdom
import { MatrixEvent } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THREAD_REVEAL_AFTER_MS, useThreadOpeningReveal } from './useThreadOpeningReveal';

type Geometry = {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
  /** The virtual list's mounted rows, by index, first to last. */
  mounted?: number[];
  /** The first mounted row's top, from the top of the view: above it unless the test says. */
  firstTop?: number;
};

/** Where the hook scrolled the scroll areas of a test, in order. */
const scrolledTo: number[] = [];

/** A scroll area whose geometry and mounted rows the test sets; its scrolls go to `scrolledTo`. */
const scrollArea = ({ mounted = [18, 19, 20], firstTop = -40, ...geometry }: Geometry) => {
  const tile = (index: number) => ({
    getAttribute: () => String(index),
    getBoundingClientRect: () => ({ top: 100 + firstTop }),
  });
  const area = {
    ...geometry,
    getBoundingClientRect: () => ({ top: 100 }),
    scrollTo: ({ top }: { top: number }) => {
      scrolledTo.push(top);
      area.scrollTop = top;
    },
    querySelector: (selector: string) => {
      const [first] = mounted;
      if (selector === '[data-index]') return first === undefined ? null : tile(first);
      const index = mounted.find((candidate) => selector === `[data-index="${candidate}"]`);
      return index === undefined ? null : tile(index);
    },
  };
  return area as unknown as HTMLElement;
};

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
  measured?: boolean;
};

const shown: { hidden?: boolean } = {};

function Harness({
  viewKey = '!room|$thread',
  opensAtLatest = true,
  rows = messages(21),
  geometry,
  tookOver = false,
  measured = true,
}: Props) {
  shown.hidden = useThreadOpeningReveal({
    viewKey,
    opensAtLatest,
    rows,
    scrollRef: { current: scrollArea(geometry) },
    readerTookOver: () => tookOver,
    rowsAtMeasuredSizes: () => measured,
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
    scrolledTo.length = 0;
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    vi.useRealTimers();
  });

  it('hides the rows of a thread opening at its newest reply until they rest at the end', () => {
    // At the end of the range while the list still holds the rows of the top.
    render({ geometry: { ...AT_END, mounted: [0, 1, 2] } });
    expect(shown.hidden).toBe(true);

    render({ geometry: AT_END });
    expect(shown.hidden).toBe(false);

    // Shown once, the rows stay shown, wherever the reader goes, and nothing scrolls them back.
    render({ geometry: AT_TOP });
    expect(shown.hidden).toBe(false);
    expect(scrolledTo).toEqual([]);
  });

  it('leaves the hidden rows at the end of the range after a commit moved it', () => {
    // The rows measured in this commit made the list longer: the view is no longer at its end.
    render({ geometry: { ...AT_END, scrollHeight: 2600, mounted: [0, 1, 2] } });
    expect(scrolledTo).toEqual([1800]);
    expect(shown.hidden).toBe(true);

    // Put there, a commit that holds the last rows shows them.
    render({ geometry: { scrollHeight: 2600, clientHeight: 800, scrollTop: 1800 } });
    expect(scrolledTo).toEqual([1800]);
    expect(shown.hidden).toBe(false);
  });

  it('leaves the position to a reader who took it over, and shows the rows', () => {
    render({ geometry: { ...AT_END, mounted: [0, 1, 2] } });
    render({ geometry: AT_TOP, tookOver: true });
    expect(scrolledTo).toEqual([]);
    expect(shown.hidden).toBe(false);
  });

  it('keeps the rows hidden while the top of the view has no row', () => {
    // The rows measured shorter than estimated: the first mounted one starts below the view's top.
    render({ geometry: { ...AT_END, mounted: [14, 20], firstTop: 60 } });
    expect(shown.hidden).toBe(true);

    render({ geometry: { ...AT_END, mounted: [9, 20], firstTop: -30 } });
    expect(shown.hidden).toBe(false);
  });

  it('shows a thread whose first row is mounted, however far below the top of the view', () => {
    render({
      geometry: {
        scrollHeight: 800,
        clientHeight: 800,
        scrollTop: 0,
        mounted: [0, 1],
        firstTop: 200,
      },
      rows: messages(2),
    });
    expect(shown.hidden).toBe(false);
  });

  it('keeps the rows hidden until a commit shows them at their measured sizes', () => {
    render({ geometry: AT_END, measured: false });
    expect(shown.hidden).toBe(true);

    render({ geometry: AT_END });
    expect(shown.hidden).toBe(false);
  });

  it('shows the rows of a thread opened at a target event at once, where it opened', () => {
    render({ geometry: AT_TOP, opensAtLatest: false });
    expect(shown.hidden).toBe(false);
    expect(scrolledTo).toEqual([]);
  });

  it('keeps an empty list hidden at the end', () => {
    render({
      geometry: { scrollHeight: 800, clientHeight: 800, scrollTop: 0, mounted: [] },
      rows: [],
    });
    expect(shown.hidden).toBe(true);
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

  it('shows the rows after a while, whatever holds them back', () => {
    render({ geometry: { ...AT_END, mounted: [0, 1, 2] } });
    expect(shown.hidden).toBe(true);
    act(() => {
      vi.advanceTimersByTime(THREAD_REVEAL_AFTER_MS);
    });
    expect(shown.hidden).toBe(false);

    // Another thread starts hidden again.
    render({ geometry: { ...AT_END, mounted: [0, 1, 2] }, viewKey: '!room|$other' });
    expect(shown.hidden).toBe(true);
  });
});
