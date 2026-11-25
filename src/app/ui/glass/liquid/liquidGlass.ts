import { type CornerRadii, createDisplacementMap } from './displacement';

const SVG_NS = 'http://www.w3.org/2000/svg';
const RESIZE_SETTLE_MS = 150;
const PREFERENCE_QUERIES = [
  '(prefers-reduced-transparency: reduce)',
  '(prefers-contrast: more)',
  '(forced-colors: active)',
  '(prefers-reduced-motion: reduce)',
] as const;
const mapCache = new Map<string, { url: string; scale: number }>();
const roots = new WeakMap<Document, SVGSVGElement>();
const preferenceWatchers = new WeakMap<
  Window,
  { queries: MediaQueryList[]; listeners: Set<() => void>; onChange: () => void }
>();
let nextId = 0;

const watchPreferences = (view: Window, listener: () => void) => {
  let watcher = preferenceWatchers.get(view);
  if (!watcher) {
    const listeners = new Set<() => void>();
    const onChange = () => {
      listeners.forEach((notify) => notify());
    };
    const queries = PREFERENCE_QUERIES.map((query) => view.matchMedia(query));
    queries.forEach((query) => query.addEventListener?.('change', onChange));
    watcher = { queries, listeners, onChange };
    preferenceWatchers.set(view, watcher);
  }
  watcher.listeners.add(listener);
  const activeWatcher = watcher;
  return {
    permitsTransparency: () => !activeWatcher.queries.slice(0, 3).some((query) => query.matches),
    permitsMotion: () => !activeWatcher.queries.some((query) => query.matches),
    unsubscribe: () => {
      if (!activeWatcher.listeners.delete(listener) || activeWatcher.listeners.size > 0) return;
      activeWatcher.queries.forEach((query) =>
        query.removeEventListener?.('change', activeWatcher.onChange)
      );
      preferenceWatchers.delete(view);
    },
  };
};

const parseCornerRadii = (
  style: CSSStyleDeclaration,
  width: number,
  height: number
): CornerRadii => {
  const maxRadius = Math.max(width, height);
  const parse = (value: string) => {
    const token = value.trim().split(/\s+/)[0] ?? '';
    const parsed = token.endsWith('%')
      ? (Math.min(width, height) * parseFloat(token)) / 100
      : parseFloat(token);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(Math.min(maxRadius, parsed)) : 0;
  };
  return [
    parse(style.borderTopLeftRadius),
    parse(style.borderTopRightRadius),
    parse(style.borderBottomRightRadius),
    parse(style.borderBottomLeftRadius),
  ];
};

const svgElement = <K extends keyof SVGElementTagNameMap>(
  document: Document,
  tag: K,
  attributes: Record<string, string>
): SVGElementTagNameMap[K] => {
  const element = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
  return element;
};

const getMap = (document: Document, width: number, height: number, radii: CornerRadii) => {
  const key = `${width}:${height}:${radii.join(',')}`;
  const cached = mapCache.get(key);
  if (cached) {
    mapCache.delete(key);
    mapCache.set(key, cached);
    return cached;
  }
  const map = createDisplacementMap(width, height, radii);
  if (!map) return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = map.width;
  canvas.height = map.height;
  const context = canvas.getContext('2d');
  if (!context) return undefined;
  const pixels = context.createImageData(map.width, map.height);
  pixels.data.set(map.data);
  context.putImageData(pixels, 0, 0);
  const entry = { url: canvas.toDataURL('image/png'), scale: map.scale };
  mapCache.set(key, entry);
  if (mapCache.size > 32) mapCache.delete(mapCache.keys().next().value as string);
  return entry;
};

