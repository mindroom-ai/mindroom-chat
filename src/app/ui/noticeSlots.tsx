import { type AnimationEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import { useInert } from '../lib/hooks/useInert';
import * as css from './noticeSlots.css';

// Places a floating notice can be shown in, offered by the layout while it shows them. The new
// version notice (shell/NewVersionNotice.tsx) and the tour's offer (tour/TourOffer.tsx) take the
// room list's while there is one, else the page's (useNoticePresence); how the connection is
// (shell/SyncStatus.tsx) always shows in the page's.

/** At the foot of the room list beside the page (ResizablePageNav); phones have none. */
export const listNoticeSlotAtom = atom<HTMLElement | null>(null);

/** At the top of the signed-in page, under a phone's top bar (ClientLayout). */
export const pageNoticeSlotAtom = atom<HTMLElement | null>(null);

const slotAtoms = { list: listNoticeSlotAtom, page: pageNoticeSlotAtom };

/** How long a notice takes to leave: the Normal motion token (ui/noticeMotion.css.ts) and a frame. */
export const NOTICE_LEAVE_MS = 180;

/** The kind of place a notice card is in: the room list's or the page's. */
export type NoticePlacement = 'list' | 'page';

type NoticeSlotProps = {
  place: NoticePlacement;
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

/**
 * The layer that can cover a phone's page, the drawer or a sheet: whether it is out
 * (`phoneLayerOpenAtom`) and how long it takes to slide away (`PHONE_SLIDE_OUT_MS`). Both belong
 * to navigation/phoneNavDrawer.ts, in a layer above this one, so the caller hands them in.
 */
type PhoneLayer = { open: boolean; slideOutMs: number };

type NoticePresence = {
  /** Whether to render the card: come in, and due or still leaving. */
  shown: boolean;
  /** The place to portal the card into; null while the layout offers none. */
  slot: HTMLElement | null;
  placement: NoticePlacement;
  /** Dismissed and on its way out: the card's `data-leaving`. */
  leaving: boolean;
  /** Already come in where it is placed: the card's `data-settled`. */
  settled: boolean;
  /** Plays the card out from where it is; for the card's own controls. */
  dismiss: () => void;
  /** The card's `onAnimationEnd`, which notes that it has come in. */
  onAnimationEnd: (event: AnimationEvent<HTMLElement>) => void;
};

/**
 * Where a notice card shows and how it comes and goes (ui/noticeMotion.css.ts), for a notice that
 * has something to say while `due`. It takes the room list's place while there is one, else the
 * page's. It comes in once: held back while a phone's drawer or sheet covers its place, and shown
 * at once when it is rebuilt in another place of the same kind. Due no longer, it is hidden at
 * once; dismissed, it plays its way out from where it was, whatever `due` says meanwhile, and
 * stays away.
 */
export const useNoticePresence = (due: boolean, phoneLayer: PhoneLayer): NoticePresence => {
  const listSlot = useAtomValue(listNoticeSlotAtom);
  const pageSlot = useAtomValue(pageNoticeSlotAtom);
  const [gone, setGone] = useState(false);
  // Dismissed, the card leaves from where it was, even if the list closes meanwhile.
  const [leftFrom, setLeftFrom] = useState<{
    slot: HTMLElement | null;
    placement: NoticePlacement;
  }>();
  const leaving = leftFrom !== undefined;
  const slot = leftFrom ? leftFrom.slot : listSlot ?? pageSlot;
  const placement: NoticePlacement = leftFrom?.placement ?? (listSlot ? 'list' : 'page');
  // The card comes in once where it is placed: rebuilt in a new place of the same kind (the list
  // of another section), it shows at once instead of arriving again.
  const cameInAt = useRef<NoticePlacement>();
  const settled = cameInAt.current === placement;
  // A phone's drawer or members sheet covers the page's place and makes it inert, where an
  // assistive technology would not read the card out. Due meanwhile, the card waits until they
  // have slid away, so the place is a live region again before the card is added to it, and then
  // stays (under them, inert, should they come back).
  const covered = phoneLayer.open && !listSlot && pageSlot?.hasAttribute('data-phone') === true;
  const wanted = due && !gone;
  const [cameIn, setCameIn] = useState(false);
  const [heldBack, setHeldBack] = useState(false);
  if (wanted && !cameIn && !heldBack) {
    if (covered) setHeldBack(true);
    else setCameIn(true);
  }
  const { slideOutMs } = phoneLayer;
  useEffect(() => {
    // Only a card that is still wanted: one that stopped being due while it waited would
    // otherwise show at once, covered or not, when it is due again.
    if (!wanted || !heldBack || covered || cameIn) return undefined;
    const timer = window.setTimeout(() => setCameIn(true), slideOutMs);
    return () => window.clearTimeout(timer);
  }, [wanted, heldBack, covered, cameIn, slideOutMs]);

  useEffect(() => {
    if (!leaving) return undefined;
    const timer = window.setTimeout(() => {
      setGone(true);
      // Gone for good: let go of the place it left from.
      setLeftFrom(undefined);
    }, NOTICE_LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  return {
    shown: cameIn && !gone && (due || leaving),
    slot,
    placement,
    leaving,
    settled,
    dismiss: () => setLeftFrom({ slot, placement }),
    onAnimationEnd: (event) => {
      if (event.target === event.currentTarget && !leaving) cameInAt.current = placement;
    },
  };
};
