import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useResizeObserver } from '../lib/hooks/useResizeObserver';

const NAME_RESERVE = 120;
const MAX_SLOTS = 3;
const PRIORITY = ['subagents', 'schedules', 'members', 'canvas', 'computer', 'pins'];

export function getPhoneHeaderSlots(
  contentWidth: number,
  mandatoryWidth: number,
  slotWidth: number
): number {
  // A hidden or unmeasured header (including jsdom) leaves all optional actions in the menu.
  if (contentWidth <= 0 || slotWidth <= 0) return 0;
  const slots = Math.floor((contentWidth - mandatoryWidth - NAME_RESERVE) / slotWidth);
  return Math.min(MAX_SLOTS, Math.max(0, slots));
}

/** Priority decides who gets a slot, not the order in which the header draws them. */
export function selectPhoneHeaderActions(
  slots: number,
  eligibleIds: readonly string[]
): ReadonlySet<string> {
  return new Set(PRIORITY.filter((id) => eligibleIds.includes(id)).slice(0, slots));
}

const pixels = (value: string) => Number.parseFloat(value) || 0;

export function usePhoneHeaderSlots(phone: boolean) {
  const headerRef = useRef<HTMLElement>(null);
  const callGroupRef = useRef<HTMLDivElement>(null);
  const mandatoryTailRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ slots: 0, headerWidth: 0, mandatoryWidth: 0 });
  const measure = useCallback(() => {
    if (!phone) return;
    const header = headerRef.current;
    const tail = mandatoryTailRef.current;
    const more = tail?.querySelector('[data-room-more-options]');
    if (!header || !tail || !more) return;
    const headerStyle = getComputedStyle(header);
    const headerWidth = header.clientWidth;
    const contentWidth =
      headerWidth - pixels(headerStyle.paddingInlineStart) - pixels(headerStyle.paddingInlineEnd);
    const gap = pixels(getComputedStyle(tail).columnGap);
    // More Options has the same 40 px icon button box as a promoted action, and tracks page zoom.
    const slotWidth = more.getBoundingClientRect().width + gap;
    const callWidth = callGroupRef.current?.getBoundingClientRect().width ?? 0;
    const mandatoryWidth =
      tail.getBoundingClientRect().width + (callWidth > 0 ? callWidth + gap : 0);
    const slots = getPhoneHeaderSlots(contentWidth, mandatoryWidth, slotWidth);
    // The chooser needs actual width changes even when the slot count is unchanged.
    setLayout((previous) =>
      previous.headerWidth === headerWidth &&
      previous.mandatoryWidth === mandatoryWidth &&
      previous.slots === slots
        ? previous
        : { slots, headerWidth, mandatoryWidth }
    );
  }, [phone]);
  useLayoutEffect(measure, [measure]);
  // Observe only fixed groups, not the whole actions row: promotions never change these widths.
  // The call group observes zero width too, while the call controls are suspended or unavailable.
  const observedElements = useCallback(
    () =>
      phone
        ? [headerRef.current, callGroupRef.current, mandatoryTailRef.current].filter(
            (element): element is HTMLElement => element !== null
          )
        : [],
    [phone]
  );
  useResizeObserver(measure, observedElements);
  return { layout, headerRef, callGroupRef, mandatoryTailRef };
}
