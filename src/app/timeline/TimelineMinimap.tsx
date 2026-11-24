// Ported from the timeline minimap of T3 Code (https://github.com/pingdotgg/t3code,
// apps/web/src/components/chat/TimelineMinimap.tsx), Copyright (c) 2026 T3 Tools Inc.,
// MIT License. The license text is in licenses/T3-Code-MIT.txt; NOTICE lists the port.
import { useTranslation } from 'react-i18next';
import {
  MouseEvent,
  PointerEvent,
  RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { blockSelection } from '../ui/dragSelection';
import {
  TIMELINE_MINIMAP_MIN_ITEMS,
  TimelineMinimapItem,
  resolveTimelineMinimapHeightStyle,
  resolveTimelineMinimapIndexFromPointer,
  resolveTimelineMinimapTopPercent,
} from './timelineMinimapViewModel';
import * as css from './TimelineMinimap.css';

const resolveStripClass = (distance: number | null): string => {
  if (distance === 0) return css.MinimapStrip.Active;
  if (distance === 1) return css.MinimapStrip.Close;
  if (distance === 2) return css.MinimapStrip.Near;
  return css.MinimapStrip.Rest;
};

/**
 * Keeps each stripe's `data-in-view` flag in sync with the scroll viewport
 * without re-rendering: stripes register DOM nodes in `stripMap` and this
 * hook mutates their dataset on scroll frames.
 */
export const useTimelineMinimapInView = (
  scrollRef: RefObject<HTMLElement | null>,
  items: readonly TimelineMinimapItem[],
  stripMap: Map<string, HTMLSpanElement>,
  enabled: boolean
): void => {
  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!enabled || !scrollElement || items.length < TIMELINE_MINIMAP_MIN_ITEMS) return undefined;

    const itemIds = new Set(items.map((item) => item.id));
    let frame = 0;
    const update = () => {
      frame = 0;
      const containerRect = scrollElement.getBoundingClientRect();
      // Single DOM pass per frame: anchor each stripe at its message's top
      // edge and extend its range down to the next stripe's anchor, so
      // scrolling through a tall agent reply still highlights the question
      // that reply belongs to.
      const anchors: { id: string; top: number }[] = [];
      scrollElement.querySelectorAll<HTMLElement>('[data-message-id]').forEach((element) => {
        const messageId = element.getAttribute('data-message-id');
        if (messageId && itemIds.has(messageId)) {
          anchors.push({ id: messageId, top: element.getBoundingClientRect().top });
        }
      });
      anchors.sort((a, b) => a.top - b.top);
      const inViewIds = new Set<string>();
      anchors.forEach((anchor, index) => {
        const rangeEnd =
          index + 1 < anchors.length ? anchors[index + 1]!.top : Number.POSITIVE_INFINITY;
        if (rangeEnd > containerRect.top && anchor.top < containerRect.bottom) {
          inViewIds.add(anchor.id);
        }
      });
      items.forEach((item) => {
        const strip = stripMap.get(item.id);
        if (!strip) return;
        const next = inViewIds.has(item.id) ? 'true' : 'false';
        if (strip.dataset.inView !== next) strip.dataset.inView = next;
      });
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };

    schedule();
    scrollElement.addEventListener('scroll', schedule, { passive: true });
    // Layout can shift without a scroll event (window resize, collapsibles
    // expanding, media loading), so track container and content size too.
    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(schedule);
      resizeObserver.observe(scrollElement);
      if (scrollElement.firstElementChild) resizeObserver.observe(scrollElement.firstElementChild);
    }
    return () => {
      scrollElement.removeEventListener('scroll', schedule);
      resizeObserver?.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [scrollRef, items, stripMap, enabled]);
};

type TimelineMinimapProps = {
  items: readonly TimelineMinimapItem[];
  stripMap: Map<string, HTMLSpanElement>;
  scrollRef?: RefObject<HTMLElement | null>;
  onSelect: (item: TimelineMinimapItem) => void;
  onScrub?: (item: TimelineMinimapItem) => void;
};

