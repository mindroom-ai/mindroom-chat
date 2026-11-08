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

/**
 * The farthest a box of `size` may sit from the viewport's top left corner and stay 8 px inside
 * it; a box bigger than the viewport keeps to the top left margin.
 */
function boundsFor(size: ViewportSize, viewport: ViewportSize): { maxX: number; maxY: number } {
  return {
    maxX: Math.max(WINDOW_MARGIN, viewport.width - size.width - WINDOW_MARGIN),
    maxY: Math.max(WINDOW_MARGIN, viewport.height - size.height - WINDOW_MARGIN),
  };
}

export function moveRect(
  start: WindowRect,
  dx: number,
  dy: number,
  viewport: ViewportSize
): WindowRect {
  const { maxX, maxY } = boundsFor(start, viewport);
  const x = stick(clamp(start.x + dx, WINDOW_MARGIN, maxX), WINDOW_MARGIN, maxX);
  const y = stick(clamp(start.y + dy, WINDOW_MARGIN, maxY), WINDOW_MARGIN, maxY);
  return { ...start, x, y };
}

// The most a window may take of the viewport, and the least it takes there unless it is the bar:
// a viewport smaller than the minimum gives it all it has.
const widest = (viewport: ViewportSize): number => viewport.width - 2 * WINDOW_MARGIN;
const narrowest = (viewport: ViewportSize): number => Math.min(MIN_WIDTH, widest(viewport));
const tallest = (viewport: ViewportSize): number =>
  Math.max(BAR_HEIGHT, viewport.height - 2 * WINDOW_MARGIN);
const shortest = (viewport: ViewportSize): number => Math.min(MIN_HEIGHT, tallest(viewport));

// Under BAR_THRESHOLD the window collapses to the bar. Above it the window is at least the
// minimum height and grows into the `room` on the side the edge moves to; where that room is
// short of the minimum, clampToViewport moves the window to the other side to make it.
function barAwareHeight(raw: number, room: number, viewport: ViewportSize): number {
  if (raw < BAR_THRESHOLD) return BAR_HEIGHT;
  const least = shortest(viewport);
  return clamp(raw, least, Math.max(room, least));
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
  const minWidth = narrowest(viewport);
  let { x, y, width, height } = start;
  if (edge.includes('e')) {
    width = clamp(start.width + dx, minWidth, viewport.width - WINDOW_MARGIN - start.x);
  }
  if (edge.includes('w')) {
    width = clamp(start.width - dx, minWidth, right - WINDOW_MARGIN);
    x = right - width;
  }
  if (edge.includes('s')) {
    height = barAwareHeight(start.height + dy, viewport.height - WINDOW_MARGIN - start.y, viewport);
  }
  if (edge.includes('n')) {
    height = barAwareHeight(start.height - dy, bottom - WINDOW_MARGIN, viewport);
    y = bottom - height;
  }
  return clampToViewport({ x, y, width, height }, viewport);
}

export function snapToCorner(rect: WindowRect, viewport: ViewportSize): WindowRect {
  const nearLeft = rect.x + rect.width / 2 < viewport.width / 2;
  const nearTop = rect.y + rect.height / 2 < viewport.height / 2;
  const { maxX, maxY } = boundsFor(rect, viewport);
  return { ...rect, x: nearLeft ? WINDOW_MARGIN : maxX, y: nearTop ? WINDOW_MARGIN : maxY };
}

/**
 * The one rule every box of the window ends with (a stored one, a resize, a step, Expand): the bar
 * is BAR_HEIGHT tall, any other box at least the minimum size, and all of it 8 px inside the
 * viewport, moved in where it reaches past an edge.
 */
export function clampToViewport(rect: WindowRect, viewport: ViewportSize): WindowRect {
  const width = clamp(rect.width, narrowest(viewport), widest(viewport));
  const height = isBar(rect)
    ? BAR_HEIGHT
    : clamp(rect.height, shortest(viewport), tallest(viewport));
  const { maxX, maxY } = boundsFor({ width, height }, viewport);
  const x = clamp(rect.x, WINDOW_MARGIN, maxX);
  const y = clamp(rect.y, WINDOW_MARGIN, maxY);
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
    if (horizontal) return resizeRect(rect, 'e', sign, 0, viewport);
    // A 16 px step cannot cross the bar threshold, so a height step at the bar or at the minimum jumps to the other state.
    if (sign > 0 && isBar(rect)) return clampToViewport({ ...rect, height: MIN_HEIGHT }, viewport);
    if (sign < 0 && rect.height <= MIN_HEIGHT && !isBar(rect))
      return { ...rect, height: BAR_HEIGHT };
    return resizeRect(rect, 's', 0, sign, viewport);
  }
  // Keyboard moves are plain steps: edge sticking would swallow a 16 px step near the margin.
  return clampToViewport(
    { ...rect, x: rect.x + (horizontal ? sign : 0), y: rect.y + (horizontal ? 0 : sign) },
    viewport
  );
}
