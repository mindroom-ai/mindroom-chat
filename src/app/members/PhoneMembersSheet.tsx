import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  PHONE_SLIDE_OUT_MS,
  phoneNavDrawerOpenAtom,
  phoneSheetOpenAtom,
  phoneSheetSlotAtom,
} from '../navigation/phoneNavDrawer';
import { useSwipeAway } from '../navigation/useSwipeAway';
import { useInert } from '../lib/hooks/useInert';
import { hasOpenOverlay } from '../lib/openOverlay';
import { usePanelPresence } from '../ui/panels/panelPresence';
import * as css from './PhoneMembersSheet.css';

/** The layer below a phone's top bar that the members slide into; null without the phone layout. */
export const usePhoneSheetSlot = (): HTMLElement | null => useAtomValue(phoneSheetSlotAtom);

/**
 * A phone's members: a sheet that slides in from the end edge below the top bar over a dimmed
 * page, as the navigation drawer does from the start edge: the page below is inert meanwhile, the
 * top bar stays usable. The scrim, Escape, a swipe toward the edge and the drawer coming out put
 * it away (a navigation does too: `useMembersDrawer`); it stays while it slides out (the panel
 * slot waits).
 */
export function PhoneMembersSheet({
  slot,
  onClose,
  children,
}: {
  slot: HTMLElement;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const presence = usePanelPresence();
  const leaving = presence?.phase === 'exit';
  // There from the room's first render, it is out at once; opened, it moves out on the next frame.
  const [open, setOpen] = useState(!presence || presence.phase === 'shown');
  const out = open && !leaving;
  const panelRef = useRef<HTMLDivElement>(null);
  const navDrawerOpen = useAtomValue(phoneNavDrawerOpenAtom);
  const setSheetOpen = useSetAtom(phoneSheetOpenAtom);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  const register = presence?.register;
  useLayoutEffect(() => register?.(), [register]);
  const done = presence?.done;
  useEffect(() => {
    if (leaving) {
      setOpen(false);
      const timer = window.setTimeout(() => done?.(), PHONE_SLIDE_OUT_MS);
      return () => window.clearTimeout(timer);
    }
    const frame = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(frame);
  }, [leaving, done]);

  // Out, the sheet makes the page below inert (`ClientLayout`) and edge swipes rest.
  useEffect(() => {
    setSheetOpen(out);
    return () => setSheetOpen(false);
  }, [out, setSheetOpen]);

  // While out, Escape puts it away before the page sees it, unless a menu or dialog is open (the
  // command palette over it, a menu inside it): that one closes.
  useEffect(() => {
    if (!out) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || hasOpenOverlay(panelRef.current)) return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [out]);

  // The drawer coming out over it puts the members away.
  useEffect(() => {
    if (navDrawerOpen) onClose();
  }, [navDrawerOpen, onClose]);

  useSwipeAway(panelRef, 'end', onClose);
  useInert(panelRef, leaving);

  // One layer for the focus (`overlayFocus`, the slot is a layer host): it takes the focus as a
  // dialog does and gives it back to its opener once it has gone.
  return createPortal(
    <div className={css.Layer}>
      <div
        className={css.Scrim}
        data-open={out || undefined}
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className={css.Panel}
        data-open={out || undefined}
        data-testid="phone-members-sheet"
        role="dialog"
        aria-label={t('mindroomUi.threads.mindroomRoomViewHeader.members')}
      >
        {children}
      </div>
    </div>,
    slot
  );
}
