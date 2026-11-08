// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { afterEach, describe, expect, it } from 'vitest';
import { listNoticeSlotAtom, NoticeSlot, pageNoticeSlotAtom } from './noticeSlots';

const store = getDefaultStore();

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
