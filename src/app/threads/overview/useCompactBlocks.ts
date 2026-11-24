import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import type { ThreadRecord } from '../../event-store/threads/types';
import type { ScrollAnchorMemory } from '../../ui/scrollAnchorMemory';

const BLOCK_CARDS = 12;
const BUFFER_BLOCKS = 1;
const WIDTH_SETTLE_MS = 80;
const SHELL = '[data-scroll-anchor]';
const HEARD = 'pointerdown pointerup pointercancel dragstart dragend blur wheel keydown'.split(' ');
const cardId = (element?: Element | null) =>
  element?.closest<HTMLElement>(SHELL)?.dataset.scrollAnchor;
export type CompactBlockRow = string | { key: string; height: number; ids: string[] };
type Geometry = {
  heights: Map<string, number>;
  fresh: Set<string>;
  visible: string[];
  gap: number;
  metrics?: string;
};
const rooms = new WeakMap<ScrollAnchorMemory, Map<string, Geometry>>();

type Options = {
  groups: Record<string, string[]>;
  scrollRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
  memory: ScrollAnchorMemory;
  roomId: string;
  target?: string;
  protectedId?: string;
  records?: ReadonlyMap<string, ThreadRecord>;
  indexPending?: boolean;
};

export function useCompactBlocks(options: Options) {
  const { groups, scrollRef, contentRef, memory, roomId } = options;
  const { target, protectedId, records, indexPending } = options;
  const state = useMemo(() => {
    const empty: Geometry = { heights: new Map(), fresh: new Set(), visible: [], gap: 0 };
    return {
      geometry: rooms.get(memory)?.get(roomId) ?? empty,
      saved: memory.get(roomId),
      order: undefined as string | undefined,
      blank: new Map<string, boolean>(),
      reachable: undefined as string | undefined,
      placed: false,
      left: false,
      end: false,
      input: 0,
      onWrite: undefined as (() => void) | undefined,
      measure: undefined as ((advance?: boolean) => boolean) | undefined,
      wake: undefined as (() => void) | undefined,
      clearResizeTimer: undefined as (() => void) | undefined,
      gesture: undefined as { id: string; pointer?: number } | undefined,
    };
  }, [memory, roomId]);
  const { geometry, saved } = state;
  const { heights, fresh, gap } = geometry;
  const [, render] = useReducer((revision: number) => revision + 1, 0);
  const blocks: string[][] = [];
  const grouped = Object.entries(groups).map(([key, ids]) => {
    const start = blocks.length;
    for (let i = 0; i < ids.length; i += BLOCK_CARDS) blocks.push(ids.slice(i, i + BLOCK_CARDS));
    return { key, start, end: blocks.length };
  });
  const index = new Map(blocks.flatMap((ids, i) => ids.map((id) => [id, i] as const)));
  // A card that drew nothing (no view model) has no height to wait for until its record comes or
  // goes: then it is measured like a new card, so it takes its space wherever the reader is.
  const drawn = (id: string) => state.blank.get(id) !== !!records?.has(id);
  const missing = blocks.findIndex((block) => block.some((id) => !heights.has(id) && drawn(id)));
  const order = useMemo(() => JSON.stringify(groups), [groups]);
  const small = index.size <= 2 * BLOCK_CARDS;
  // A dirty height still occupies space. Only undiscovered space delays placement.
  const extentComplete = missing < 0 || small;
  // The blocks of `ids`, each buffered alone: with unmeasured blocks between, they can be far.
  const slots = (ids: string[]) =>
    [...new Set(ids.flatMap((id) => index.get(id) ?? []))].sort((a, b) => a - b);
  // Offsets through a block are real once it and its buffer are measured.
  const known = (slot: number | undefined) =>
    slot !== undefined && (extentComplete || slot + BUFFER_BLOCKS < missing);
  // One destination places the list: `target` (its caller places it once it is ready), else the
  // saved place, for as long as the anchor memory follows it (`back` until its first write): its
  // cards that are shown stay mounted, also one that joins the order later. Warm ones were in
  // view when the list was left and place at once on their cached heights; cold ones wait for
  // their prefix, and an address's one card, while the index loads, for a native range that
  // reaches it. With none shown, Back waits for cards the index may still bring, then until the
  // layout finds every card down to the saved screen measured (`reachable`, like the range).
  const follows = !!saved?.scrollTop && !state.left;
  const back = follows && !state.placed;
  const savedKeys = saved?.anchors.map(({ key }) => key) ?? [];
  const survivors = savedKeys.filter((id) => index.has(id));
  const backSlot = slots(survivors).at(-1);
  const warm = survivors.some((id) => geometry.visible.includes(id));
  const arriving = indexPending && savedKeys.some((id) => !index.has(id) && !records?.has(id));
  const reached = state.reachable === order;
  const first = blocks[missing]?.find((id) => !heights.has(id) && drawn(id));
  const placeReady =
    !follows ||
    warm ||
    (backSlot === undefined
      ? !back || (!arriving && (extentComplete || reached))
      : known(backSlot) && (!indexPending || savedKeys.length > 1 || reached));
  const targetSlot = target === undefined ? undefined : index.get(target);
  const targetReady = known(targetSlot);
  // A new order, and a new mount, is drawn where the list is, or where Back puts it: the block
  // `here`, by the heights there are. The cards that were in view stay mounted wherever they
  // went, so what places the list (the anchor memory, the browser) chooses as among all cards.
  const moved = state.order !== order;
  const seen = moved ? [] : slots(geometry.visible);
  const offset = (back && placeReady ? saved?.scrollTop : scrollRef.current?.scrollTop) ?? 0;
  let here = 0;
  for (let end = 0; offset > 0 && here < blocks.length - 1; here += 1) {
    for (const id of blocks[here]!) end += (heights.get(id) ?? 0) + gap;
    if (end > offset) break;
  }
  const reader = seen.length ? seen : [here];
  const held = [...(follows ? survivors : []), ...(moved && state.order ? geometry.visible : [])];
  // Beside them stay the target's block and, for End, the blocks that fill the last screen.
  const wanted = targetReady ? [...reader, targetSlot!] : [...reader];
  const screen = state.end ? (scrollRef.current?.clientHeight ?? 0) : 0;
  for (let slot = blocks.length - 1, room = screen; slot >= 0 && room > 0; slot -= 1) {
    wanted.push(slot);
    for (const id of blocks[slot]!) room -= (heights.get(id) ?? 0) + gap;
  }
  const near = (slot: number) => wanted.some((at) => Math.abs(slot - at) <= BUFFER_BLOCKS);
  // A stale offscreen probe can split a gap and clamp a deep scroll offset in WebKit.
  // Refresh occupied heights at the top, or measure the shells as they enter the window.
  const probe =
    missing >= 0 || reader[0]! > 0
      ? missing
      : blocks.findIndex((block) => block.some((id) => !fresh.has(id)));
  const focused = cardId(contentRef.current?.querySelector?.(':focus'));
  const retained = new Set([focused, protectedId, state.gesture?.id, ...held]);
  const projectedIds: string[] = [];
  const spacers = new Map<string, string[]>();
  const rows = grouped.map(({ key: groupKey, start, end }) => {
    const group: CompactBlockRow[] = [];
    for (let slot = start; slot < end; slot += 1) {
      // A band's cards mount with or without a height: only cards outside wait for the probe.
      const inBand = small || slot === probe || near(slot);
      for (const id of blocks[slot]!) {
        const height = heights.get(id);
        if (inBand || retained.has(id)) {
          projectedIds.push(id);
          group.push(id);
        } else if (height) {
          const tail = group.at(-1);
          if (tail && typeof tail !== 'string') {
            tail.ids.push(id);
            tail.height += height + gap;
          } else {
            // Keyed by the card before it: React then moves no mounted card around a spacer,
            // which would drop the card's focus and, with it, the place in the list.
            const spacer = { key: `${groupKey}:${tail ?? ''}`, height, ids: [id] };
            spacers.set(spacer.key, spacer.ids);
            group.push(spacer);
          }
        }
      }
    }
    return group;
  });
  const mounted = useRef<string[]>([]);
  const liveIds =
    projectedIds.length === mounted.current.length &&
    projectedIds.every((id, i) => id === mounted.current[i])
      ? mounted.current
      : projectedIds;
  useEffect(() => {
    const [view, content] = [scrollRef.current, contentRef.current];
    if (!view || !content || typeof window === 'undefined') return undefined;
    // Heights last with the place to go back to; else for the last eight rooms that mounted.
    const cache = rooms.get(memory) ?? new Map<string, Geometry>();
    cache.delete(roomId);
    rooms.set(memory, cache.set(roomId, geometry));
    const idle = [...cache.keys()].filter((id) => id !== roomId && !memory.get(id)?.scrollTop);
    if (idle.length > 7) cache.delete(idle[0]!);
    let frame = 0;
    let observedWidth = content.getBoundingClientRect().width;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const clearResizeTimer = () => {
      clearTimeout(resizeTimer);
      resizeTimer = undefined;
    };
    const schedule = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (state.measure?.(true)) render();
        });
    };
    const scroll = () => {
      clearResizeTimer();
      const takeover = !state.placed && !!state.saved?.scrollTop && view.scrollTop !== 0;
      if (takeover) state.placed = state.left = true;
      const wake = takeover || state.end;
      state.end = false;
      if (state.measure?.() || wake) flushSync(render);
    };
    const onResize = () => {
      const nextWidth = content.getBoundingClientRect().width;
      if (
        observedWidth > 0 &&
        nextWidth > 0 &&
        (nextWidth !== observedWidth || resizeTimer !== undefined)
      ) {
        observedWidth = nextWidth;
        cancelAnimationFrame(frame);
        frame = 0;
        clearResizeTimer();
        resizeTimer = setTimeout(() => {
          resizeTimer = undefined;
          schedule();
        }, WIDTH_SETTLE_MS);
        return;
      }
      clearResizeTimer();
      observedWidth = nextWidth;
      schedule();
    };
    const observer =
      typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : undefined;
    // A card that resizes resizes the content.
    for (const node of [view, content]) observer?.observe(node);
    state.wake = schedule;
    state.clearResizeTimer = clearResizeTimer;
    schedule();
    const fontsChanged = () => {
      clearResizeTimer();
      geometry.metrics = undefined;
      schedule();
    };
    document.fonts?.addEventListener('loadingdone', fontsChanged);
    const track = (event: Event) => {
      const { type, target } = event;
      if (/down|wheel/.test(type)) state.input += 1; // What the reader scrolls with.
      const pointer = (event as Partial<PointerEvent>).pointerId;
      if (type === 'pointerdown' || type === 'dragstart') {
        const id = target instanceof Element && content.contains(target) && cardId(target);
        if (id) state.gesture = { id, pointer };
      } else if (
        type === 'dragend' ||
        target === window ||
        (pointer !== undefined && pointer === state.gesture?.pointer)
      )
        state.gesture = undefined;
    };
    HEARD.forEach((event) => window.addEventListener(event, track, true));
    view.addEventListener('scroll', scroll, { passive: true });
    return () => {
      state.wake = undefined;
      state.clearResizeTimer = undefined;
      clearResizeTimer();
      observer?.disconnect();
      HEARD.forEach((event) => window.removeEventListener(event, track, true));
      document.fonts?.removeEventListener('loadingdone', fontsChanged);
      cancelAnimationFrame(frame);
      view.removeEventListener('scroll', scroll);
    };
  }, [contentRef, geometry, memory, roomId, scrollRef, state]);
  useLayoutEffect(() => {
    const [view, content] = [scrollRef.current, contentRef.current];
    if (!view || !content || typeof window === 'undefined') return;
    mounted.current = liveIds;
    if (records && !indexPending)
      for (const kept of [heights, fresh])
        for (const id of kept.keys()) if (!records.has(id) && !index.has(id)) kept.delete(id);
    // The view shows a spacer, or the saved place came into reach: the next render is before
    // the paint, not on a frame.
    let hole = false;
    // Undefined while the list has no size (hidden): nothing can be measured there.
    const layout = () => {
      const style = getComputedStyle(content);
      const measuredGap = Number.parseFloat(style.rowGap) || 0;
      const width = content.getBoundingClientRect().width;
      if (width <= 0 || view.clientHeight <= 0) return undefined;
      const metrics = `${width}|${style.fontFamily}|${style.fontSize}|${measuredGap}`;
      let changed = metrics !== geometry.metrics;
      if (changed) fresh.clear();
      Object.assign(geometry, { metrics, gap: measuredGap });
      const { top } = view.getBoundingClientRect();
      const bottom = top + view.clientHeight;
      const visible: string[] = [];
      // The saved place and how far the list reaches, in scroll pixels: to the native end for a
      // saved card, else to a screen above the first card that is still to be discovered.
      let goal = saved?.scrollTop ?? 0;
      let reach = known(backSlot) ? view.scrollHeight - view.clientHeight + 1 : -Infinity;
      for (const id of liveIds) fresh.add(id);
      // An inert copy animates a card's leave: it is not the card.
      const rowsNow = `${SHELL}:not([inert]), [data-compact-spacer]`;
      for (const row of content.querySelectorAll<HTMLElement>(rowsNow)) {
        const { top: y, height, bottom: end } = row.getBoundingClientRect();
        const id = row.dataset.scrollAnchor;
        if (id !== undefined) {
          // A mounted card's height is in no spacer: only a discovered one changes the rows.
          if (!heights.has(id)) changed = true;
          heights.set(id, height);
          const at = view.scrollTop + y - top;
          if (id === savedKeys[0]) goal = at - (saved?.anchors[0]?.offset ?? 0);
          if (id === first && backSlot === undefined) reach = at - view.clientHeight;
        }
        if (y >= bottom || end <= top) continue;
        let edge = y;
        const keys = id === undefined ? spacers.get(row.dataset.compactSpacer ?? '') : [id];
        for (const key of keys ?? []) {
          const next = edge + (heights.get(key) ?? 0);
          if (edge < bottom && next > top) visible.push(key);
          edge = next + measuredGap;
        }
      }
      for (const id of liveIds) if (!heights.has(id)) state.blank.set(id, !!records?.has(id));
      hole = follows && !placeReady && state.reachable !== order && goal <= reach;
      if (hole) state.reachable = order;
      if (back && !state.placed) return changed || hole;
      if (visible.length) geometry.visible = visible;
      state.order = order;
      hole = hole || visible.some((id) => !liveIds.includes(id));
      // A Back placed or retired since this render is dropped by the next one.
      return changed || hole || back || (!!visible.length && `${slots(visible)}` !== `${reader}`);
    };
    const measured = layout();
    const pending = measured || (!small && probe >= 0);
    state.onWrite = () => layout() && (hole ? render : state.wake)?.();
    // Discovery parks while the list cannot measure. A frame advances it; a scroll does not.
    state.measure = (advance) => {
      if (advance) state.end = false;
      const now = layout();
      return now !== undefined && (now || (!!advance && pending));
    };
    if (hole) render();
    else if ((measured !== undefined && pending) || (back && placeReady)) state.wake?.();
  });
  // The scrollbar's End reads the extent once the last screen is mounted and measured: cached
  // heights that a width or font change left stale are not the list's end. The second render
  // counts with the first's heights. Not while the extent is still discovered (a render grows
  // it), nor for a small list, all mounted. An End that scrolls nothing ends with the next frame.
  const prepareEnd = () => {
    if (small) return;
    state.clearResizeTimer?.();
    state.end = true;
    flushSync(render);
    flushSync(render);
    state.wake?.();
  };
  return { rows, liveIds, extentComplete, placeReady, targetReady, prepareEnd, progress: state };
}
