import { useLayoutEffect, useRef } from 'react';
import { atom, useSetAtom } from 'jotai';
import { useInert } from '../lib/hooks/useInert';
import * as css from './noticeSlots.css';

// Places a floating notice (shell/NewVersionNotice.tsx) can be shown in, offered by the layout
// while it shows them. The notice takes the room list's while there is one, else the page's.

/** At the foot of the room list beside the page (ResizablePageNav); phones have none. */
export const listNoticeSlotAtom = atom<HTMLElement | null>(null);

/** At the top of the signed-in page, under a phone's top bar (ClientLayout). */
export const pageNoticeSlotAtom = atom<HTMLElement | null>(null);

const slotAtoms = { list: listNoticeSlotAtom, page: pageNoticeSlotAtom };

type NoticeSlotProps = {
  place: 'list' | 'page';
  /** Whether the page has the phone layout, which a notice shown here follows. */
  phone?: boolean;
  /** Whether something covers the place, as a phone's drawer does: its notice is inert then. */
  covered?: boolean;
};

/**
 * Offers a notice place while it is mounted and takes it back when it goes, unless another one
 * has taken over by then. Registered before paint, so a notice moving in never shows a frame in
 * its old place. A live region of its own, so a notice is announced when it appears here.
 */
export function NoticeSlot({ place, phone = false, covered = false }: NoticeSlotProps) {
  const setSlot = useSetAtom(slotAtoms[place]);
  const ref = useRef<HTMLDivElement>(null);
  useInert(ref, covered);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    setSlot(element);
    return () => setSlot((current) => (current === element ? null : current));
  }, [setSlot]);
  return (
    <div
      ref={ref}
      className={place === 'list' ? css.ListSlot : css.PageSlot({ phone })}
      data-phone={phone || undefined}
      aria-live="polite"
    />
  );
}
