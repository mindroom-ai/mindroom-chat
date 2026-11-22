import { useLayoutEffect, useMemo, useReducer, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import type { ThreadRecord } from '../../event-store/threads/types';
import type { ScrollAnchorMemory } from '../../ui/scrollAnchorMemory';

const BLOCK_CARDS = 12;
const BUFFER_BLOCKS = 1;
const SHELL = '[data-scroll-anchor]';
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
  const { groups, memory, roomId, target, records, indexPending } = options;
  const { scrollRef, contentRef, protectedId } = options;
  const state = useMemo(
    () => ({
      geometry: getGeometry(memory, roomId),
      saved: memory.get(roomId),
      checked: false,
      placed: false,
      occupied: [] as string[],
      gesture: undefined as { id: string; pointer?: number } | undefined,
    }),
    [memory, roomId]
  );
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
  const order = JSON.stringify(groups);
  const small = index.size <= 2 * BLOCK_CARDS;
  let firstScreen = heights.size === 0 ? 2 * BLOCK_CARDS : 0;
  // A dirty height still occupies space. Only undiscovered space delays placement.
  const extentComplete = missing < 0 || small;
  const band = (ids: string[]) => {
    const slots = ids.flatMap((id) => index.get(id) ?? []);
    return slots.length ? ([Math.min(...slots), Math.max(...slots)] as const) : ([0, 0] as const);
  };
  const savedKeys = saved?.anchors.map(({ key }) => key) ?? [];
  const savedSlots = savedKeys.flatMap((id) => index.get(id) ?? []).sort((a, b) => a - b);
  const backSlot = savedSlots[Math.floor(savedSlots.length / 2)];
  const prefixReady = (slot: number | undefined) =>
    slot !== undefined && (extentComplete || slot + BUFFER_BLOCKS < missing);
  const back = !state.placed && !!saved && saved.scrollTop > 0;
  const awaitingAnchors =
    indexPending && savedKeys.some((id) => !index.has(id) && !records?.has(id));
  const canPlace =
    !awaitingAnchors && (backSlot === undefined ? extentComplete : prefixReady(backSlot));
  const placeReady = !back || ((small || state.checked) && canPlace);
  const targetSlot = target === undefined ? undefined : index.get(target);
  const targetReady = prefixReady(targetSlot);
  const visible = geometry.visible.filter((id) => index.has(id));
  const seed = band(visible);
  const [first, last] =
    back && backSlot !== undefined
      ? geometry.order === order
        ? band(savedKeys)
        : [backSlot, backSlot]
      : geometry.order === order || seed[1] - seed[0] <= BUFFER_BLOCKS
      ? seed
      : band(visible.slice(0, 1));
  // Keep the visible rows in place while a partial restore discovers its new prefix.
  const [occupiedFirst, occupiedLast] = band(state.occupied);
  const keepOccupied = back && indexPending && state.occupied.some((id) => index.has(id));
  // A stale offscreen probe can split a gap and clamp a deep scroll offset in WebKit.
  // Refresh occupied heights at the top, or measure the shells as they enter the window.
  const probe =
    missing >= 0 || first > 0
      ? missing
      : blocks.findIndex((block) => block.some((id) => !fresh.has(id)));
  const focused = cardId(contentRef.current?.querySelector?.(':focus'));
  const retained = new Set([focused, protectedId, state.gesture?.id]);
  const liveIds: string[] = [];
  const spacers = new Map<string, string[]>();
  const rows = grouped.map(({ key: groupKey, start, end }) => {
    const group: CompactBlockRow[] = [];
    let gapIndex = 0;
    for (let slot = start; slot < end; slot += 1) {
      const inBand =
        (slot >= first - BUFFER_BLOCKS && slot <= last + BUFFER_BLOCKS) ||
        (keepOccupied &&
          slot >= occupiedFirst &&
          slot <= occupiedLast &&
          (occupiedLast - occupiedFirst <= BUFFER_BLOCKS || slot === occupiedFirst));
      const seeking = targetReady && Math.abs(slot - targetSlot!) <= BUFFER_BLOCKS;
      for (const id of blocks[slot]!) {
        const height = heights.get(id);
        if (
          small ||
          firstScreen-- > 0 ||
          slot === probe ||
          (height !== undefined && (inBand || seeking || retained.has(id)))
        ) {
          liveIds.push(id);
          group.push(id);
        } else if (height) {
          const tail = group.at(-1);
          if (tail && typeof tail !== 'string') {
            tail.ids.push(id);
            tail.height += height + gap;
          } else {
            // Keep this gap mounted as its boundaries move: WebKit clamps if it is removed.
            const key = `${groupKey}:${gapIndex++}`;
            const ids = [id];
            spacers.set(key, ids);
            group.push({ key, height, ids });
          }
        }
      }
    }
    return group;
  });

  useLayoutEffect(() => {
    const view = scrollRef.current;
    const content = contentRef.current;
    if (!view || !content || typeof window === 'undefined') return undefined;
    if (records && !indexPending)
      for (const id of heights.keys()) {
        if (records.has(id) || index.has(id)) continue;
        heights.delete(id);
        fresh.delete(id);
      }
    const layout = (settle = false) => {
      const style = getComputedStyle(content);
      const measuredGap = Number.parseFloat(style.rowGap) || 0;
      const width = content.getBoundingClientRect().width;
      const metrics = `${width}|${style.fontFamily}|${style.fontSize}|${measuredGap}`;
      let changed = metrics !== geometry.metrics;
      if (changed) fresh.clear();
      geometry.metrics = metrics;
      geometry.gap = measuredGap;
      const { top } = view.getBoundingClientRect();
      const bottom = top + view.clientHeight;
      const visible: string[] = [];
      for (const id of liveIds) {
        fresh.add(id);
        if (!heights.has(id)) heights.set(id, 0);
      }
      for (const row of content.querySelectorAll<HTMLElement>(`${SHELL}, [data-compact-spacer]`)) {
        const { top: y, height, bottom: end } = row.getBoundingClientRect();
        const id = row.dataset.scrollAnchor;
        if (id !== undefined) {
          if (heights.get(id) !== height) changed = true;
          heights.set(id, height);
          if (settle && placeReady && !state.placed) {
            const pending = indexPending && saved?.anchors.length ? saved.anchors : undefined;
            const anchor = pending?.find(({ key }) => key === id);
            state.placed = !pending || (!!anchor && Math.abs(y - top - anchor.offset) <= 1);
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
      if (back && !state.placed) {
        if (settle && indexPending && view.scrollTop > 0 && visible.length)
          state.occupied = visible;
        return changed;
      }
      if (visible.length) geometry.visible = visible;
      geometry.order = order;
      const [start, end] = band(geometry.visible);
      return changed || start !== first || end !== last;
    };
    const measured = layout();
    if (back && canPlace && !placeReady) render();
    state.checked = true;
    const update = () => layout(true);
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (update() || measured || (!small && probe >= 0)) render();
      });
    };
    schedule();
    const scroll = () => {
      if (update()) flushSync(render);
    };
    const observer =
      typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : undefined;
    for (const node of [view, content, ...content.querySelectorAll(SHELL)]) observer?.observe(node);
    const fontsChanged = () => {
      geometry.metrics = undefined;
      schedule();
    };
    document.fonts?.addEventListener('loadingdone', fontsChanged);
    const track = (event: Event) => {
      if (event.type === 'wheel') state.placed = true;
      const pointer: number | undefined = (event as Partial<PointerEvent>).pointerId;
      if (event.type === 'pointerdown' || event.type === 'dragstart') {
        const node = event.target;
        const id = node instanceof Element && content.contains(node) && cardId(node);
        if (id) state.gesture = { id, pointer };
      } else if (
        event.type === 'dragend' ||
        event.target === window ||
        (pointer !== undefined && pointer === state.gesture?.pointer)
      )
        state.gesture = undefined;
    };
    const events = ['pointerdown', 'pointerup', 'pointercancel', 'dragstart', 'dragend', 'blur'];
    events.forEach((event) => window.addEventListener(event, track, true));
    view.addEventListener('scroll', scroll, { passive: true });
    view.addEventListener('wheel', track, { passive: true });
    return () => {
      observer?.disconnect();
      events.forEach((event) => window.removeEventListener(event, track, true));
      document.fonts?.removeEventListener('loadingdone', fontsChanged);
      cancelAnimationFrame(frame);
      view.removeEventListener('scroll', scroll);
      view.removeEventListener('wheel', track);
    };
  });

  return { rows, liveIds, extentComplete, placeReady, targetReady };
}
