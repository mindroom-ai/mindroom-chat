import type { Page } from '@playwright/test';

export const COMPACT = '[data-compact-room-view]';
export const BOARD = '[data-thread-board-column="open"]';
export const LIVE = ':not([data-page-slide-copy] *, [inert] *)';

interface Row {
  key: string;
  group: string;
  top: number;
  painted: number;
  bottom: number;
  origin: number | null;
}
interface Write {
  method: string;
  before: number;
  after: number;
  stack: string;
}
export interface ListFrame {
  time: number;
  view: number;
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
  input: string[];
  writes: Write[];
  reattached: string[];
}

declare global {
  interface Window {
    compactRecorder: { take: () => ListFrame[]; board: boolean };
  }
}

export const installListRecorder = (page: Page) =>
  page.addInitScript(
    ({ compact, board, live }) => {
      if (window !== window.top) return;
      const selector = () =>
        `${window.compactRecorder.board ? `${board} ` : `:not(${board}) > `}${compact}${live}`;
      const rowSelector = '[data-scroll-anchor], [data-compact-section]';
      const key = (row: HTMLElement) =>
        row.dataset.scrollAnchor ?? `header:${row.dataset.compactSection}`;
      const viewIds = new WeakMap<Element, number>();
      let nextView = 0;
      const frames: ListFrame[] = [];
      let input: string[] = [];
      let writes: (Write & { view: Element })[] = [];
      let reattached: { key: string; view: Element }[] = [];
      window.compactRecorder = { board: false, take: () => frames.splice(0) };
      const findView = (target: Element) => target.closest(selector());
      const record = (target: Element, method: string, call: () => unknown) => {
        const view = findView(target);
        if (
          !view ||
          (method.startsWith('scroll') && method !== 'scrollIntoView' && view !== target)
        )
          return call();
        const before = view.scrollTop;
        const result = call();
        writes.push({
          view,
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
      for (const type of [
        'wheel',
        'touchstart',
        'touchmove',
        'touchend',
        'pointerdown',
        'pointermove',
        'pointerup',
        'pointerout',
        'keydown',
      ]) {
        document.addEventListener(
          type,
          (event) => {
            if (event.isTrusted && event.target instanceof Element && findView(event.target))
              input.push(type);
          },
          { capture: true, passive: true }
        );
      }
      new MutationObserver((changes) => {
        const removed = new Map<HTMLElement, Element>();
        const added = new Set<HTMLElement>();
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
            rowsIn(node).forEach((row) => removed.set(row, view))
          );
          change.addedNodes.forEach((node) => rowsIn(node).forEach((row) => added.add(row)));
        }
        removed.forEach((view, row) => {
          if (added.has(row) && !row.closest('[inert]')) reattached.push({ view, key: key(row) });
        });
      }).observe(document, { childList: true, subtree: true });

      const tick = (time: number) => {
        const view = document.querySelector<HTMLElement>(selector());
        if (view) {
          if (!viewIds.has(view)) viewIds.set(view, ++nextView);
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
            const child = row.querySelector<HTMLElement>('[data-motion-row]');
            const painted = (child ?? row).getBoundingClientRect();
            if (
              Math.max(box.bottom, painted.bottom) <= edge + start ||
              Math.min(box.top, painted.top) >= edge + end
            )
              continue;
            const first = child
              ?.getAnimations()
              .flatMap((animation) =>
                animation.effect instanceof KeyframeEffect
                  ? animation.effect.getKeyframes().slice(0, 1)
                  : []
              )
              .find((frame) => typeof frame.translate === 'string');
            const dy =
              first && typeof first.translate === 'string'
                ? parseFloat(first.translate.split(' ')[1] ?? '')
                : NaN;
            visible.push({
              key: id,
              group,
              top: box.top - edge,
              painted: painted.top - edge,
              bottom: painted.bottom - edge,
              origin: Number.isFinite(dy) ? box.top - edge + dy : null,
            });
          }
          frames.push({
            time,
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
            visible,
            input,
            writes: writes
              .filter((item) => item.view === view)
              .map(({ view: _, ...write }) => write),
            reattached: reattached.filter((item) => item.view === view).map((item) => item.key),
          });
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
