import { type RefObject, useEffect, useId, useRef } from 'react';
import classNames from 'classnames';
import * as css from './InsetScrollbar.css';
import { blockSelection } from './dragSelection';

type InsetScrollbarProps = {
  scrollRef: RefObject<HTMLElement>;
  contentRef: RefObject<HTMLElement>;
  label: string;
  className: string;
  /** Composite widgets retain their own arrow-key focus order. */
  tabIndex?: 0 | -1;
  /** Runs before End reads the extent: a list that mounts a window of its rows shows its end. */
  beforeEnd?: () => void;
};

/** Keep native scrolling, with an indicator bounded by the unobscured viewport. */
export function InsetScrollbar({
  scrollRef,
  contentRef,
  label,
  className,
  tabIndex = 0,
  beforeEnd,
}: InsetScrollbarProps) {
  const id = useId();
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  // Read at the key: a change of it must not reinstall the listeners under a drag.
  const beforeEndRef = useRef(beforeEnd);
  beforeEndRef.current = beforeEnd;

  // Ancestor scroll refs are attached after child layout effects.
  useEffect(() => {
    const scroll = scrollRef.current;
    const content = contentRef.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!scroll || !content || !track || !thumb) return undefined;
    const previousId = scroll.id;
    scroll.id = previousId || id;
    track.setAttribute('aria-controls', scroll.id);
    let frame = 0;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let drag: { pointerId: number; grabOffset: number; unblock: () => void } | undefined;

    const geometry = () => {
      const height = track.clientHeight;
      const maximum = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
      const thumbHeight = Math.min(
        height,
        Math.max(24, (height * height) / (maximum + height || 1))
      );
      const travel = height - thumbHeight;
      const position = Math.max(0, Math.min(maximum, scroll.scrollTop));
      return { maximum, thumbHeight, travel, position };
    };
    const update = () => {
      frame = 0;
      const { maximum, thumbHeight, travel, position } = geometry();
      track.dataset.overflow = String(maximum > 0 && travel > 0);
      track.setAttribute('aria-valuemax', String(maximum));
      track.setAttribute('aria-valuenow', String(Math.round(position)));
      thumb.style.height = `${thumbHeight}px`;
      thumb.style.transform = `translateY(${maximum ? (position / maximum) * travel : 0}px)`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const reveal = () => {
      track.dataset.active = 'true';
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (!drag) track.dataset.active = 'false';
      }, 900);
    };
    const onScroll = () => {
      reveal();
      schedule();
    };
    const moveTo = (clientY: number, grabOffset: number) => {
      const { maximum, travel } = geometry();
      if (travel <= 0) return;
      scroll.scrollTop = Math.max(
        0,
        Math.min(
          maximum,
          ((clientY - track.getBoundingClientRect().top - grabOffset) / travel) * maximum
        )
      );
    };
    const onPointerDown = (event: PointerEvent) => {
      if (drag || !event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      if (tabIndex === 0) {
        // WebKit drops the page's selection when the track takes focus; it stays, as a drag's does,
        // but not a draft's: restoring that would pull the focus back into its editor.
        const sel = window.getSelection();
        const { anchorNode, anchorOffset, focusNode, focusOffset } = sel ?? ({} as Selection);
        const draft = [focusNode, focusNode?.parentElement].some(
          (node) => node instanceof HTMLElement && node.isContentEditable
        );
        track.focus({ preventScroll: true });
        if (sel?.rangeCount === 0 && anchorNode && focusNode && !draft) {
          sel.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
        }
      }
      const { thumbHeight } = geometry();
      const grabOffset =
        event.target === thumb
          ? event.clientY - thumb.getBoundingClientRect().top
          : thumbHeight / 2;
      track.setPointerCapture(event.pointerId);
      const unblock = blockSelection(() => {
        drag = undefined;
      });
      drag = { pointerId: event.pointerId, grabOffset, unblock };
      moveTo(event.clientY, grabOffset);
      reveal();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (drag?.pointerId === event.pointerId) moveTo(event.clientY, drag.grabOffset);
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (drag?.pointerId !== event.pointerId) return;
      drag.unblock();
      drag = undefined;
      if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
      reveal();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'End') beforeEndRef.current?.();
      const { maximum } = geometry();
      const page = track.clientHeight;
      const positions: Record<string, number> = {
        ArrowUp: scroll.scrollTop - 40,
        ArrowDown: scroll.scrollTop + 40,
        PageUp: scroll.scrollTop - page,
        PageDown: scroll.scrollTop + page,
        Home: 0,
        End: maximum,
      };
      const position = positions[event.key];
      if (position === undefined) return;
      event.preventDefault();
      scroll.scrollTop = position;
      reveal();
    };

    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    if (observer) [scroll, content, track].forEach((element) => observer.observe(element));
    scroll.addEventListener('scroll', onScroll, { passive: true });
    track.addEventListener('pointerdown', onPointerDown);
    track.addEventListener('pointermove', onPointerMove);
    track.addEventListener('pointerup', onPointerEnd);
    track.addEventListener('pointercancel', onPointerEnd);
    track.addEventListener('lostpointercapture', onPointerEnd);
    track.addEventListener('keydown', onKeyDown);
    update();
    return () => {
      drag?.unblock();
      observer?.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(hideTimer);
      scroll.removeEventListener('scroll', onScroll);
      track.removeEventListener('pointerdown', onPointerDown);
      track.removeEventListener('pointermove', onPointerMove);
      track.removeEventListener('pointerup', onPointerEnd);
      track.removeEventListener('pointercancel', onPointerEnd);
      track.removeEventListener('lostpointercapture', onPointerEnd);
      track.removeEventListener('keydown', onKeyDown);
      if (!previousId && scroll.id === id) scroll.removeAttribute('id');
    };
  }, [scrollRef, contentRef, id, tabIndex]);

  return (
    <div
      ref={trackRef}
      className={classNames(css.Track, className)}
      role="scrollbar"
      tabIndex={tabIndex}
      aria-label={label}
      aria-controls={id}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={0}
      aria-valuenow={0}
      data-overflow="false"
    >
      <div ref={thumbRef} className={css.Thumb} data-scrollbar-thumb="true" />
    </div>
  );
}
