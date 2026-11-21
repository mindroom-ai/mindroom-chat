import { useLayoutEffect, useReducer, useRef, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import type { ScrollAnchorMemory } from '../../ui/scrollAnchorMemory';

const BLOCK_CARDS = 12;
const BUFFER_BLOCKS = 1;
export type CompactBlockRow = string | { key: string; height: number; ids: string[] };
type Geometry = { heights: Map<string, number>; visible: string[]; gap: number; order?: string };
const rooms = new WeakMap<ScrollAnchorMemory, Map<string, Geometry>>();

type Options = {
  groups: string[][];
  scrollRef: RefObject<HTMLElement>;
  contentRef: RefObject<HTMLElement>;
  memory: ScrollAnchorMemory;
  roomId: string;
  target?: string;
  protectedId?: string;
};

export function useCompactBlocks({
  groups,
  scrollRef,
  contentRef,
  memory,
  roomId,
  target,
  protectedId,
}: Options) {
  const roomGeometry = rooms.get(memory) ?? new Map<string, Geometry>();
  const scope = useRef<{
    roomId: string;
    geometry: Geometry;
    saved: ReturnType<ScrollAnchorMemory['get']>;
    placed: boolean;
  }>();
  if (scope.current?.roomId !== roomId) {
    scope.current = {
      roomId,
      geometry: roomGeometry.get(roomId) ?? { heights: new Map(), visible: [], gap: 0 },
      saved: memory.get(roomId),
      placed: false,
    };
  }
  const state = scope.current;
  const { geometry, saved } = state;
  const { heights, gap } = geometry;
  const [, render] = useReducer((revision: number) => revision + 1, 0);
  const index = new Map<string, number>();
  const blocks: string[][] = [];
  const grouped = groups.map((ids) => {
    const indexes: number[] = [];
    for (let i = 0; i < ids.length; i += BLOCK_CARDS) {
      const block = ids.slice(i, i + BLOCK_CARDS);
      indexes.push(blocks.length);
      block.forEach((id) => index.set(id, blocks.length));
      blocks.push(block);
    }
    return indexes;
  });
  const probe = blocks.findIndex((block) => block.some((id) => !heights.has(id)));
  const order = blocks.map((block) => block.join(',')).join('|');
  // The initial screen mounts together even if it spans multiple short sections.
  let remaining = 2 * BLOCK_CARDS;
  const initial =
    heights.size === 0 || index.size <= remaining
      ? blocks.filter((block) => {
          remaining -= block.length;
          return remaining >= 0;
        }).length
      : 0;
  const extentComplete = probe < 0 || initial === blocks.length;
  const band = (ids: string[]) => {
    const slots = ids.flatMap((id) => index.get(id) ?? []);
    return slots.length ? ([Math.min(...slots), Math.max(...slots)] as const) : ([0, 0] as const);
  };
  const savedKeys = saved?.anchors.map(({ key }) => key).filter((id) => index.has(id)) ?? [];
  const middle = savedKeys
    .slice()
    .sort((a, b) => index.get(a)! - index.get(b)!)
    .at(Math.floor(savedKeys.length / 2));
  const prefixReady = (slot: number | undefined) =>
    slot !== undefined && (extentComplete || slot + BUFFER_BLOCKS < probe);
  const back = !state.placed && !!saved && saved.scrollTop > 0;
  const backSlot = middle === undefined ? undefined : index.get(middle);
  const placeReady = !back || (backSlot === undefined ? extentComplete : prefixReady(backSlot));
  const targetSlot = target === undefined ? undefined : index.get(target);
  const targetReady = prefixReady(targetSlot);
  const visible =
    geometry.order === order
      ? geometry.visible
      : geometry.visible.filter((id) => index.has(id)).slice(0, 1);
  const [first, last] = band(back && placeReady && middle !== undefined ? [middle] : visible);
  const focused =
    typeof document !== 'undefined' && contentRef.current?.contains(document.activeElement)
      ? document.activeElement?.closest<HTMLElement>('[data-scroll-anchor]')?.dataset.scrollAnchor
      : undefined;
  const liveIds: string[] = [];
  const spacers = new Map<string, string[]>();
  const rows = grouped.map((slots) => {
    const group: CompactBlockRow[] = [];
    slots.forEach((slot) => {
      const inBand =
        (slot >= first! - BUFFER_BLOCKS && slot <= last! + BUFFER_BLOCKS) ||
        (targetReady && Math.abs(slot - targetSlot!) <= BUFFER_BLOCKS);
      blocks[slot]!.forEach((id) => {
        const height = heights.get(id);
        if (
          slot < initial ||
          slot === probe ||
          (height !== undefined && (inBand || id === protectedId || id === focused))
        ) {
          liveIds.push(id);
          group.push(id);
        } else if (height) {
          const tail = group.at(-1);
          if (tail && typeof tail !== 'string') {
            tail.ids.push(id);
            tail.height += height + gap;
          } else {
            const idsInSpacer = [id];
            spacers.set(id, idsInSpacer);
            group.push({ key: id, height, ids: idsInSpacer });
          }
        }
      });
    });
    return group;
  });

  useLayoutEffect(() => {
    const view = scrollRef.current;
    const content = contentRef.current;
    if (!view || !content || typeof window === 'undefined') return undefined;
    rooms.set(memory, roomGeometry);
    roomGeometry.set(roomId, geometry);
    const layout = () => {
      const { top } = view.getBoundingClientRect();
      const bottom = top + view.clientHeight;
      const visible: string[] = [];
      let changed = false;
      const measuredGap = Number.parseFloat(getComputedStyle(content).rowGap) || 0;
      changed = measuredGap !== geometry.gap;
      geometry.gap = measuredGap;
      liveIds.forEach((id) => {
        if (!heights.has(id)) {
          heights.set(id, 0);
          changed = true;
        }
      });
      content
        .querySelectorAll<HTMLElement>('[data-scroll-anchor], [data-compact-spacer]')
        .forEach((row) => {
          const rect = row.getBoundingClientRect();
          const id = row.dataset.scrollAnchor;
          if (id !== undefined) {
            if (heights.get(id) !== rect.height) changed = true;
            heights.set(id, rect.height);
            if (rect.top < bottom && rect.bottom > top) visible.push(id);
          } else if (rect.top < bottom && rect.bottom > top) {
            let y = rect.top;
            spacers.get(row.dataset.compactSpacer ?? '')?.forEach((key) => {
              const height = heights.get(key) ?? 0;
              if (y < bottom && y + height > top) visible.push(key);
              y += height + measuredGap;
            });
          }
        });
      if (back && !state.placed) return changed;
      if (visible.length) geometry.visible = visible;
      geometry.order = order;
      const [start, end] = band(geometry.visible);
      return changed || start !== first || end !== last;
    };
    const measured = layout();
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (placeReady && liveIds.length) state.placed = true;
        if (layout() || measured || !extentComplete) render();
      });
    };
    schedule();
    const scroll = () => {
      if (placeReady && liveIds.length) state.placed = true;
      if (layout()) flushSync(render);
    };
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    observer?.observe(view);
    observer?.observe(content);
    view.addEventListener('scroll', scroll, { passive: true });
    return () => {
      observer?.disconnect();
      cancelAnimationFrame(frame);
      view.removeEventListener('scroll', scroll);
    };
  });

  return { rows, liveIds, extentComplete, placeReady, targetReady };
}
