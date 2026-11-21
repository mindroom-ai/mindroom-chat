import type { Page } from '@playwright/test';
export const COMPACT = '[data-compact-room-view]';
export const BOARD = '[data-thread-board-column="open"]';
export const LIVE = ':not([data-page-slide-copy] *, [inert] *)';
interface Row {
  key: string;
  group: string;
  top: number;
  height: number;
  glide: number;
  painted: number;
  bottom: number;
  origin: number | null;
}
interface Write {
  seq: number;
  method: string;
  before: number;
  after: number;
  stack: string;
}
export interface ListInput {
  seq: number;
  type: string;
  direction: number;
  y: number;
  mouse: boolean;
  inside: boolean;
}
export interface ListFrame {
  time: number;
  view: string;
  y: number;
  height: number;
  max: number;
  start: number;
  end: number;
  pending: boolean;
  held: boolean;
  pill: boolean;
  order: [key: string, group: string][];
  visible: Row[];
  input: ListInput[];
  moving: boolean;
  replySeen: boolean;
  writes: Write[];
  reattached: string[];
}

declare global {
  interface Window {
    compactRecorder: {
      take: () => ListFrame[];
      board: boolean;
      evidence: [string, string] | null;
      last: ListFrame | undefined;
    };
  }
}
export const installListRecorder = (page: Page) =>
  page.addInitScript(
    ({ compact, board, live }) => {
      if (window !== window.top) return;
      const selector = () =>
        window.compactRecorder.board
          ? `${board} ${compact}${live}`
          : `${compact}${live}:not([data-thread-board-column] *)`;
      const rowSelector = '[data-scroll-anchor], [data-compact-section]';
      const key = (row: HTMLElement) =>
        row.dataset.scrollAnchor ?? `header:${row.dataset.compactSection}`;
      const translationY = (value: string) => parseFloat(value.split(' ')[1] ?? '');
      const viewIds = new WeakMap<Element, string>();
      const glideIds = new WeakMap<Animation, number>();
      let nextView = 0;
      let seq = 0;
      const frames: ListFrame[] = [];
      let input: ListInput[] = [];
      let writes: (Write & { view: Element })[] = [];
      let reattached: { key: string; view: Element }[] = [];
      window.compactRecorder = {
        board: false,
        evidence: null,
        last: undefined,
        take: () => frames.splice(0),
      };
      const findView = (target: Element) => target.closest(selector());
      const record = (target: Element, method: string, call: () => unknown) => {
        const view = findView(target);
        if (
          !view ||
          (method.startsWith('scroll') && method !== 'scrollIntoView' && view !== target)
        )
          return call();
        const before = view.scrollTop;
        const stamp = ++seq;
        const result = call();
        writes.push({
          view,
          seq: stamp,
          method,
          before,
          after: view.scrollTop,
          stack: new Error().stack?.split('\n').slice(2, 7).join('\n') ?? '',
        });
        return result;
      };
      const top = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
      Object.defineProperty(Element.prototype, 'scrollTop', {
        ...top,
        set(this: Element, value: number) {
          record(this, 'scrollTop', () => top.set!.call(this, value));
        },
      });
      for (const method of ['scrollTo', 'scrollBy', 'scrollIntoView', 'focus']) {
        const proto = method === 'focus' ? HTMLElement.prototype : Element.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(proto, method)!;
        Object.defineProperty(proto, method, {
          ...descriptor,
          value(this: Element, ...args: unknown[]) {
            return record(this, method, () => Reflect.apply(descriptor.value, this, args));
          },
        });
      }
      let touchY = 0;
      for (const type of 'wheel touchstart touchmove touchend touchcancel pointerdown pointermove pointerup click keydown'.split(
        ' '
      )) {
        document.addEventListener(
          type,
          (event) => {
            if (!event.isTrusted || !(event.target instanceof Element)) return;
            const view = document.querySelector<HTMLElement>(selector());
            if (!view) return;
            let direction = 0;
            if (event instanceof WheelEvent && findView(event.target))
              direction = Math.sign(event.deltaY);
            if (type.startsWith('touch')) {
              const current = (event as TouchEvent).touches[0]?.clientY ?? touchY;
              if (event.type === 'touchmove') direction = Math.sign(touchY - current);
              touchY = current;
            }
            input.push({
              seq: ++seq,
              type,
              direction,
              y: view.scrollTop,
              mouse:
                event instanceof PointerEvent && event.pointerType === 'mouse' && !event.buttons,
              inside: !!findView(event.target),
            });
          },
          { capture: true, passive: true }
        );
      }
      new MutationObserver((changes) => {
        const removed: { view: Element; key: string }[] = [];
        const added = new Map<HTMLElement, Element>();
        const rowsIn = (node: Node) =>
          node instanceof HTMLElement
            ? [
                ...(node.matches(rowSelector) ? [node] : []),
                ...node.querySelectorAll<HTMLElement>(rowSelector),
              ]
            : [];
        for (const change of changes) {
          if (!(change.target instanceof Element)) continue;
          const view = findView(change.target);
          if (!view) continue;
          change.removedNodes.forEach((node) =>
            rowsIn(node).forEach((row) => removed.push({ view, key: key(row) }))
          );
          change.addedNodes.forEach((node) => rowsIn(node).forEach((row) => added.set(row, view)));
        }
        added.forEach((view, row) => {
          if (
            !row.closest('[inert]') &&
            removed.some((entry) => entry.view === view && entry.key === key(row))
          )
            reattached.push({ view, key: key(row) });
        });
      }).observe(document, { childList: true, subtree: true });
      const tick = (time: number) => {
        const view = document.querySelector<HTMLElement>(selector());
        if (view) {
          if (!viewIds.has(view)) viewIds.set(view, `${performance.timeOrigin}/${++nextView}`);
          const { top: edge } = view.getBoundingClientRect();
          const css = getComputedStyle(view);
          const start = view.clientTop + (parseFloat(css.scrollPaddingTop) || 0);
          const end =
            view.clientTop + view.clientHeight - (parseFloat(css.scrollPaddingBottom) || 0);
          const order: ListFrame['order'] = [];
          const visible: Row[] = [];
          let section = 'ordinary';
          for (const row of view.querySelectorAll<HTMLElement>(rowSelector)) {
            if (row.closest('[inert]')) continue;
            section = row.dataset.compactSection ?? section;
            const group = row.closest('[data-pinned-threads]') ? 'pinned' : section;
            const id = key(row);
            order.push([id, group]);
            const box = row.getBoundingClientRect();
            const child = row.querySelector<HTMLElement>('[data-motion-row]') ?? row;
            const painted = child === row ? box : child.getBoundingClientRect();
            if (
              Math.max(box.bottom, painted.bottom) <= edge + start ||
              Math.min(box.top, painted.top) >= edge + end
            )
              continue;
            const active = child
              .getAnimations()
              .find(({ effect }) =>
                (effect as KeyframeEffect | null)?.getKeyframes().some((frame) => frame.translate)
              );
            if (active && !glideIds.has(active)) glideIds.set(active, ++seq);
            const translate = (active?.effect as KeyframeEffect | undefined)?.getKeyframes()[0]
              ?.translate;
            const top =
              box.top -
              edge -
              (child === row ? translationY(getComputedStyle(row).translate) || 0 : 0);
            const dy = translationY(typeof translate === 'string' ? translate : '');
            visible.push({
              key: id,
              group,
              top,
              height: box.height,
              glide: active ? glideIds.get(active)! : 0,
              painted: painted.top - edge,
              bottom: painted.bottom - edge,
              origin: Number.isFinite(dy) ? top + dy : null,
            });
          }
          const evidence = window.compactRecorder.evidence;
          const sample = {
            time: performance.timeOrigin + time,
            view: viewIds.get(view)!,
            y: view.scrollTop,
            height: view.clientHeight,
            max: view.scrollHeight - view.clientHeight,
            start,
            end,
            pending: view.hasAttribute('data-cards-pending'),
            held: !!view.querySelector('[data-order-held]'),
            pill: [...view.querySelectorAll('button')].some(
              (button) =>
                button.getAttribute('aria-label') === 'Show updated order' ||
                button.textContent?.trim() === 'Show updated order'
            ),
            order,
            moving: view
              .getAnimations({ subtree: true })
              .some(
                (animation) =>
                  animation.playState === 'running' &&
                  animation.effect?.getComputedTiming().endTime !== Infinity
              ),
            replySeen:
              !!evidence &&
              !!view
                .querySelector(`[data-scroll-anchor="${CSS.escape(evidence[0])}"]`)
                ?.textContent?.includes(evidence[1]),
            visible,
            input,
            writes: writes
              .filter((item) => item.view === view)
              .map(({ view: _, ...write }) => write),
            reattached: reattached.filter((item) => item.view === view).map((item) => item.key),
          };
          window.compactRecorder.last = sample;
          frames.push(sample);
        }
        input = [];
        writes = [];
        reattached = [];
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    { compact: COMPACT, board: BOARD, live: LIVE }
  );
export const takeFrames = (page: Page) => page.evaluate(() => window.compactRecorder.take());
