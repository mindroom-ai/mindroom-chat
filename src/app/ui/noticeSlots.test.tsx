// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { getDefaultStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  listNoticeSlotAtom,
  NOTICE_LEAVE_MS,
  NoticeSlot,
  pageNoticeSlotAtom,
  useNoticePresence,
} from './noticeSlots';

const store = getDefaultStore();

/** A notice card of the smallest kind: it shows in the place it is given and can be dismissed. */
function Card({
  name,
  due = true,
  layerOpen = false,
}: {
  name: string;
  due?: boolean;
  layerOpen?: boolean;
}) {
  const { shown, slot, placement, leaving, dismiss } = useNoticePresence(due, {
    open: layerOpen,
    slideOutMs: 320,
  });
  if (!shown || !slot) return null;
  return createPortal(
    <div data-card={name} data-placement={placement} data-leaving={leaving || undefined}>
      <button type="button" onClick={dismiss}>
        Dismiss {name}
      </button>
    </div>,
    slot
  );
}

const cardsIn = (place: HTMLElement | null) =>
  Array.from(place?.children ?? [], (card) => card.getAttribute('data-card'));

describe('NoticeSlot', () => {
  afterEach(() => {
    cleanup();
    store.set(listNoticeSlotAtom, null);
    store.set(pageNoticeSlotAtom, null);
  });

  it('offers its place while mounted, as a live region, and takes it back when it goes', () => {
    const { container, unmount } = render(<NoticeSlot place="list" />);
    const element = container.firstElementChild;

    expect(store.get(listNoticeSlotAtom)).toBe(element);
    expect(element?.getAttribute('aria-live')).toBe('polite');
    expect(store.get(pageNoticeSlotAtom)).toBeNull();

    unmount();
    expect(store.get(listNoticeSlotAtom)).toBeNull();
  });

  it('leaves the place to a newer slot that took it over', () => {
    const first = render(<NoticeSlot place="page" />);
    const second = render(<NoticeSlot place="page" phone />);
    const newer = second.container.firstElementChild;
    expect(store.get(pageNoticeSlotAtom)).toBe(newer);
    expect(newer?.hasAttribute('data-phone')).toBe(true);

    first.unmount();
    expect(store.get(pageNoticeSlotAtom)).toBe(newer);
  });

  it('makes its notice inert while something covers it', () => {
    const { container, rerender } = render(<NoticeSlot place="page" phone covered />);
    const element = container.firstElementChild as HTMLElement;
    expect(element.inert).toBe(true);

    rerender(<NoticeSlot place="page" phone covered={false} />);
    expect(element.inert).toBe(false);
  });
});

describe('useNoticePresence', () => {
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    store.set(listNoticeSlotAtom, null);
    store.set(pageNoticeSlotAtom, null);
  });

  it("shows two cards in the room list's place, and none in the page's meanwhile", () => {
    render(
      <>
        <NoticeSlot place="list" />
        <NoticeSlot place="page" />
        <Card name="first" />
        <Card name="second" />
      </>
    );

    expect(cardsIn(store.get(listNoticeSlotAtom))).toEqual(['first', 'second']);
    expect(cardsIn(store.get(pageNoticeSlotAtom))).toEqual([]);
    expect(store.get(listNoticeSlotAtom)?.querySelectorAll('[data-placement="list"]')).toHaveLength(
      2
    );
  });

  it('plays a dismissed card out though it is due no longer, and keeps it away after', () => {
    vi.useFakeTimers();
    const ui = (due: boolean) => (
      <>
        <NoticeSlot place="page" />
        <Card name="only" due={due} />
      </>
    );
    const { rerender } = render(ui(true));
    const page = store.get(pageNoticeSlotAtom);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss only' }));
    rerender(ui(false));
    expect(page?.querySelector('[data-card="only"][data-leaving]')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(NOTICE_LEAVE_MS);
    });
    expect(cardsIn(page)).toEqual([]);
    rerender(ui(true));
    expect(cardsIn(page)).toEqual([]);
  });

  it('hides a card at once when it is due no longer, and shows it again when it is', () => {
    const ui = (due: boolean) => (
      <>
        <NoticeSlot place="page" />
        <Card name="only" due={due} />
      </>
    );
    const { rerender } = render(ui(true));
    const page = store.get(pageNoticeSlotAtom);
    expect(cardsIn(page)).toEqual(['only']);

    rerender(ui(false));
    expect(cardsIn(page)).toEqual([]);
    rerender(ui(true));
    expect(cardsIn(page)).toEqual(['only']);
  });

  it("holds a card back under a phone's drawer, also one that stopped being due meanwhile", () => {
    vi.useFakeTimers();
    const ui = (due: boolean, layerOpen: boolean) => (
      <>
        <NoticeSlot place="page" phone covered={layerOpen} />
        <Card name="only" due={due} layerOpen={layerOpen} />
      </>
    );
    const slide = () =>
      act(() => {
        vi.advanceTimersByTime(320);
      });
    // The place is offered first, as the layout offers it before a notice is due.
    const { rerender } = render(ui(false, true));
    const page = store.get(pageNoticeSlotAtom);
    rerender(ui(true, true));
    expect(cardsIn(page)).toEqual([]);

    // Due no longer when the drawer closes: it does not count as come in.
    rerender(ui(false, true));
    rerender(ui(false, false));
    slide();
    // Due again under the drawer, it waits for the drawer to slide away, as the first time.
    rerender(ui(true, true));
    slide();
    expect(cardsIn(page)).toEqual([]);
    rerender(ui(true, false));
    expect(cardsIn(page)).toEqual([]);
    slide();
    expect(cardsIn(page)).toEqual(['only']);
  });
});
