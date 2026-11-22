import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import type { ThreadRecord } from '../../event-store/threads/types';
import type { ScrollAnchorMemory } from '../../ui/scrollAnchorMemory';

const BLOCK_CARDS = 12;
const BUFFER_BLOCKS = 1;
const SHELL = '[data-scroll-anchor]';
const GESTURE_EVENTS = [
  'pointerdown',
  'pointerup',
  'pointercancel',
  'dragstart',
  'dragend',
  'blur',
];
const cardId = (element?: Element | null) =>
  element?.closest<HTMLElement>(SHELL)?.dataset.scrollAnchor;
export type CompactBlockRow = string | { key: string; height: number; ids: string[] };
type Geometry = {
  heights: Map<string, number>;
  fresh: Set<string>;
  visible: string[];
  gap: number;
  order?: string;
  metrics?: string;
};
const rooms = new WeakMap<ScrollAnchorMemory, Map<string, Geometry>>();
const getGeometry = (memory: ScrollAnchorMemory, roomId: string): Geometry => {
  const cache = rooms.get(memory) ?? new Map<string, Geometry>();
  rooms.set(memory, cache);
  const geometry = cache.get(roomId) ?? {
    heights: new Map(),
    fresh: new Set(),
    visible: [],
    gap: 0,
  };
  cache.set(roomId, geometry);
  return geometry;
};

