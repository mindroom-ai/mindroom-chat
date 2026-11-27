// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachLiquidGlass } from './liquidGlass';

describe('liquid glass rendering lifecycle', () => {
  let element: HTMLDivElement;
  let cleanup: () => void;
  let width: number;
  let notifyResize: ResizeObserverCallback;
  let notifyVisibility: IntersectionObserverCallback;
  let preferences: Map<string, boolean>;
  let preferenceListeners: Set<() => void>;

  const show = (isIntersecting: boolean) => {
    notifyVisibility(
      [{ target: element, isIntersecting } as unknown as IntersectionObserverEntry],
      {} as IntersectionObserver
    );
    vi.runAllTimers();
  };
  const setPreference = (query: string, enabled: boolean) => {
    preferences.set(query, enabled);
    preferenceListeners.forEach((listener) => listener());
    vi.runAllTimers();
  };

  beforeEach(() => {
    preferences = new Map();
    preferenceListeners = new Set();
    width = 180;
    cleanup = () => {};
    vi.useFakeTimers();
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36'
    );
    vi.stubGlobal('CSS', { supports: () => true });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(0), 0)
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          notifyResize = callback;
        }

        observe() {}

        disconnect() {}
      }
    );
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          notifyVisibility = callback;
        }

        observe() {}

        disconnect() {}
      }
    );
    vi.stubGlobal('matchMedia', (query: string) => ({
      get matches() {
        return preferences.get(query) ?? false;
      },
      media: query,
      addEventListener: (_event: string, listener: () => void) => preferenceListeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) =>
        preferenceListeners.delete(listener),
    }));
    // JSDOM has no rasterizer; geometry is covered with real bytes separately.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => {},
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,AA=='
    );
    element = document.createElement('div');
    element.style.borderRadius = '20px';
    Object.defineProperties(element, {
      offsetWidth: { get: () => width },
      offsetHeight: { value: 80 },
    });
    document.body.append(element);
  });

  afterEach(() => {
    cleanup();
    element.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('tracks highlights without allocating optical observers when refraction is disabled', () => {
    const resize = vi.fn(() => ({ observe() {}, disconnect() {} }));
    const intersection = vi.fn(() => ({ observe() {}, disconnect() {} }));
    vi.stubGlobal('ResizeObserver', resize);
    vi.stubGlobal('IntersectionObserver', intersection);
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 100,
    } as DOMRect);
    cleanup = attachLiquidGlass(element, { refraction: false });
    element.dispatchEvent(new MouseEvent('pointermove', { clientX: 150, clientY: 25 }));
    vi.runAllTimers();
    expect(element.style.getPropertyValue('--liquid-glass-light-x')).toBe('75%');
    expect(element.style.getPropertyValue('--liquid-glass-light-y')).toBe('25%');
    expect(resize).not.toHaveBeenCalled();
    expect(intersection).not.toHaveBeenCalled();
    expect(element.hasAttribute('data-liquid-glass')).toBe(false);
    setPreference('(prefers-reduced-motion: reduce)', true);
    expect(element.style.getPropertyValue('--liquid-glass-light-x')).toBe('');
    cleanup();
    expect(preferenceListeners.size).toBe(0);
  });

  it('keeps the native blur when the page draws without a GPU', async () => {
    const renderers = [
      'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
      'llvmpipe (LLVM 17.0.6, 256 bits)',
    ];
    const canvasContext = HTMLCanvasElement.prototype.getContext;
    for (const renderer of [...renderers, undefined]) {
      vi.resetModules();
      // A fresh module, so the renderer is read again.
      const fresh = await import('./liquidGlass');
      const twoD = canvasContext.call(document.createElement('canvas'), '2d');
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((type: string) => {
        if (type !== 'webgl') return twoD;
        if (renderer === undefined) return null;
        return {
          getExtension: (name: string) =>
            name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 37446 } : null,
          getParameter: () => renderer,
        };
      }) as unknown as typeof HTMLCanvasElement.prototype.getContext);
      const resize = vi.fn(() => ({ observe() {}, disconnect() {} }));
      vi.stubGlobal('ResizeObserver', resize);
      cleanup = fresh.attachLiquidGlass(element);
      vi.runAllTimers();
      expect(resize, renderer ?? 'no WebGL').not.toHaveBeenCalled();
      expect(element.hasAttribute('data-liquid-glass')).toBe(false);
      cleanup();
    }
  });

  it('defers hidden surfaces, resizes their optical field, and releases hidden filters', () => {
    cleanup = attachLiquidGlass(element);
    notifyResize([], {} as ResizeObserver);
    vi.runAllTimers();
    expect(element.hasAttribute('data-liquid-glass')).toBe(false);
    expect(document.querySelector('filter')).toBeNull();
    show(true);
    expect(element.getAttribute('data-liquid-glass')).toBe('active');
    const firstFilter = document.querySelector('filter')!;
    expect(firstFilter.getAttribute('width')).toBe('180');
    width = 320;
    notifyResize([], {} as ResizeObserver);
    vi.runAllTimers();
    expect(firstFilter.isConnected).toBe(false);
    expect(document.querySelector('filter')?.getAttribute('width')).toBe('320');
    expect(document.querySelector('feImage')?.getAttribute('width')).toBe('320');
    show(false);
    expect(element.style.getPropertyValue('--liquid-glass-filter')).toBe('');
    expect(document.querySelector('[data-liquid-glass-defs]')).toBeNull();
  });

  it('does not light the enclosing panel when the pointer moves over flat header controls', () => {
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 100,
    } as DOMRect);
    const header = document.createElement('header');
    header.dataset.glassFlat = 'true';
    const button = document.createElement('button');
    header.append(button);
    element.append(header);
    cleanup = attachLiquidGlass(element, { refraction: false });
    element.dispatchEvent(new MouseEvent('pointermove', { clientX: 150, clientY: 25 }));
    // Cancel even a pending light frame when crossing into the flat header.
    button.dispatchEvent(
      new MouseEvent('pointermove', { bubbles: true, clientX: 30, clientY: 10 })
    );
    vi.runAllTimers();
    expect(element.style.getPropertyValue('--liquid-glass-light-x')).toBe('');
    expect(element.style.getPropertyValue('--liquid-glass-light-y')).toBe('');
  });

  it.each([
    '(prefers-reduced-transparency: reduce)',
    '(prefers-contrast: more)',
    '(forced-colors: active)',
  ])('removes and restores the optical effect when %s changes', (query) => {
    cleanup = attachLiquidGlass(element);
    show(true);
    setPreference(query, true);
    expect(element.hasAttribute('data-liquid-glass')).toBe(false);
    expect(document.querySelector('filter')).toBeNull();
    setPreference(query, false);
    expect(element.getAttribute('data-liquid-glass')).toBe('active');
    expect(document.querySelectorAll('filter')).toHaveLength(1);
    cleanup();
    expect(element.hasAttribute('data-liquid-glass')).toBe(false);
    expect(document.querySelector('[data-liquid-glass-defs]')).toBeNull();
    expect(preferenceListeners.size).toBe(0);
  });

  it('keeps native CSS fallback on Safari even when CSS.supports accepts filter URLs', () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 Version/18.0 Safari/605.1.15'
    );
    cleanup = attachLiquidGlass(element);
    vi.runAllTimers();
    expect(element.hasAttribute('data-liquid-glass')).toBe(false);
    expect(document.querySelector('filter')).toBeNull();
  });

  it('builds a single-pass SVG refraction filter with duplicated blur edges', () => {
    cleanup = attachLiquidGlass(element);
    show(true);
    const blurs = [...document.querySelectorAll('feGaussianBlur')];
    expect(blurs).toHaveLength(1);
    expect(blurs[0]!.getAttribute('edgeMode')).toBe('duplicate');
    expect(blurs[0]!.getAttribute('stdDeviation')).toBe('3');
    const displacements = [...document.querySelectorAll('feDisplacementMap')];
    expect(displacements).toHaveLength(1);
    expect(displacements[0]!.getAttribute('in')).toBe('softened');
    expect(displacements[0]!.getAttribute('in2')).toBe('displacement');
    expect(Number(displacements[0]!.getAttribute('scale'))).toBeGreaterThan(0);
    expect(document.querySelectorAll('feImage')).toHaveLength(1);
    expect(document.querySelectorAll('feColorMatrix')).toHaveLength(0);
    expect(document.querySelectorAll('feBlend')).toHaveLength(0);
  });

  it('tracks all four corner radii and parses elliptical pairs and percentages independently', () => {
    const toDataURL = vi.mocked(HTMLCanvasElement.prototype.toDataURL);
    const mountSurface = (radii: [string, string, string, string]) => {
      const node = document.createElement('div');
      [
        node.style.borderTopLeftRadius,
        node.style.borderTopRightRadius,
        node.style.borderBottomRightRadius,
        node.style.borderBottomLeftRadius,
      ] = radii;
      Object.defineProperties(node, {
        offsetWidth: { value: 180 },
        offsetHeight: { value: 80 },
      });
      document.body.append(node);
      const detach = attachLiquidGlass(node);
      notifyVisibility(
        [{ target: node, isIntersecting: true } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
      vi.runAllTimers();
      return () => {
        detach();
        node.remove();
      };
    };

    toDataURL.mockClear();
    const detachBase = mountSurface(['20px', '20px', '0px', '0px']);
    expect(toDataURL).toHaveBeenCalledTimes(1);

    // Elliptical "20px 10px" uses the leading 20px radius and hits the same map cache entry.
    const detachElliptical = mountSurface(['20px 10px', '20px', '0px', '0px']);
    expect(toDataURL).toHaveBeenCalledTimes(1);

    // Changing only a bottom corner via "%" produces a distinct cache key and displacement map.
    const detachPercent = mountSurface(['20px', '20px', '0px', '50%']);
    expect(toDataURL).toHaveBeenCalledTimes(2);

    detachPercent();
    detachElliptical();
    detachBase();
  });

  it('uses fractional ResizeObserver borderBoxSize rounded up to avoid right/bottom clipping', () => {
    const observe = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          notifyResize = callback;
        }

        observe = observe;

        disconnect() {}
      }
    );
    const toDataURL = vi.mocked(HTMLCanvasElement.prototype.toDataURL);
    cleanup = attachLiquidGlass(element);
    expect(observe).toHaveBeenCalledWith(element, { box: 'border-box' });
    const entry = {
      target: element,
      borderBoxSize: [{ inlineSize: 240.3, blockSize: 80.2 }],
    } as unknown as ResizeObserverEntry;
    notifyResize([entry], {} as ResizeObserver);
    show(true);
    expect(document.querySelector('filter')?.getAttribute('width')).toBe('241');
    expect(document.querySelector('filter')?.getAttribute('height')).toBe('81');
    expect(document.querySelector('feImage')?.getAttribute('width')).toBe('241');
    expect(document.querySelector('feImage')?.getAttribute('height')).toBe('81');

    toDataURL.mockClear();
    notifyResize([entry], {} as ResizeObserver);
    vi.runAllTimers();
    expect(toDataURL).not.toHaveBeenCalled();
  });

  it('shares one matchMedia watcher across surfaces and removes listeners on last detach', () => {
    const matchMediaSpy = vi.fn((query: string) => ({
      get matches() {
        return preferences.get(query) ?? false;
      },
      media: query,
      addEventListener: (_event: string, listener: () => void) => preferenceListeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) =>
        preferenceListeners.delete(listener),
    }));
    vi.stubGlobal('matchMedia', matchMediaSpy);

    const second = document.createElement('div');
    document.body.append(second);
    for (const node of [element, second]) {
      vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        width: 200,
        height: 100,
      } as DOMRect);
    }

    const detachFirst = attachLiquidGlass(element, { refraction: false });
    const detachSecond = attachLiquidGlass(second, { refraction: false });
    expect(matchMediaSpy).toHaveBeenCalledTimes(5);
    expect(preferenceListeners.size).toBe(1);

    element.dispatchEvent(new MouseEvent('pointermove', { clientX: 100, clientY: 50 }));
    second.dispatchEvent(new MouseEvent('pointermove', { clientX: 150, clientY: 25 }));
    vi.runAllTimers();
    expect(element.style.getPropertyValue('--liquid-glass-light-x')).toBe('50%');
    expect(second.style.getPropertyValue('--liquid-glass-light-x')).toBe('75%');

    setPreference('(prefers-reduced-motion: reduce)', true);
    expect(element.style.getPropertyValue('--liquid-glass-light-x')).toBe('');
    expect(second.style.getPropertyValue('--liquid-glass-light-x')).toBe('');

    detachFirst();
    expect(preferenceListeners.size).toBe(1);
    setPreference('(prefers-reduced-motion: reduce)', false);
    second.dispatchEvent(new MouseEvent('pointermove', { clientX: 150, clientY: 25 }));
    vi.runAllTimers();
    expect(second.style.getPropertyValue('--liquid-glass-light-x')).toBe('75%');

    detachSecond();
    expect(preferenceListeners.size).toBe(0);

    // Re-attaching after the last detach initializes a fresh watcher.
    cleanup = attachLiquidGlass(element, { refraction: false });
    expect(matchMediaSpy).toHaveBeenCalledTimes(10);
    expect(preferenceListeners.size).toBe(1);
    second.remove();
  });

  it('drops the stale filter during rapid resizes and rasterizes only once after settling', () => {
    const toDataURL = vi.mocked(HTMLCanvasElement.prototype.toDataURL);
    cleanup = attachLiquidGlass(element);
    show(true);
    toDataURL.mockClear();

    for (const nextWidth of [210, 230, 250, 275]) {
      width = nextWidth;
      notifyResize([], {} as ResizeObserver);
      vi.advanceTimersByTime(40);
      expect(element.hasAttribute('data-liquid-glass')).toBe(false);
      expect(document.querySelector('filter')).toBeNull();
      expect(toDataURL).not.toHaveBeenCalled();
    }

    vi.advanceTimersByTime(109);
    expect(document.querySelector('filter')).toBeNull();
    vi.runAllTimers();
    expect(element.getAttribute('data-liquid-glass')).toBe('active');
    expect(document.querySelector('filter')?.getAttribute('width')).toBe('275');
    expect(toDataURL).toHaveBeenCalledTimes(1);
  });

  it('keeps the active filter when ResizeObserver fires with unchanged dimensions', () => {
    const toDataURL = vi.mocked(HTMLCanvasElement.prototype.toDataURL);
    cleanup = attachLiquidGlass(element);
    show(true);
    const activeFilter = document.querySelector('filter');
    toDataURL.mockClear();

    notifyResize([], {} as ResizeObserver);
    vi.runAllTimers();

    expect(document.querySelector('filter')).toBe(activeFilter);
    expect(element.getAttribute('data-liquid-glass')).toBe('active');
    expect(toDataURL).not.toHaveBeenCalled();
  });

  it('skips pointer listeners and watchers on touch-only surfaces without refraction, and short-circuits touch pointermove', () => {
    preferences.set('(hover: none)', true);
    const addListener = vi.spyOn(element, 'addEventListener');
    cleanup = attachLiquidGlass(element, { refraction: false });
    expect(addListener).not.toHaveBeenCalled();
    expect(preferenceListeners.size).toBe(0);
    cleanup();

    preferences.set('(hover: none)', false);
    cleanup = attachLiquidGlass(element, { refraction: false });
    const child = document.createElement('span');
    element.append(child);
    const closestSpy = vi.spyOn(child, 'closest');
    const touchMove = new MouseEvent('pointermove', { bubbles: true, clientX: 20, clientY: 20 });
    Object.defineProperty(touchMove, 'pointerType', { value: 'touch' });
    child.dispatchEvent(touchMove);
    expect(closestSpy).not.toHaveBeenCalled();
  });
});
