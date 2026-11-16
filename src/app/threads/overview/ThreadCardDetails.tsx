import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Room } from 'matrix-js-sdk';
import type { RectCords } from 'folds';
import { useOptionalClientConfig } from '../../config/useClientConfig';
import { isConfirmedMatrixEventId } from '../../event-store/threads/threadRouteUtils';
import { useLatestRef } from '../../lib/hooks/useLatestRef';
import { registeredPlugins, type RegisteredPlugin } from '../../plugins/registry';
import { shownThreadDetails, type ShownThreadDetail } from '../../plugins/threadDetails';
import { PopOut } from '../../ui/directional';
import { Menu } from '../../ui/glass/GlassPrimitives';
import { ThreadDetailsList } from '../ThreadDetailsList';
import * as css from './ThreadCardDetails.css';

export const THREAD_CARD_DETAILS_DELAY_MS = 500;
export const HOVER_POINTER_QUERY = '(hover: hover) and (pointer: fine)';

type OpenDetails = {
  room: Room;
  threadId: string;
  details: ShownThreadDetail[];
  anchor: RectCords;
  position: 'Top' | 'Bottom';
};

/** A passive preview after a fine pointer rests on a confirmed Compact card. */
export function ThreadCardDetails({
  room,
  listRef,
  menuOpen,
  plugins = registeredPlugins,
}: {
  room: Room;
  listRef: RefObject<HTMLElement>;
  menuOpen: boolean;
  plugins?: readonly RegisteredPlugin[];
}) {
  const config = useOptionalClientConfig();
  const latest = useLatestRef({ room, plugins, config, menuOpen });
  const resetRef = useRef<() => void>();
  const [open, setOpen] = useState<OpenDetails>();

  useEffect(() => {
    const list = listRef.current;
    const doc = list?.ownerDocument;
    const win = doc?.defaultView;
    if (!list || !doc || !win) return undefined;
    let card: Element | undefined;
    let point = { x: 0, y: 0 };
    let timer: ReturnType<typeof setTimeout> | undefined;

    const close = () => {
      clearTimeout(timer);
      timer = undefined;
      setOpen(undefined);
    };
    const reset = () => {
      close();
      card = undefined;
    };
    resetRef.current = reset;
    const cardAt = (target: EventTarget | null | undefined) => {
      const found = target instanceof Element ? target.closest('[data-scroll-anchor]') : null;
      return found && list.contains(found) ? found : undefined;
    };
    const dismiss = (event: Event) => {
      close();
      card = cardAt(event.target);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || !globalThis.matchMedia?.(HOVER_POINTER_QUERY).matches)
        return;
      point = { x: event.clientX, y: event.clientY };
      const next = cardAt(event.target);
      // A dismissal or empty result keeps this card, so only leaving it arms another wait.
      if (next === card) return;
      reset();
      card = next;
      const threadId = card?.getAttribute('data-scroll-anchor');
      if (!threadId || !isConfirmedMatrixEventId(threadId)) return;
      timer = setTimeout(() => {
        timer = undefined;
        const current = latest.current;
        if (current.menuOpen) return;
        const details = shownThreadDetails(current.plugins, current.config, current.room, threadId);
        if (details.length === 0) return;
        setOpen({
          room: current.room,
          threadId,
          details,
          anchor: { ...point, width: 0, height: 0 },
          position: point.y > win.innerHeight / 2 ? 'Top' : 'Bottom',
        });
      }, THREAD_CARD_DETAILS_DELAY_MS);
    };
    const scroll = () => {
      // Compact list motion and scroll anchoring can scroll without changing the hovered card.
      if (card && cardAt(doc.elementFromPoint?.(point.x, point.y)) === card) return;
      close();
    };

    list.addEventListener('pointermove', move);
    list.addEventListener('pointerleave', reset);
    list.addEventListener('pointerdown', dismiss, true);
    list.addEventListener('click', dismiss, true);
    win.addEventListener('scroll', scroll, { capture: true, passive: true });
    return () => {
      clearTimeout(timer);
      resetRef.current = undefined;
      list.removeEventListener('pointermove', move);
      list.removeEventListener('pointerleave', reset);
      list.removeEventListener('pointerdown', dismiss, true);
      list.removeEventListener('click', dismiss, true);
      win.removeEventListener('scroll', scroll, true);
    };
  }, [listRef, latest]);

  useEffect(() => resetRef.current?.(), [room.roomId]);
  useEffect(() => {
    if (menuOpen) resetRef.current?.();
  }, [menuOpen]);

  if (!open) return null;
  return (
    <PopOut
      anchor={open.anchor}
      position={open.position}
      align="Start"
      offset={16}
      data-thread-card-details=""
      aria-hidden="true"
      style={{ pointerEvents: 'none' }}
      content={
        <Menu role="none" className={css.HoverCard}>
          <ThreadDetailsList room={open.room} threadId={open.threadId} details={open.details} />
        </Menu>
      }
    />
  );
}