type Options = {
  groups: Record<string, string[]>;
  scrollRef: RefObject<HTMLElement>;
  contentRef: RefObject<HTMLElement>;
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
    const geometry = getGeometry(memory, roomId);
    return {
      geometry,
      saved: memory.get(roomId),
      previousVisible: geometry.visible,
      readyOrder: undefined as string | undefined,
      placed: false,
      onWrite: undefined as (() => void) | undefined,
      measure: undefined as (() => boolean) | undefined,
      watch: undefined as ((nodes: NodeListOf<Element>, wake: boolean) => void) | undefined,
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
  const missing = blocks.findIndex((block) => block.some((id) => !heights.has(id)));
  const order = useMemo(() => JSON.stringify(groups), [groups]);
  const small = index.size <= 2 * BLOCK_CARDS;
  // A dirty height still occupies space. Only undiscovered space delays placement.
  const extentComplete = missing < 0 || small;
  const slotsOf = (ids: string[]) => ids.flatMap((id) => index.get(id) ?? []).sort((a, b) => a - b);
  const band = (slots: number[]): readonly [number, number] =>
    slots.length ? [slots[0]!, slots.at(-1)!] : [0, 0];
  const median = (slots: number[]) => slots[Math.floor(slots.length / 2)];
  const savedKeys = saved?.anchors.map(({ key }) => key) ?? [];
  const backSlot = median(slotsOf(savedKeys));
  const prefixReady = (slot: number | undefined) =>
    slot !== undefined && (extentComplete || slot + BUFFER_BLOCKS < missing);
  const back = !state.placed && !!saved?.scrollTop;
  const warm = savedKeys.some((id) => index.has(id) && state.previousVisible.includes(id));
  const canPlace =
    !(indexPending && savedKeys.some((id) => !index.has(id) && !records?.has(id))) &&
    (warm || (backSlot === undefined ? extentComplete : prefixReady(backSlot)));
  const waitingForRange = indexPending && !warm && savedKeys.length === 1;
  const placeReady = !back || (canPlace && (!waitingForRange || state.readyOrder === order));
  const targetSlot = target === undefined ? undefined : index.get(target);
  const targetReady = prefixReady(targetSlot);
  const bandSlots = slotsOf(back && backSlot !== undefined ? savedKeys : geometry.visible);
  const seed = band(bandSlots);
  const middle = median(bandSlots) ?? 0;
  const [first, last] =
    geometry.order === order || seed[1] - seed[0] <= BUFFER_BLOCKS ? seed : [middle, middle];
  // A stale offscreen probe can split a gap and clamp a deep scroll offset in WebKit.
  // Refresh occupied heights at the top, or measure the shells as they enter the window.
  const probe =
    missing >= 0 || first > 0
      ? missing
      : blocks.findIndex((block) => block.some((id) => !fresh.has(id)));
  const focused = cardId(contentRef.current?.querySelector?.(':focus'));
  // Keep the visible rows while a partial restore discovers its new prefix.
  const keep = back ? geometry.visible : [];
  const retained = new Set([focused, protectedId, state.gesture?.id, ...keep]);
  const projectedIds: string[] = [];
  const spacers = new Map<string, string[]>();
  const rows = grouped.map(({ key: groupKey, start, end }) => {
    const group: CompactBlockRow[] =
      !small && end > start ? [{ key: `${groupKey}:lead`, height: 0, ids: [] }] : [];
    let gapIndex = 0;
    for (let slot = start; slot < end; slot += 1) {
      const inBand = slot >= first - BUFFER_BLOCKS && slot <= last + BUFFER_BLOCKS;
      const seeking = targetReady && Math.abs(slot - targetSlot!) <= BUFFER_BLOCKS;
      for (const id of blocks[slot]!) {
        const height = heights.get(id);
        if (
          small ||
          slot === probe ||
          (heights.size === 0 && slot === 1) ||
          (height !== undefined && (inBand || seeking || retained.has(id)))
        ) {
          projectedIds.push(id);
          group.push(id);
        } else if (height) {
          const tail = group.at(-1);
          if (tail && typeof tail !== 'string') {
            if (!tail.ids.length) spacers.set(tail.key, tail.ids);
            tail.ids.push(id);
            tail.height += height + (tail.height ? gap : 0);
          } else {
            // Keep this gap mounted as its boundaries move: WebKit clamps if it is removed.
            const spacer = { key: `${groupKey}:${gapIndex++}`, height, ids: [id] };
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
    let frame = 0;
    const schedule = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (state.measure?.()) render();
        });
    };
    const scroll = () => {
      const takeover = !state.placed && !!state.saved?.scrollTop && view.scrollTop !== 0;
      if (takeover) state.placed = true;
      if (state.measure?.() || takeover) flushSync(render);
    };
    const observer =
      typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : undefined;
    for (const node of [view, content]) observer?.observe(node);
    let observed = new Set<Element>();
    state.watch = (nodes, wake) => {
      const next = new Set(nodes);
      for (const node of observed) if (!next.has(node)) observer?.unobserve?.(node);
      for (const node of next) if (!observed.has(node)) observer?.observe(node);
      observed = next;
      if (wake) schedule();
    };
    state.watch(content.querySelectorAll(SHELL), true);
    const fontsChanged = () => {
      geometry.metrics = undefined;
      schedule();
    };
    document.fonts?.addEventListener('loadingdone', fontsChanged);
    const track = (event: Event) => {
      const { type, target } = event;
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
    GESTURE_EVENTS.forEach((event) => window.addEventListener(event, track, true));
    view.addEventListener('scroll', scroll, { passive: true });
    return () => {
      state.watch = undefined;
      observer?.disconnect();
      GESTURE_EVENTS.forEach((event) => window.removeEventListener(event, track, true));
      document.fonts?.removeEventListener('loadingdone', fontsChanged);
      cancelAnimationFrame(frame);
      view.removeEventListener('scroll', scroll);
    };
  }, [contentRef, geometry, scrollRef, state]);
  useLayoutEffect(() => {
    const [view, content] = [scrollRef.current, contentRef.current];
    if (!view || !content || typeof window === 'undefined') return;
    mounted.current = liveIds;
    if (records && !indexPending)
      for (const id of heights.keys())
        if (!records.has(id) && !index.has(id)) {
          heights.delete(id);
          fresh.delete(id);
        }
    const layout = () => {
      const style = getComputedStyle(content);
      const measuredGap = Number.parseFloat(style.rowGap) || 0;
      const width = content.getBoundingClientRect().width;
      if (width <= 0 || view.clientHeight <= 0) return false;
      const metrics = `${width}|${style.fontFamily}|${style.fontSize}|${measuredGap}`;
      let changed = metrics !== geometry.metrics;
      if (changed) fresh.clear();
      geometry.metrics = metrics;
      geometry.gap = measuredGap;
      const { top } = view.getBoundingClientRect();
      const bottom = top + view.clientHeight;
      const visible: string[] = [];
      for (const id of liveIds) fresh.add(id);
      for (const row of content.querySelectorAll<HTMLElement>(`${SHELL}, [data-compact-spacer]`)) {
        const { top: y, height, bottom: end } = row.getBoundingClientRect();
        const id = row.dataset.scrollAnchor;
        if (id !== undefined) {
          if (heights.get(id) !== height) changed = true;
          heights.set(id, height);
          if (back && canPlace && !placeReady && id === savedKeys[0]) {
            const destination = view.scrollTop + y - top - saved.anchors[0]!.offset;
            if (destination <= view.scrollHeight - view.clientHeight + 1) {
              state.readyOrder = order;
              changed = true;
            }
          }
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
      for (const id of liveIds) if (!heights.has(id)) heights.set(id, 0);
      if (back && !state.placed) {
        if (!warm && visible.length) geometry.visible = visible;
        return changed;
      }
      if (visible.length) geometry.visible = visible;
      geometry.order = order;
      const [start, end] = band(slotsOf(geometry.visible));
      return changed || start !== first || end !== last;
    };
    const measured = layout();
    const pending = measured || (!small && probe >= 0);
    state.onWrite = () => {
      if (layout()) state.watch?.(content.querySelectorAll(SHELL), true);
    };
    state.measure = () => layout() || pending;
    state.watch?.(content.querySelectorAll(SHELL), pending || (back && placeReady));
    if (back && !placeReady && state.readyOrder === order) render();
  });
  return { rows, liveIds, extentComplete, placeReady, targetReady, progress: state };
}
