import { type ReactNode, type RefObject, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import FocusTrap from 'focus-trap-react';
import classNames from 'classnames';
import { config, type RectCords } from 'folds';
import { PopOut } from '../../ui/directional';
import { Header, Menu } from '../../ui/glass/GlassPrimitives';
import { PageScroll } from '../../ui/page/PageScroll';
import { glassDenseOverBackdrop } from '../../ui/styles/Glass.css';
import { useAlive } from '../../lib/hooks/useAlive';
import { preventScrollWithArrowKey, stopPropagation } from '../../lib/keyboard';
import {
  INVITE_AUTOCOMPLETE_MENU_OFFSET_PX,
  getInviteAutocompleteMenuMaxHeight,
  getInviteAutocompleteMenuPlacement,
} from './inviteAutocompleteMenuPlacement';
import * as css from './InviteAutocompleteMenu.css';

type InviteAutocompleteMenuProps = {
  /** Shows the list. The caller decides from the field's focus, its text and the matches. */
  open: boolean;
  /** The reader dismissed the open list: Escape, or a press outside the field and the list. */
  requestClose: () => void;
  /** The search field. It keeps the focus and all its keys while the list is open. */
  input: ReactNode;
  /** The list's sticky title, such as the number of matches. */
  headerContent: ReactNode;
  /** The listbox's id, which the field names in `aria-controls`. */
  menuId: string;
  /** The listbox's accessible name. */
  menuLabel: string;
  /** The option rows, as the caller renders them. */
  children: ReactNode;
};

type TrapOptions = NonNullable<FocusTrap.Props['focusTrapOptions']>;

/** Where the anchor box sat on screen, and the viewport height it was read against. */
type Measurement = { anchor: RectCords; viewportHeight: number };

const sameRect = (a: RectCords, b: RectCords): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * Reads the anchor box again. Whatever did not change keeps its object: a box that did not move
 * keeps the stored rectangle, and when the viewport kept its height too the stored measurement
 * itself comes back, so a scroll that moves nothing (inside the list, say) renders nothing.
 */
const remeasure = (box: Element, stored: Measurement | undefined): Measurement => {
  const { x, y, width, height } = box.getBoundingClientRect();
  const viewportHeight = document.documentElement.clientHeight;
  const unmoved = stored !== undefined && sameRect(stored.anchor, { x, y, width, height });
  if (unmoved && stored.viewportHeight === viewportHeight) return stored;
  return { anchor: unmoved ? stored.anchor : { x, y, width, height }, viewportHeight };
};

/**
 * Events after which the field may sit somewhere else: a scroll anywhere in the page (the
 * listeners capture, so they also hear scrolling containers such as the dialog), a window
 * resize, and the end of an animation or a transition. The last two catch a dialog that was
 * still sliding in when the list opened: the list lined up with the field mid-slide and would
 * otherwise stay a few pixels off until the next scroll.
 */
const FIELD_MOVES = ['scroll', 'resize', 'animationend', 'transitionend'] as const;

/**
 * Whether an animation or a transition is running on the box or an element around it, such as
 * the dialog sliding in. Without `document.getAnimations` (older engines, test documents) it
 * answers no, and the events of `FIELD_MOVES` still settle the list when the motion ends.
 */
const isMoving = (box: Element): boolean =>
  document.getAnimations?.().some((animation) => {
    const target = (animation.effect as KeyframeEffect | null)?.target;
    return animation.playState === 'running' && !!target?.contains(box);
  }) ?? false;

/**
 * Measures the anchor box while the list is open: once before the first paint, on every frame
 * while the box or an element around it moves (a list opened as the dialog slides in moves with
 * it, instead of snapping into place when the slide ends), and after each event of
 * `FIELD_MOVES`. Closing drops the measurement, so each opening starts afresh.
 */
const useOpenMeasurement = (
  open: boolean,
  anchorBoxRef: RefObject<HTMLElement>
): Measurement | undefined => {
  const [measurement, setMeasurement] = useState<Measurement>();

  useLayoutEffect(() => {
    if (!open) return undefined;
    const update = () => {
      const box = anchorBoxRef.current;
      if (box) setMeasurement((stored) => remeasure(box, stored));
    };
    let frame: number | undefined;
    const follow = () => {
      // Rendered before the frame paints, so the list does not trail the field by a frame.
      flushSync(update);
      const box = anchorBoxRef.current;
      frame = box && isMoving(box) ? requestAnimationFrame(follow) : undefined;
    };
    update();
    const box = anchorBoxRef.current;
    if (box && isMoving(box)) frame = requestAnimationFrame(follow);
    for (const type of FIELD_MOVES) window.addEventListener(type, update, true);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      for (const type of FIELD_MOVES) window.removeEventListener(type, update, true);
      setMeasurement(undefined);
    };
  }, [open, anchorBoxRef]);

  // Already gone in the render that closes the list, before the cleanup above runs.
  return open ? measurement : undefined;
};

