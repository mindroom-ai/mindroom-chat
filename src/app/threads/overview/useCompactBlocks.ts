import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import type { ThreadRecord } from '../../event-store/threads/types';
import type { ScrollAnchorMemory } from '../../ui/scrollAnchorMemory';

const BLOCK_CARDS = 12;
const BUFFER_BLOCKS = 1;
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
    const empty: Geometry = { heights: new Map(), fresh: new Set(), visible: [], gap: 0 };
    return {
      geometry: rooms.get(memory)?.get(roomId) ?? empty,
      saved: memory.get(roomId),
      order: undefined as string | undefined,
      blank: new Set<string>(),
      reachable: undefined as string | undefined,
      placed: false,
      end: false,
      input: 0,
      onWrite: undefined as (() => void) | undefined,
      measure: undefined as ((advance?: boolean) => boolean) | undefined,
      wake: undefined as (() => void) | undefined,
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
  // A card that draws nothing (no view model yet) has no height to wait for.
  const missing = blocks.findIndex((block) =>
    block.some((id) => !heights.has(id) && !state.blank.has(id))
  );
  const order = useMemo(() => JSON.stringify(groups), [groups]);
  const small = index.size <= 2 * BLOCK_CARDS;
  // A dirty height still occupies space. Only undiscovered space delays placement.
  const extentComplete = missing < 0 || small;
  // The blocks that hold `ids`, each buffered alone: unmeasured blocks take no space, so two in
  // view can be far apart.
  const slots = (ids: string[]) =>
    [...new Set(ids.flatMap((id) => index.get(id) ?? []))].sort((a, b) => a - b);
  // Offsets through a block are real once it and its buffer are measured.
  const known = (slot: number | undefined) =>
    slot !== undefined && (extentComplete || slot + BUFFER_BLOCKS < missing);
  // One destination places the list: `target` (its caller places it once it is ready), else a
  // Back to the saved cards that are still shown. Warm ones were in view when the list was left
  // and place at once on their cached heights; cold ones wait for their prefix, and an address's
  // one card, while the index loads, for a native range that reaches it. With none shown, Back
  // waits for cards the index may still bring, then for the whole extent.
  const back = !state.placed && !!saved?.scrollTop;
  const savedKeys = saved?.anchors.map(({ key }) => key) ?? [];
  const survivors = savedKeys.filter((id) => index.has(id));
  const backSlot = slots(survivors).at(-1);
  const warm = survivors.some((id) => geometry.visible.includes(id));
  const arriving = indexPending && savedKeys.some((id) => !index.has(id) && !records?.has(id));
  const ranged = !indexPending || savedKeys.length > 1 || state.reachable === order;
  const placeReady =
    !back ||
    warm ||
    (backSlot === undefined ? !arriving && extentComplete : known(backSlot) && ranged);
  const targetSlot = target === undefined ? undefined : index.get(target);
  const targetReady = known(targetSlot);
  // A new order, and a new mount, is drawn where the list is, or where Back puts it: the block
  // `at` that offset, by the heights there are. The cards that were in view stay mounted where
  // they went: what places the list (the anchor memory, the browser) chooses among them as it
  // does with every card mounted.
  const moved = state.order !== order;
  const seen = moved ? [] : slots(geometry.visible);
  const offset = (back && placeReady ? saved?.scrollTop : scrollRef.current?.scrollTop) ?? 0;
  let at = 0;
  for (let end = 0; offset > 0 && at < blocks.length - 1; at += 1) {
    for (const id of blocks[at]!) end += (heights.get(id) ?? 0) + gap;
    if (end > offset) break;
  }
  const reader = seen.length ? seen : [at];
  const held = back ? survivors : moved && state.order ? geometry.visible : [];
  // The reader's blocks stay mounted beside the destination's: the target's block, or for End
  // the blocks that fill the last screen, by the heights there are.
  const wanted = [...reader];
  if (targetReady) wanted.push(targetSlot!);
  const screen = state.end ? scrollRef.current?.clientHeight ?? 0 : 0;
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
  const retained = new Set([focused, protectedId, state.gesture?.id, ...held, ...state.blank]);
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
    // Heights last as long as the place to go back to; of the other rooms, for the last eight
    // shown. A list that mounted is shown: a render React throws away lets no room go.
    const cache = rooms.get(memory) ?? new Map<string, Geometry>();
    rooms.set(memory, cache);
    cache.delete(roomId);
    cache.set(roomId, geometry);
    const idle = [...cache.keys()].filter((id) => id !== roomId && !memory.get(id)?.scrollTop);
    if (idle.length > 7) cache.delete(idle[0]!);
    let frame = 0;
    const schedule = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (state.measure?.(true)) render();
        });
    };
    const scroll = () => {
      const takeover = !state.placed && !!state.saved?.scrollTop && view.scrollTop !== 0;
      if (takeover) state.placed = true;
      const wake = takeover || state.end;
      state.end = false;
      if (state.measure?.() || wake) flushSync(render);
    };
    const observer =
      typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : undefined;
    // A card that resizes resizes the content.
    for (const node of [view, content]) observer?.observe(node);
    state.wake = schedule;
    schedule();
    const fontsChanged = () => {
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
      for (const id of heights.keys())
        if (!records.has(id) && !index.has(id)) {
          heights.delete(id);
          fresh.delete(id);
        }
    // The view shows a spacer: its cards mount before the paint, not on a frame.
    let hole = false;
    // Undefined while the list has no size (hidden): nothing can be measured there.
    const layout = () => {
      hole = false;
      const style = getComputedStyle(content);
      const measuredGap = Number.parseFloat(style.rowGap) || 0;
      const width = content.getBoundingClientRect().width;
      if (width <= 0 || view.clientHeight <= 0) return undefined;
      const metrics = `${width}|${style.fontFamily}|${style.fontSize}|${measuredGap}`;
      let changed = metrics !== geometry.metrics;
      if (changed) fresh.clear();
      geometry.metrics = metrics;
      geometry.gap = measuredGap;
      const { top } = view.getBoundingClientRect();
      const bottom = top + view.clientHeight;
      const visible: string[] = [];
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
          if (back && !ranged && known(backSlot) && id === savedKeys[0]) {
            const destination = view.scrollTop + y - top - saved.anchors[0]!.offset;
            if (destination <= view.scrollHeight - view.clientHeight + 1) {
              state.reachable = order;
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
      // It stays mounted for its height: when it draws, far from the reader, it takes its space.
      state.blank = new Set(liveIds.filter((id) => !heights.has(id)));
      if (back && !state.placed) return changed;
      if (visible.length) geometry.visible = visible;
      state.order = order;
      hole = visible.some((id) => !liveIds.includes(id));
      // A Back placed or retired since this render is dropped by the next one.
      return changed || back || (!!visible.length && `${slots(visible)}` !== `${reader}`);
    };
    const measured = layout();
    const pending = measured || (!small && probe >= 0);
    state.onWrite = () => {
      if (layout()) (hole ? render : state.wake)?.();
    };
    // Discovery parks while the list cannot measure. A frame advances it; a scroll does not.
    state.measure = (advance) => {
      if (advance) state.end = false;
      const now = layout();
      return now !== undefined && (now || (!!advance && pending));
    };
    if (hole || (back && !placeReady && state.reachable === order)) render();
    else if ((measured !== undefined && pending) || (back && placeReady)) state.wake?.();
  });
  // The scrollbar's End reads the extent once the last screen is mounted and measured: cached
  // heights that a width or font change left stale are not the list's end. The second render
  // counts with the first's heights. Not while the extent is still discovered (a render grows
  // it), nor for a small list, all mounted. An End that scrolls nothing ends with the next frame.
  const prepareEnd = () => {
    if (small) return;
    state.end = true;
    flushSync(render);
    flushSync(render);
    state.wake?.();
  };
  return { rows, liveIds, extentComplete, placeReady, targetReady, prepareEnd, progress: state };
}
