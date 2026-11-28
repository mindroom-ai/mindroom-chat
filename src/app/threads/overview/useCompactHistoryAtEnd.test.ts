// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COMPACT_HISTORY_PAGES_PER_APPROACH,
  isNearCardsEnd,
  useCompactHistoryAtEnd,
} from './useCompactHistoryAtEnd';

/** A host with a compact view 500 px high over `height` px of cards, scrolled to `top`. */
const mountView = (height: number, top: number) => {
  const host = document.createElement('div');
  const view = document.createElement('div');
  view.setAttribute('data-compact-room-view', 'true');
  host.append(view);
  document.body.append(host);
  Object.defineProperty(view, 'clientHeight', { configurable: true, value: 500 });
  Object.defineProperty(view, 'scrollHeight', { configurable: true, value: height });
  view.scrollTop = top;
  return { host, view };
};

const settle = async () => {
  await act(async () => {
    for (let frame = 0; frame < 10; frame += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
    }
  });
};

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe('isNearCardsEnd', () => {
  it('is in reach within one screen of the end, or when the cards fit', () => {
    expect(isNearCardsEnd({ scrollTop: 0, scrollHeight: 400, clientHeight: 500 })).toBe(true);
    expect(isNearCardsEnd({ scrollTop: 1_000, scrollHeight: 2_000, clientHeight: 500 })).toBe(true);
    expect(isNearCardsEnd({ scrollTop: 900, scrollHeight: 2_000, clientHeight: 500 })).toBe(false);
  });
});

describe('useCompactHistoryAtEnd', () => {
  const render = (
    host: HTMLElement,
    options: { canPaginateBack?: boolean; paginateBack: () => Promise<void> }
  ) =>
    renderHook(() =>
      useCompactHistoryAtEnd({
        enabled: true,
        roomId: '!room:example.org',
        hostRef: { current: host },
        canPaginateBack: options.canPaginateBack ?? true,
        hasMoreCachedBack: false,
        paginateBack: options.paginateBack,
      })
    );

  it('loads a few older pages when the reader scrolls toward the end, then waits', async () => {
    const { host, view } = mountView(2_000, 900);
    const paginateBack = vi.fn(async () => undefined);
    render(host, { paginateBack });

    // Mounting and a scroll away from the end load nothing.
    view.scrollTop = 800;
    view.dispatchEvent(new Event('scroll'));
    await settle();
    expect(paginateBack).not.toHaveBeenCalled();

    // Near the end, pages load while the end stays in reach, a few per approach.
    view.scrollTop = 1_500;
    view.dispatchEvent(new Event('scroll'));
    await settle();
    expect(paginateBack).toHaveBeenCalledTimes(COMPACT_HISTORY_PAGES_PER_APPROACH);
    expect(paginateBack).toHaveBeenCalledWith(true);

    // The reader moves on at the end: a wheel turn down asks for more.
    view.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
    await settle();
    expect(paginateBack).toHaveBeenCalledTimes(2 * COMPACT_HISTORY_PAGES_PER_APPROACH);
  });

  it('loads nothing while cards are still to mount below the view', async () => {
    const { host, view } = mountView(2_000, 1_500);
    view.setAttribute('data-cards-pending', 'true');
    const paginateBack = vi.fn(async () => undefined);
    render(host, { paginateBack });

    view.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
    await settle();
    expect(paginateBack).not.toHaveBeenCalled();

    // Once they have mounted, the reader moving on at the end loads older pages.
    view.removeAttribute('data-cards-pending');
    view.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
    await settle();
    expect(paginateBack).toHaveBeenCalled();
  });

  it('pages on after a page whose new cards are still to be measured', async () => {
    const { host, view } = mountView(2_000, 1_500);
    // Each page brings cards the list has not measured: it is pending for a few frames.
    const paginateBack = vi.fn(async () => {
      view.setAttribute('data-cards-pending', 'true');
      setTimeout(() => view.removeAttribute('data-cards-pending'), 60);
    });
    render(host, { paginateBack });

    view.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
    await settle();
    await settle();
    expect(paginateBack).toHaveBeenCalledTimes(COMPACT_HISTORY_PAGES_PER_APPROACH);
  });

  it('loads nothing once the room has no older history', async () => {
    const { host, view } = mountView(600, 100);
    const paginateBack = vi.fn(async () => undefined);
    render(host, { canPaginateBack: false, paginateBack });

    view.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
    await settle();
    expect(paginateBack).not.toHaveBeenCalled();
  });

  it('asks for one page at a time', async () => {
    const { host, view } = mountView(600, 100);
    let finish!: () => void;
    const paginateBack = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    render(host, { paginateBack });

    view.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
    view.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
    await settle();
    expect(paginateBack).toHaveBeenCalledTimes(1);
    finish();
    await settle();
    expect(paginateBack).toHaveBeenCalledTimes(2);
  });

  it('checks the targeted column body instead of the non-scrolling outer view in Columns mode', async () => {
    // Outer view has overflowY: hidden (scrollHeight === clientHeight), which would always look "at end".
    const { host, view } = mountView(500, 0);
    const board = document.createElement('div');
    board.setAttribute('data-compact-columns-board', 'true');
    const header = document.createElement('button');
    header.setAttribute('data-compact-column-header', 'needsYou');
    const body = document.createElement('div');
    body.setAttribute('data-compact-column-body', 'needsYou');
    Object.defineProperty(body, 'clientHeight', { configurable: true, value: 500 });
    Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 2_000 });
    body.scrollTop = 0;
    const card = document.createElement('div');
    body.append(card);
    board.append(header, body);
    view.append(board);

    const paginateBack = vi.fn(async () => undefined);
    render(host, { paginateBack });

    // Wheeling on the board header or at the top of a column body must NOT paginate.
    header.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 }));
    card.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 }));
    body.scrollTop = 100;
    body.dispatchEvent(new Event('scroll'));
    await settle();
    expect(paginateBack).not.toHaveBeenCalled();

    // Scrolling up even near the bottom must NOT paginate.
    body.scrollTop = 1_600;
    body.dispatchEvent(new Event('scroll'));
    await settle();
    expect(paginateBack).toHaveBeenCalledTimes(COMPACT_HISTORY_PAGES_PER_APPROACH);

    paginateBack.mockClear();
    body.scrollTop = 1_550;
    body.dispatchEvent(new Event('scroll'));
    await settle();
    expect(paginateBack).not.toHaveBeenCalled();

    // Wheeling down at the bottom of the column body DOES paginate.
    card.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 }));
    await settle();
    expect(paginateBack).toHaveBeenCalledTimes(COMPACT_HISTORY_PAGES_PER_APPROACH);

    // Swapping [data-compact-room-view] (Columns -> Vertical) inside host keeps listeners working,
    // while wheeling on a sibling outside [data-compact-room-view] (filter bar) is ignored.
    paginateBack.mockClear();
    const filterBar = document.createElement('div');
    const verticalView = document.createElement('div');
    verticalView.setAttribute('data-compact-room-view', 'true');
    Object.defineProperty(verticalView, 'clientHeight', { configurable: true, value: 500 });
    Object.defineProperty(verticalView, 'scrollHeight', { configurable: true, value: 2_000 });
    verticalView.scrollTop = 1_500;
    host.replaceChildren(filterBar, verticalView);

    filterBar.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 }));
    await settle();
    expect(paginateBack).not.toHaveBeenCalled();

    verticalView.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 }));
    await settle();
    expect(paginateBack).toHaveBeenCalledTimes(COMPACT_HISTORY_PAGES_PER_APPROACH);
  });
});
