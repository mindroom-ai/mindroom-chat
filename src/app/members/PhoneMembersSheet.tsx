import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  PHONE_SLIDE_OUT_MS,
  phoneNavDrawerOpenAtom,
  phoneSheetOpenAtom,
  phoneSheetSlotAtom,
} from '../navigation/phoneNavDrawer';
import {
  type InteractiveSwipeScene,
  SWIPE_PRIORITY,
  animateSwipeElements,
} from '../navigation/interactiveSwipe';
import { useSwipeAway } from '../navigation/useSwipeAway';
import { useInert } from '../lib/hooks/useInert';
import { hasOpenOverlay } from '../lib/openOverlay';
import { markOverlayDismissed } from '../lib/overlayFocus';
import { usePanelPresence } from '../ui/panels/panelPresence';
import { NoticeSlot } from '../ui/noticeSlots';
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
  const scrimRef = useRef<HTMLDivElement>(null);
  const swipedDismissRef = useRef(false);
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
      if (swipedDismissRef.current) {
        swipedDismissRef.current = false;
        done?.();
        return undefined;
      }
      const timer = window.setTimeout(() => done?.(), PHONE_SLIDE_OUT_MS);
      return () => window.clearTimeout(timer);
    }
    swipedDismissRef.current = false;
    const frame = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(frame);
  }, [leaving, done]);

  // Out, the sheet makes the page below inert (`ClientLayout`) and edge swipes rest.
  useEffect(() => {
    if (out) swipedDismissRef.current = false;
    setSheetOpen(out);
    return () => setSheetOpen(false);
  }, [out, setSheetOpen]);

  // While out, Escape puts it away before the page sees it, unless a menu or dialog is open (the
  // command palette over it, a menu inside it): that one closes.
  useEffect(() => {
    if (!out) return undefined;
    // If the sheet came back before its exit finished, forget the previous dismissal.
    markOverlayDismissed(panelRef.current, false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || hasOpenOverlay(panelRef.current)) return;
      event.preventDefault();
      event.stopPropagation();
      markOverlayDismissed(panelRef.current);
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [out]);

  // The drawer coming out over it puts the members away.
  useEffect(() => {
    if (navDrawerOpen) onClose();
  }, [navDrawerOpen, onClose]);

  const dismiss = useCallback(() => {
    markOverlayDismissed(panelRef.current);
    onCloseRef.current();
  }, []);
  const beginCloseSwipe = useCallback(
    ({ dirSign }: { axisSign: 1 | -1; dirSign: 1 | -1 }): InteractiveSwipeScene | null => {
      const panel = panelRef.current;
      const scrim = scrimRef.current;
      if (!panel || !scrim) return null;

      const extent = panel.getBoundingClientRect().width;
      if (extent <= 0) return null;

      panel.dataset.swiping = '';
      scrim.dataset.swiping = '';

      let cleaned = false;

      const clearSwipeStyles = () => {
        if (cleaned) return;
        cleaned = true;
        panel.style.translate = '';
        scrim.style.opacity = '';
        void panel.offsetWidth;
        delete panel.dataset.swiping;
        delete scrim.dataset.swiping;
      };

      return {
        extent,
        update(offsetPx, progress) {
          panel.style.translate = `${offsetPx * dirSign}px 0`;
          scrim.style.opacity = String(1 - progress);
        },
        settle(commit, durationMs, currentOffsetPx) {
          const startProgress = currentOffsetPx / extent;
          return animateSwipeElements(
            [
              {
                element: panel,
                keyframes: [
                  { translate: `${currentOffsetPx * dirSign}px 0` },
                  { translate: `${(commit ? extent : 0) * dirSign}px 0` },
                ],
              },
              {
                element: scrim,
                keyframes: [
                  { opacity: String(1 - startProgress) },
                  { opacity: commit ? '0' : '1' },
                ],
              },
            ],
            durationMs
          );
        },
        commit() {
          swipedDismissRef.current = true;
          flushSync(() => dismiss());
          clearSwipeStyles();
        },
        cleanup() {
          clearSwipeStyles();
        },
      };
    },
    [dismiss]
  );
  useSwipeAway(panelRef, 'end', dismiss, {
    enabled: out,
    priority: SWIPE_PRIORITY.SHEET,
    begin: beginCloseSwipe,
  });
  useInert(panelRef, leaving);

  // One layer for the focus (`overlayFocus`, the slot is a layer host): it takes the focus as a
  // dialog does and gives it back to its opener once it has gone.
  return createPortal(
    <div className={css.Layer}>
      <div
        ref={scrimRef}
        className={css.Scrim}
        data-open={out || undefined}
        aria-hidden="true"
        onClick={dismiss}
      />
      <div
        ref={panelRef}
        className={css.Panel}
        data-open={out || undefined}
        data-testid="phone-members-sheet"
        role="dialog"
        aria-label={t('mindroomUi.threads.mindroomRoomViewHeader.members')}
      >
        {/* Out, the sheet covers the page's notice place: what must stay in reach shows here. */}
        {out && <NoticeSlot place="sheet" />}
        <div className={css.Members}>{children}</div>
      </div>
    </div>,
    slot
  );
}