const createFilter = (document: Document, width: number, height: number, radii: CornerRadii) => {
  const map = getMap(document, width, height, radii);
  if (!map) return undefined;
  let root = roots.get(document);
  if (!root) {
    root = svgElement(document, 'svg', {
      'aria-hidden': 'true',
      'data-liquid-glass-defs': '',
      width: '0',
      height: '0',
      style: 'position:fixed;pointer-events:none;overflow:hidden',
    });
    document.body.append(root);
    roots.set(document, root);
  }
  const id = `liquid-glass-${nextId++}`;
  const filter = svgElement(document, 'filter', {
    id,
    filterUnits: 'userSpaceOnUse',
    primitiveUnits: 'userSpaceOnUse',
    x: '0',
    y: '0',
    width: String(width),
    height: String(height),
    'color-interpolation-filters': 'sRGB',
  });
  filter.append(
    svgElement(document, 'feGaussianBlur', {
      in: 'SourceGraphic',
      stdDeviation: '3',
      edgeMode: 'duplicate',
      result: 'softened',
    }),
    svgElement(document, 'feImage', {
      href: map.url,
      x: '0',
      y: '0',
      width: String(width),
      height: String(height),
      preserveAspectRatio: 'none',
      result: 'displacement',
    }),
    svgElement(document, 'feDisplacementMap', {
      in: 'softened',
      in2: 'displacement',
      scale: String(map.scale),
      xChannelSelector: 'R',
      yChannelSelector: 'G',
    })
  );
  root.append(filter);
  const svgRoot = root;
  return {
    id,
    remove: () => {
      filter.remove();
      if (!svgRoot.childElementCount) {
        svgRoot.remove();
        roots.delete(document);
      }
    },
  };
};

let drawsOnGpu: boolean | undefined;

/**
 * Whether the page draws on a GPU. Without one, Chromium runs the SVG filter on the CPU for
 * every frame that changes anything inside the glass, tens of milliseconds a frame (each key
 * typed in a glass dialog), so the page keeps the native blur. WebGL names the renderer: no
 * WebGL, or a software one such as SwiftShader or llvmpipe, means no GPU.
 */
const hasGpu = (document: Document): boolean => {
  if (drawsOnGpu !== undefined) return drawsOnGpu;
  const gl = document.createElement('canvas').getContext('webgl');
  let renderer = '';
  try {
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && info) renderer = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    // Without the extensions the renderer stays unknown, and the effect stays on.
  }
  drawsOnGpu = !!gl && !/swiftshader|llvmpipe|softpipe|software/i.test(renderer);
  return drawsOnGpu;
};

