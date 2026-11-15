const PROPERTIES = [
  'offsetParent',
  'offsetLeft',
  'offsetTop',
  'offsetWidth',
  'offsetHeight',
] as const;

/** The box an element names in `data-box="left,top,width,height"`, relative to its parent. */
const boxOf = (element: HTMLElement, fallbackSize: number): number[] => {
  const box = element.dataset.box?.split(',').map(Number);
  return box?.length === 4 ? box : [0, 0, fallbackSize, fallbackSize];
};

/**
 * Gives jsdom, which lays nothing out, layout offsets: each element's parent is its offset
 * parent, and its box is what `data-box` says, or a square of `fallbackSize` at its parent's
 * corner.
 */
export const mockLayout = (fallbackSize = 0): void => {
  const define = (name: (typeof PROPERTIES)[number], get: (element: HTMLElement) => unknown) =>
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) {
        return get(this);
      },
    });
  define('offsetParent', (element) => element.parentElement);
  define('offsetLeft', (element) => boxOf(element, fallbackSize)[0]);
  define('offsetTop', (element) => boxOf(element, fallbackSize)[1]);
  define('offsetWidth', (element) => boxOf(element, fallbackSize)[2]);
  define('offsetHeight', (element) => boxOf(element, fallbackSize)[3]);
};

/** Takes the offsets away again, as jsdom has them. */
export const restoreLayout = (): void => {
  PROPERTIES.forEach((name) => Reflect.deleteProperty(HTMLElement.prototype, name));
};

type ResizeCallback = () => void;

/** Stands in for `ResizeObserver`; returns what tells every observer of a resize. */
export const mockResizeObserver = (): { resize: () => void; observed: () => number } => {
  const callbacks = new Set<ResizeCallback>();
  class FakeResizeObserver {
    private readonly callback: ResizeCallback;

    constructor(callback: ResizeCallback) {
      this.callback = callback;
    }

    observe() {
      callbacks.add(this.callback);
    }

    unobserve() {
      callbacks.delete(this.callback);
    }

    disconnect() {
      callbacks.delete(this.callback);
    }
  }
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: FakeResizeObserver,
  });
  return {
    resize: () => callbacks.forEach((callback) => callback()),
    observed: () => callbacks.size,
  };
};

/** Takes the stand-in away again. */
export const restoreResizeObserver = (): void => {
  Reflect.deleteProperty(globalThis, 'ResizeObserver');
};
