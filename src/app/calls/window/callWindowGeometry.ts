export type WindowRect = { x: number; y: number; width: number; height: number };
export type ViewportSize = { width: number; height: number };
export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const WINDOW_MARGIN = 8;
export const EDGE_STICK = 16;
export const MIN_WIDTH = 340;
export const MIN_HEIGHT = 220;
export const BAR_HEIGHT = 56;
export const BAR_THRESHOLD = 120;
export const KEY_STEP = 16;
export const DEFAULT_WIDTH = 400;
export const DEFAULT_HEIGHT = 480;
export const DEFAULT_OFFSET = 16;

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(value, high));

// A position that lands within EDGE_STICK of the margin line snaps onto it, so the window docks without precise aim.
const stick = (value: number, low: number, high: number): number => {
  if (value - low <= EDGE_STICK) return low;
  if (high - value <= EDGE_STICK) return high;
  return value;
};

export function defaultRect(viewport: ViewportSize, rtl: boolean): WindowRect {
  const x = rtl ? DEFAULT_OFFSET : viewport.width - DEFAULT_WIDTH - DEFAULT_OFFSET;
  const y = viewport.height - DEFAULT_HEIGHT - DEFAULT_OFFSET;
  return { x, y, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
}

export function isBar(rect: WindowRect): boolean {
  return rect.height <= BAR_HEIGHT;
}

export function moveRect(
  start: WindowRect,
  dx: number,
  dy: number,
  viewport: ViewportSize
): WindowRect {
  const maxX = Math.max(WINDOW_MARGIN, viewport.width - start.width - WINDOW_MARGIN);
  const maxY = Math.max(WINDOW_MARGIN, viewport.height - start.height - WINDOW_MARGIN);
  const x = stick(clamp(start.x + dx, WINDOW_MARGIN, maxX), WINDOW_MARGIN, maxX);
  const y = stick(clamp(start.y + dy, WINDOW_MARGIN, maxY), WINDOW_MARGIN, maxY);
  return { ...start, x, y };
}

// Under BAR_THRESHOLD the window collapses to the bar; between that and MIN_HEIGHT it stays at the minimum.
function barAwareHeight(raw: number, space: number): number {
  if (raw < BAR_THRESHOLD) return BAR_HEIGHT;
  if (raw < MIN_HEIGHT) return Math.min(MIN_HEIGHT, Math.max(space, BAR_HEIGHT));
  return Math.min(raw, Math.max(space, BAR_HEIGHT));
}

export function resizeRect(
  start: WindowRect,
  edge: ResizeEdge,
  dx: number,
  dy: number,
  viewport: ViewportSize
): WindowRect {
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  const minWidth = Math.min(MIN_WIDTH, viewport.width - 2 * WINDOW_MARGIN);
  let { x, y, width, height } = start;
  if (edge.includes('e')) {
    width = clamp(start.width + dx, minWidth, viewport.width - WINDOW_MARGIN - start.x);
  }
  if (edge.includes('w')) {
    width = clamp(start.width - dx, minWidth, right - WINDOW_MARGIN);
    x = right - width;
  }
  if (edge.includes('s')) {
    height = barAwareHeight(start.height + dy, viewport.height - WINDOW_MARGIN - start.y);
  }
  if (edge.includes('n')) {
    height = barAwareHeight(start.height - dy, bottom - WINDOW_MARGIN);
    y = bottom - height;
  }
  return { x, y, width, height };
}

export function snapToCorner(rect: WindowRect, viewport: ViewportSize): WindowRect {
  const nearLeft = rect.x + rect.width / 2 < viewport.width / 2;
  const nearTop = rect.y + rect.height / 2 < viewport.height / 2;
  return {
    ...rect,
    x: nearLeft ? WINDOW_MARGIN : viewport.width - rect.width - WINDOW_MARGIN,
    y: nearTop ? WINDOW_MARGIN : viewport.height - rect.height - WINDOW_MARGIN,
  };
}

export function clampToViewport(rect: WindowRect, viewport: ViewportSize): WindowRect {
  const width = Math.min(rect.width, viewport.width - 2 * WINDOW_MARGIN);
  const height = Math.max(BAR_HEIGHT, Math.min(rect.height, viewport.height - 2 * WINDOW_MARGIN));
  const x = clamp(
    rect.x,
    WINDOW_MARGIN,
    Math.max(WINDOW_MARGIN, viewport.width - width - WINDOW_MARGIN)
  );
  const y = clamp(
    rect.y,
    WINDOW_MARGIN,
    Math.max(WINDOW_MARGIN, viewport.height - height - WINDOW_MARGIN)
  );
  return { x, y, width, height };
}

// Each axis keeps the distance to the edge the window's centre was nearer to, so a docked window stays docked.
export function fitToViewport(
  rect: WindowRect,
  previous: ViewportSize,
  next: ViewportSize
): WindowRect {
  const nearEnd = (start: number, size: number, span: number): boolean =>
    start + size / 2 >= span / 2;
  const x = nearEnd(rect.x, rect.width, previous.width)
    ? next.width - (previous.width - rect.x - rect.width) - rect.width
    : rect.x;
  const y = nearEnd(rect.y, rect.height, previous.height)
    ? next.height - (previous.height - rect.y - rect.height) - rect.height
    : rect.y;
  return clampToViewport({ ...rect, x, y }, next);
}

export function keyStep(
  rect: WindowRect,
  key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
  resize: boolean,
  viewport: ViewportSize
): WindowRect {
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
  const sign = key === 'ArrowLeft' || key === 'ArrowUp' ? -KEY_STEP : KEY_STEP;
  if (resize) {
    return horizontal
      ? resizeRect(rect, 'e', sign, 0, viewport)
      : resizeRect(rect, 's', 0, sign, viewport);
  }
  // Keyboard moves are plain steps: edge sticking would swallow a 16 px step near the margin.
  return clampToViewport(
    { ...rect, x: rect.x + (horizontal ? sign : 0), y: rect.y + (horizontal ? 0 : sign) },
    viewport
  );
}