export function TimelineMinimap({
  items,
  stripMap,
  scrollRef,
  onSelect,
  onScrub,
}: TimelineMinimapProps) {
  const { t } = useTranslation();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const railRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{ pointerId: number; lastItemId: string; unblock: () => void } | null>(
    null
  );

  const endDrag = useCallback((rail: HTMLButtonElement | null, nextActiveIndex?: number | null) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    drag.unblock();
    try {
      if (rail?.hasPointerCapture?.(drag.pointerId)) {
        rail.releasePointerCapture(drag.pointerId);
      }
    } catch {
      // Ignore environments where capture was already released.
    }
    if (nextActiveIndex !== undefined) {
      setActiveIndex(nextActiveIndex);
    }
  }, []);

  const shouldHide = items.length < TIMELINE_MINIMAP_MIN_ITEMS;
  useEffect(() => {
    if (!shouldHide) return;
    endDrag(null, null);
  }, [shouldHide, endDrag]);

  useEffect(
    () => () => {
      dragRef.current?.unblock();
      dragRef.current = null;
    },
    []
  );

  useEffect(() => {
    const rail = railRef.current;
    if (shouldHide || !rail || !scrollRef) return undefined;

    const handleWheel = (event: WheelEvent) => {
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.deltaY === 0 ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ) {
        return;
      }
      const scrollElement = scrollRef.current;
      if (!scrollElement) return;
      let { deltaY } = event;
      if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
        deltaY *= 16;
      } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
        deltaY *= scrollElement.clientHeight;
      }
      if (deltaY === 0) return;
      event.preventDefault();
      scrollElement.scrollTop += deltaY;
    };

    rail.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      rail.removeEventListener('wheel', handleWheel);
    };
  }, [scrollRef, shouldHide]);

  const resolvedActiveIndex =
    activeIndex !== null && activeIndex < items.length ? activeIndex : null;
  const activeItem = resolvedActiveIndex === null ? null : (items[resolvedActiveIndex] ?? null);
  const activeTopPercent =
    resolvedActiveIndex === null
      ? 0
      : resolveTimelineMinimapTopPercent(resolvedActiveIndex, items.length);
  let activeTooltipTranslate = '-50%';
  if (resolvedActiveIndex === 0) activeTooltipTranslate = '0%';
  else if (resolvedActiveIndex === items.length - 1) activeTooltipTranslate = '-100%';

  const resolveActiveIndexFromPointer = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      return resolveTimelineMinimapIndexFromPointer({
        itemCount: items.length,
        railTop: rect.top,
        railHeight: rect.height,
        pointerY: event.clientY,
      });
    },
    [items.length]
  );

  const moveActiveIndex = useCallback(
    (delta: number) => {
      setActiveIndex((current) => {
        const base = current ?? 0;
        return Math.max(0, Math.min(items.length - 1, base + delta));
      });
    },
    [items.length]
  );

  const clearHover = () => {
    if (!dragRef.current) setActiveIndex(null);
  };
  const cancelDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      endDrag(event.currentTarget, null);
    }
  };

  if (shouldHide) {
    return null;
  }

  return (
    <div className={css.MinimapContainer} data-testid="timeline-minimap">
      <div className={css.MinimapBody}>
        <button
          ref={railRef}
          type="button"
          className={css.MinimapRail}
          style={{ height: resolveTimelineMinimapHeightStyle(items.length) }}
          role="slider"
          aria-label={t('mindroomUi.threads.timelineMinimap.jumpToMessage')}
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={items.length - 1}
          aria-valuenow={resolvedActiveIndex ?? undefined}
          aria-valuetext={
            activeItem
              ? [activeItem.userText ?? 'Message', activeItem.agentText].filter(Boolean).join(' — ')
              : 'Message'
          }
          onBlur={clearHover}
          onFocus={() => setActiveIndex((current) => current ?? 0)}
          onPointerDown={(event) => {
            if (dragRef.current || !event.isPrimary || event.button !== 0) return;
            event.preventDefault();
            const nextIndex = resolveActiveIndexFromPointer(event);
            const nextItem = nextIndex === null ? null : (items[nextIndex] ?? null);
            if (nextIndex === null || !nextItem) return;
            const rail = event.currentTarget;
            setActiveIndex(nextIndex);
            try {
              rail.setPointerCapture?.(event.pointerId);
            } catch {
              // Synthetic pointer events with an invalid pointerId cannot be captured;
              // select once without entering a drag that could never release.
              onSelect(nextItem);
              return;
            }
            const unblock = blockSelection(() => endDrag(rail, null));
            dragRef.current = {
              pointerId: event.pointerId,
              lastItemId: nextItem.id,
              unblock,
            };
            onSelect(nextItem);
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (drag) {
              if (drag.pointerId !== event.pointerId) return;
              const nextIndex = resolveActiveIndexFromPointer(event);
              setActiveIndex(nextIndex);
              const nextItem = nextIndex === null ? null : (items[nextIndex] ?? null);
              if (nextItem && nextItem.id !== drag.lastItemId) {
                drag.lastItemId = nextItem.id;
                (onScrub ?? onSelect)(nextItem);
              }
              return;
            }
            if (event.buttons !== 0) return;
            setActiveIndex(resolveActiveIndexFromPointer(event));
          }}
          onPointerUp={(event) => {
            if (dragRef.current?.pointerId !== event.pointerId) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const insideRail =
              event.clientX >= rect.left &&
              event.clientX <= rect.right &&
              event.clientY >= rect.top &&
              event.clientY <= rect.bottom;
            const nextActiveIndex = insideRail ? resolveActiveIndexFromPointer(event) : null;
            event.currentTarget.blur();
            endDrag(event.currentTarget, nextActiveIndex);
          }}
          onPointerCancel={cancelDrag}
          onLostPointerCapture={cancelDrag}
          onPointerLeave={clearHover}
          onMouseLeave={clearHover}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={(event) => {
            if (event.detail > 0) return;
            const nextIndex = resolveActiveIndexFromPointer(event);
            const nextItem = nextIndex === null ? null : (items[nextIndex] ?? null);
            if (nextItem) {
              onSelect(nextItem);
            }
            event.currentTarget.blur();
          }}
          onKeyDown={(event) => {
            // A key another listener took (the voice key, Ctrl+Shift+Space) is not the rail's;
            // that listener cancels its release too.
            if (event.defaultPrevented) return;
            const plain = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              moveActiveIndex(1);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              moveActiveIndex(-1);
            } else if (event.key === 'Home') {
              event.preventDefault();
              setActiveIndex(0);
            } else if (event.key === 'End') {
              event.preventDefault();
              setActiveIndex(items.length - 1);
            } else if (event.key === 'Enter' || event.key === ' ') {
              // Always cancelled, so the button's own click (at the top, on release) never jumps.
              event.preventDefault();
              if (plain && activeItem) {
                onSelect(activeItem);
              }
            }
          }}
        >
          {items.map((item, index) => {
            const distance =
              resolvedActiveIndex === null ? null : Math.abs(index - resolvedActiveIndex);
            return (
              <span
                key={item.id}
                aria-hidden="true"
                className={resolveStripClass(distance)}
                data-in-view="false"
                data-minimap-strip
                ref={(node) => {
                  if (node) {
                    stripMap.set(item.id, node);
                  } else {
                    stripMap.delete(item.id);
                  }
                }}
                style={{ top: `${resolveTimelineMinimapTopPercent(index, items.length)}%` }}
              />
            );
          })}
          {activeItem && (
            <span
              className={css.MinimapPreviewCard}
              style={{
                top: `${activeTopPercent}%`,
                transform: `translateY(${activeTooltipTranslate})`,
              }}
            >
              <span className={css.MinimapPreviewTitle}>
                {activeItem.userText ?? t('mindroomUi.threads.timelineMinimap.message')}
              </span>
              {activeItem.agentText && (
                <span className={css.MinimapPreviewBody}>{activeItem.agentText}</span>
              )}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
