import { useLayoutEffect, useMemo, useReducer, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import type { ThreadRecord } from '../../event-store/threads/types';
import type { ScrollAnchorMemory } from '../../ui/scrollAnchorMemory';

const BLOCK_CARDS = 12;
const BUFFER_BLOCKS = 1;
const SHELL = '[data-scroll-anchor]';
const cardId = (element?: Node | null) => {
  const node = element instanceof Element ? element : element?.parentElement;
  return node?.closest<HTMLElement>(SHELL)?.dataset.scrollAnchor;
};
export type CompactBlockRow = string | { key: string; height: number; ids: string[] };
type Geometry = {
  heights: Map<string, number>;
  fresh: Map<string, number>;
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
    fresh: new Map(),
    visible: [],
    gap: 0,
  };
  cache.set(roomId, geometry);
  return geometry;
};
const revisions = new WeakMap<ThreadRecord, number>();
let nextRevision = 1;
const revisionOf = (record?: ThreadRecord) => {
  if (!record) return 0;
  if (!revisions.has(record)) revisions.set(record, nextRevision++);
  return revisions.get(record)!;
};

type Options = {
  groups: string[][];
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
      placed: false,
      gesture: undefined as { id: string; pointer?: number } | undefined,
    }),
    [memory, roomId]
  );
  const { geometry, saved } = state;
  const { heights, fresh, gap } = geometry;
  const [, render] = useReducer((revision: number) => revision + 1, 0);
  const grouped = groups.map((ids) =>
    Array.from({ length: Math.ceil(ids.length / BLOCK_CARDS) }, (_, i) =>
      ids.slice(i * BLOCK_CARDS, (i + 1) * BLOCK_CARDS)
    )
  );
  const blocks = grouped.flat();
  const index = new Map(blocks.flatMap((ids, i) => ids.map((id) => [id, i] as const)));
  const missing = blocks.findIndex((block) => block.some((id) => !heights.has(id)));
  const probe = blocks.findIndex((block) =>
    block.some((id) => fresh.get(id) !== revisionOf(records?.get(id)))
  );
  const order = blocks.map((block) => block.join(',')).join('|');
  const small = index.size <= 2 * BLOCK_CARDS;
  let firstScreen = heights.size === 0 ? 2 * BLOCK_CARDS : 0;
  const extentComplete = probe < 0 || small;
  const band = (ids: string[]) => {
    const slots = ids.flatMap((id) => index.get(id) ?? []);
    return slots.length ? ([Math.min(...slots), Math.max(...slots)] as const) : ([0, 0] as const);
  };
  const savedKeys = saved?.anchors.map(({ key }) => key) ?? [];
  const savedSlots = savedKeys.flatMap((id) => index.get(id) ?? []).sort((a, b) => a - b);
  const backSlot = savedSlots[Math.floor(savedSlots.length / 2)];
  const prefixReady = (slot: number | undefined) =>
    slot !== undefined && (missing < 0 || small || slot + BUFFER_BLOCKS < missing);
  const back = !state.placed && !!saved && saved.scrollTop > 0;
  const awaitingAnchors =
    indexPending && savedKeys.some((id) => !index.has(id) && !records?.has(id));
  const placeReady =
    !back ||
    (!awaitingAnchors && (backSlot === undefined ? extentComplete : prefixReady(backSlot)));
  const targetSlot = target === undefined ? undefined : index.get(target);
  const targetReady = prefixReady(targetSlot);
  const visible = geometry.visible.filter((id) => index.has(id));
  const [first, last] =
    backSlot !== undefined && back && placeReady
      ? [backSlot, backSlot]
      : band(geometry.order === order ? visible : visible.slice(0, 1));
  const focused =
    typeof document === 'undefined'
      ? undefined
      : cardId(contentRef.current?.querySelector(':focus'));
  const retained = new Set([focused, protectedId, state.gesture?.id]);
  const liveIds: string[] = [];
  const spacers = new Map<string, string[]>();
  let slot = 0;
  const rows = grouped.map((section, groupIndex) => {
    const group: CompactBlockRow[] = [];
    let gapIndex = 0;
    for (const block of section) {
      const inBand = slot >= first - BUFFER_BLOCKS && slot <= last + BUFFER_BLOCKS;
      const seeking = targetReady && Math.abs(slot - targetSlot!) <= BUFFER_BLOCKS;
      for (const id of block) {
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
            const key = `${groupIndex}:${gapIndex++}`;
            const ids = [id];
            spacers.set(key, ids);
            group.push({ key, height, ids });
          }
        }
      }
      slot += 1;
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
    const layout = () => {
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
        fresh.set(id, revisionOf(records?.get(id)));
        if (!heights.has(id)) heights.set(id, 0);
      }
      for (const row of content.querySelectorAll<HTMLElement>(`${SHELL}, [data-compact-spacer]`)) {
        const { top: y, height, bottom: end } = row.getBoundingClientRect();
        const id = row.dataset.scrollAnchor;
        if (id !== undefined) {
          if (heights.get(id) !== height) changed = true;
          heights.set(id, height);
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
      if (back && !state.placed) return changed;
      if (visible.length) geometry.visible = visible;
      geometry.order = order;
      const [start, end] = band(geometry.visible);
      return changed || start !== first || end !== last;
    };
    const measured = layout();
    const update = () => {
      state.placed ||= placeReady && liveIds.length > 0;
      return layout();
    };
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (update() || measured || !extentComplete) render();
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
      const pointer: number | undefined = (event as Partial<PointerEvent>).pointerId;
      if (event.type === 'pointerdown' || event.type === 'dragstart') {
        const node = event.target as Node | null;
        const id = cardId(node);
        if (id && content.contains(node)) state.gesture = { id, pointer };
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
    return () => {
      observer?.disconnect();
      events.forEach((event) => window.removeEventListener(event, track, true));
      document.fonts?.removeEventListener('loadingdone', fontsChanged);
      cancelAnimationFrame(frame);
      view.removeEventListener('scroll', scroll);
    };
  });

  return { rows, liveIds, extentComplete, placeReady, targetReady };
}
