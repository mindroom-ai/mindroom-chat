import { ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { buttonsThatFit, nextPinned, revealDistance } from './railPin';
import * as css from './RailScrollArea.css';

/**
 * Scrolls the rail (the box marked `data-rail-scroller`, which scrolls the spaces in the current
 * layout) the least distance that shows `entry` whole and clear of the fade at the
 * scroller's edges; nothing happens outside the rail's scrolling part.
 */
export const revealRailEntry = (entry: Element): void => {
  const scroller = entry.closest<HTMLElement>('[data-rail-scroller]');
  if (!scroller) return;
  const margin = parseFloat(getComputedStyle(scroller).scrollPaddingTop) || 0;
  const distance = revealDistance(
    scroller.getBoundingClientRect(),
    entry.getBoundingClientRect(),
    margin
  );
  if (distance !== 0) scroller.scrollTop += distance;
};

/** Says, on `area`, whether `scroller` has more to show above and below what it shows. */
const markOverflow = (area: HTMLElement, scroller: HTMLElement) => {
  const { scrollTop, clientHeight, scrollHeight } = scroller;
  area.toggleAttribute('data-more-above', scrollTop > 0.5);
  area.toggleAttribute('data-more-below', scrollTop + clientHeight < scrollHeight - 0.5);
};

/**
 * How many space buttons would show whole below the top group, pinned, with the spaces scrolled
 * to their start: the first button below the top group (a space, or Explore without spaces)
 * gives where they start and their size, and the top group's stack their spacing.
 */
const spaceButtonsBelow = (
  area: HTMLElement,
  top: HTMLElement,
  content: HTMLElement
): number | undefined => {
  // The button's entry: pressing scales the button itself.
  const first = content.querySelector('button')?.parentElement;
  const stack = top.firstElementChild;
  if (!first || !stack) return undefined;
  const inset = first.getBoundingClientRect().top - content.getBoundingClientRect().top;
  return buttonsThatFit(
    area.clientHeight - top.offsetHeight,
    first.offsetHeight,
    parseFloat(getComputedStyle(stack).rowGap) || 0,
    inset
  );
};

type RailScrollAreaProps = {
  /** The top group, one stack: pinned above the rest while enough of the rest fits below it. */
  top: ReactNode;
  /** The spaces, then Explore and Create Space; they always scroll. */
  children: ReactNode;
};

/**
 * The rail above its foot group. While at least four space buttons fit below the top group, the
 * top group stays put and only the spaces scroll; with less room the whole part scrolls as one
 * column, and it pins again once five fit. Switching keeps every space where it was on screen,
 * apart from the ones the top group comes to cover; the selected one is then scrolled back into
 * view.
 */
export function RailScrollArea({ top, children }: RailScrollAreaProps) {
  const areaRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const restRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const pinnedRef = useRef(pinned);
  // The scroll offset of the layout being left, for the one taking over.
  const carriedOffset = useRef<number>();

  useLayoutEffect(() => {
    const area = areaRef.current;
    const topBox = topRef.current;
    const rest = restRef.current;
    const content = contentRef.current;
    if (!area || !topBox || !rest || !content || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const scroller = () => (pinnedRef.current ? rest : area);
    const showOverflow = () => markOverflow(area, scroller());
    const measure = () => {
      const fit = spaceButtonsBelow(area, topBox, content);
      if (fit !== undefined) {
        const next = nextPinned(pinnedRef.current, fit);
        if (next !== pinnedRef.current) {
          carriedOffset.current = scroller().scrollTop;
          pinnedRef.current = next;
          setPinned(next);
        }
      }
      showOverflow();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    observer.observe(topBox);
    observer.observe(content);
    area.addEventListener('scroll', showOverflow, { passive: true });
    rest.addEventListener('scroll', showOverflow, { passive: true });
    return () => {
      observer.disconnect();
      area.removeEventListener('scroll', showOverflow);
      rest.removeEventListener('scroll', showOverflow);
    };
  }, []);

  useLayoutEffect(() => {
    const offset = carriedOffset.current;
    const area = areaRef.current;
    const rest = restRef.current;
    if (offset === undefined || !area || !rest) return;
    carriedOffset.current = undefined;
    // The two layouts place every space at the same height for the same offset.
    const [taking, leaving] = pinned ? [rest, area] : [area, rest];
    leaving.scrollTop = 0;
    taking.scrollTop = offset;
    // Pinning covers the spaces that were where the top group now stays: bring the selected one
    // back if it was among them.
    const selected = pinned ? rest.querySelector('[data-active]') : null;
    if (selected && selected.getBoundingClientRect().top < rest.getBoundingClientRect().top) {
      revealRailEntry(selected);
    }
    markOverflow(area, taking);
  }, [pinned]);

  return (
    <div
      ref={areaRef}
      className={css.RailScrollArea}
      data-pinned={pinned || undefined}
      data-rail-scroller={pinned ? undefined : ''}
    >
      <div ref={topRef} className={css.RailScrollTop}>
        {top}
      </div>
      <div
        ref={restRef}
        className={css.RailScrollRest}
        data-rail-scroller={pinned ? '' : undefined}
      >
        <div ref={contentRef}>{children}</div>
      </div>
    </div>
  );
}