/** Owns only the optical effect. Layout, tint, borders and states stay in CSS. */
export const attachLiquidGlass = (
  element: HTMLElement,
  { refraction = true }: { refraction?: boolean } = {}
): (() => void) => {
  const document = element.ownerDocument;
  const view = document.defaultView;
  if (
    !view ||
    typeof view.requestAnimationFrame !== 'function' ||
    typeof view.matchMedia !== 'function'
  )
    return () => {};

  // CSS.supports accepts SVG filter URLs in engines that do not render them
  // as backdrop filters. Keep native blur on WebKit (including iOS) and Gecko.
  const supportsRefraction =
    refraction &&
    /(?:Chrome|Chromium)\/\d/.test(view.navigator.userAgent) &&
    typeof ResizeObserver === 'function' &&
    typeof IntersectionObserver === 'function' &&
    typeof CSS !== 'undefined' &&
    CSS.supports('backdrop-filter', 'url("#liquid-glass")') &&
    hasGpu(document);
  let disposed = false;
  let visible = false;
  let filter: ReturnType<typeof createFilter>;
  let dimensions = '';
  let activeWidth = 0;
  let activeHeight = 0;
  let observedSize: { width: number; height: number } | undefined;
  let mapFrame = 0;
  let resizeTimer: number | undefined;
  let lightFrame = 0;
  let pointerX = 0;
  let pointerY = 0;
  const measure = () =>
    observedSize ?? { width: element.offsetWidth, height: element.offsetHeight };

  const cancelResizeTimer = () => {
    view.clearTimeout(resizeTimer);
    resizeTimer = undefined;
  };
  const clearFilter = () => {
    if (mapFrame) {
      view.cancelAnimationFrame(mapFrame);
      mapFrame = 0;
    }
    if (!filter) return;
    element.style.removeProperty('--liquid-glass-filter');
    element.removeAttribute('data-liquid-glass');
    filter.remove();
    filter = undefined;
    dimensions = '';
    activeWidth = 0;
    activeHeight = 0;
  };
  const clearLight = () => {
    view.cancelAnimationFrame(lightFrame);
    lightFrame = 0;
    element.style.removeProperty('--liquid-glass-light-x');
    element.style.removeProperty('--liquid-glass-light-y');
  };
  const updateMap = () => {
    mapFrame = 0;
    if (disposed || !visible || !preferences.permitsTransparency()) {
      clearFilter();
      return;
    }
    const { width, height } = measure();
    if (width <= 0 || height <= 0) {
      clearFilter();
      return;
    }
    const radii = parseCornerRadii(view.getComputedStyle(element), width, height);
    const key = `${width}:${height}:${radii.join(',')}`;
    if (dimensions === key) return;
    // A lost/blocked canvas or an unsupported SVG path must leave usable CSS glass.
    try {
      const nextFilter = createFilter(document, width, height, radii);
      clearFilter();
      filter = nextFilter;
      if (!filter) return;
      dimensions = key;
      activeWidth = width;
      activeHeight = height;
      element.style.setProperty('--liquid-glass-filter', `url("#${filter.id}")`);
      element.setAttribute('data-liquid-glass', 'active');
    } catch {
      clearFilter();
    }
  };
  const queueMap = () => {
    if (!mapFrame && supportsRefraction && !disposed)
      mapFrame = view.requestAnimationFrame(updateMap);
  };
  const onResize = (entries: ResizeObserverEntry[]) => {
    if (disposed) return;
    const sizes: unknown = entries[entries.length - 1]?.borderBoxSize;
    const rawBox = Array.isArray(sizes) ? sizes[0] : sizes;
    const box =
      rawBox && typeof rawBox === 'object' && 'inlineSize' in rawBox && 'blockSize' in rawBox
        ? (rawBox as ResizeObserverSize)
        : undefined;
    observedSize =
      box && Number.isFinite(box.inlineSize) && Number.isFinite(box.blockSize)
        ? { width: Math.ceil(box.inlineSize), height: Math.ceil(box.blockSize) }
        : undefined;
    if (!visible || !preferences.permitsTransparency()) return;
    const { width, height } = measure();
    if (width <= 0 || height <= 0) {
      cancelResizeTimer();
      clearFilter();
      return;
    }
    if (resizeTimer === undefined && filter && width === activeWidth && height === activeHeight)
      return;
    if (!filter && resizeTimer === undefined) {
      queueMap();
      return;
    }
    // Intentionally drop the SVG refraction filter during continuous resize so CSS native blur
    // fills in without per-frame displacement-map PNG/GPU work, then rebuild once settled.
    clearFilter();
    cancelResizeTimer();
    resizeTimer = view.setTimeout(() => {
      resizeTimer = undefined;
      queueMap();
    }, RESIZE_SETTLE_MS);
  };
  const onPreferenceChange = () => {
    if (disposed) return;
    if (!preferences.permitsMotion()) clearLight();
    if (!preferences.permitsTransparency()) {
      cancelResizeTimer();
      clearFilter();
      return;
    }
    if (resizeTimer === undefined) queueMap();
  };
  const preferences = watchPreferences(view, onPreferenceChange);
  const onPointerMove = (event: PointerEvent) => {
    // Flat scrolling chrome must not move the light on its enclosing glass panel either.
    if (event.target instanceof Element && event.target.closest('[data-glass-flat="true"]')) {
      clearLight();
      return;
    }
    if (!preferences.permitsMotion() || event.pointerType === 'touch') return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (lightFrame) return;
    lightFrame = view.requestAnimationFrame(() => {
      lightFrame = 0;
      if (disposed || !preferences.permitsMotion()) return;
      const bounds = element.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      const x = Math.max(0, Math.min(100, ((pointerX - bounds.left) / bounds.width) * 100));
      const y = Math.max(0, Math.min(100, ((pointerY - bounds.top) / bounds.height) * 100));
      element.style.setProperty('--liquid-glass-light-x', `${x}%`);
      element.style.setProperty('--liquid-glass-light-y', `${y}%`);
    });
  };
  const resizeObserver = supportsRefraction ? new ResizeObserver(onResize) : undefined;
  const intersectionObserver = supportsRefraction
    ? new IntersectionObserver((entries) => {
        if (disposed) return;
        visible = entries.some((entry) => entry.isIntersecting);
        if (visible) {
          if (resizeTimer === undefined) queueMap();
        } else {
          cancelResizeTimer();
          clearFilter();
        }
      })
    : undefined;
  resizeObserver?.observe(element);
  intersectionObserver?.observe(element);
  element.addEventListener('pointermove', onPointerMove, { passive: true });
  element.addEventListener('pointerleave', clearLight);
  element.addEventListener('pointercancel', clearLight);

  return () => {
    disposed = true;
    cancelResizeTimer();
    clearLight();
    clearFilter();
    resizeObserver?.disconnect();
    intersectionObserver?.disconnect();
    preferences.unsubscribe();
    element.removeEventListener('pointermove', onPointerMove);
    element.removeEventListener('pointerleave', clearLight);
    element.removeEventListener('pointercancel', clearLight);
  };
};