/**
 * Options for a focus trap that only notices a dismissal. It moves no focus (none when it
 * activates, none back when it deactivates) and leaves Tab alone, so the field keeps every key.
 * It deactivates on Escape, unless something used the key already or an input method is
 * composing, and keeps that Escape from closing the dialog too. It also deactivates on a press
 * outside the field and the list, and lets that press reach its target.
 *
 * focus-trap-react reads its options once, so the handlers read the newest props through refs.
 * focus-trap reports each deactivation a macrotask after it happens, including the ones caused by
 * closing or unmounting the list. So each report is matched to the opening it ended, and only a
 * report for the opening still on screen asks to close. A report from a close the parent made
 * finds the list closed, or open again as a later opening, and does nothing.
 */
const useDismissTrapOptions = (
  open: boolean,
  requestClose: () => void,
  listRef: RefObject<HTMLElement>
): TrapOptions => {
  const alive = useAlive();
  const newestRequestClose = useRef(requestClose);
  // Numbers each opening; `shown` is the opening on screen, undefined while the list is closed.
  const openings = useRef(0);
  const shown = useRef<number>();
  // For each deactivation still to be reported, oldest first: the opening it ended.
  const unreported = useRef<Array<number | undefined>>([]);

  useLayoutEffect(() => {
    newestRequestClose.current = requestClose;
  }, [requestClose]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    openings.current += 1;
    shown.current = openings.current;
    return () => {
      shown.current = undefined;
    };
  }, [open]);

  return useMemo<TrapOptions>(
    () => ({
      initialFocus: false,
      returnFocusOnDeactivate: false,
      isKeyForward: () => false,
      isKeyBackward: () => false,
      escapeDeactivates: stopPropagation,
      allowOutsideClick: true,
      // The list is portaled out of the trap's element but belongs to it.
      clickOutsideDeactivates: (event) => !listRef.current?.contains(event.target as Node | null),
      onDeactivate: () => {
        unreported.current.push(shown.current);
      },
      onPostDeactivate: () => {
        // A report with no deactivation on record (a test calling this directly) is for the
        // opening on screen.
        const ended = unreported.current.length > 0 ? unreported.current.shift() : shown.current;
        if (ended === undefined || ended !== shown.current || !alive()) return;
        newestRequestClose.current();
      },
    }),
    [alive, listRef]
  );
};

/**
 * The floating list of people under the invite search field. It opens below the field, or above
 * it when only that side has room, as wide as the field and no taller than the room on that side,
 * and follows the field when the page scrolls or resizes and while the dialog around it moves.
 * The caller owns the rows, their order and the keyboard; this frame only reports when the reader
 * dismisses the list.
 */
export function InviteAutocompleteMenu({
  open,
  requestClose,
  input,
  headerContent,
  menuId,
  menuLabel,
  children,
}: InviteAutocompleteMenuProps) {
  const anchorBoxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const measurement = useOpenMeasurement(open, anchorBoxRef);
  const trapOptions = useDismissTrapOptions(open, requestClose, listRef);

  const placement = measurement
    ? getInviteAutocompleteMenuPlacement(measurement.anchor, measurement.viewportHeight)
    : 'Bottom';
  const list = measurement && (
    <div
      ref={listRef}
      className={css.InviteAutocompleteMenuContainer}
      style={{ width: measurement.anchor.width }}
    >
      <Menu
        id={menuId}
        role="listbox"
        aria-label={menuLabel}
        className={classNames(css.InviteAutocompleteMenu, glassDenseOverBackdrop)}
        style={{
          maxHeight: getInviteAutocompleteMenuMaxHeight(
            measurement.anchor,
            measurement.viewportHeight,
            placement
          ),
        }}
      >
        <PageScroll
          header={
            <Header size="400" className={css.InviteAutocompleteMenuHeader}>
              {headerContent}
            </Header>
          }
          scrollbarTabIndex={-1}
          onKeyDown={preventScrollWithArrowKey}
        >
          <div style={{ padding: config.space.S100 }}>{children}</div>
        </PageScroll>
      </Menu>
    </div>
  );

  return (
    <FocusTrap active={open} focusTrapOptions={trapOptions}>
      <div ref={anchorBoxRef} className={css.InviteAutocompleteMenuRoot}>
        {input}
        <PopOut
          anchor={measurement?.anchor}
          position={placement}
          align="Start"
          offset={INVITE_AUTOCOMPLETE_MENU_OFFSET_PX}
          className={css.InviteAutocompletePopOut}
          content={list}
        />
      </div>
    </FocusTrap>
  );
}
