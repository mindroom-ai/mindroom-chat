import { describe, expect, it } from 'vitest';
import {
  clampToViewport,
  defaultRect,
  fitToViewport,
  isBar,
  keyStep,
  moveRect,
  resizeRect,
  snapToCorner,
  type ResizeEdge,
  type WindowRect,
} from './callWindowGeometry';

const VP = { width: 1440, height: 900 };
const R: WindowRect = { x: 500, y: 300, width: 400, height: 480 };

describe('callWindowGeometry', () => {
  it('places the default window 16 px from the bottom and end edges', () => {
    expect(defaultRect(VP, false)).toEqual({ x: 1024, y: 404, width: 400, height: 480 });
    expect(defaultRect(VP, true)).toEqual({ x: 16, y: 404, width: 400, height: 480 });
  });

  it('keeps a moved window 8 px inside and sticks it to an edge within 16 px', () => {
    expect(moveRect(R, -2000, 0, VP).x).toBe(8);
    expect(moveRect(R, -480, 0, VP).x).toBe(8);
    expect(moveRect(R, -470, 0, VP).x).toBe(30);
    expect(moveRect(R, 0, 5000, VP).y).toBe(900 - 480 - 8);
    expect(moveRect(R, 5000, 0, VP).x).toBe(1440 - 400 - 8);
  });

  it.each(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const)(
    'resizes from %s and keeps the opposite edge',
    (edge: ResizeEdge) => {
      const next = resizeRect(
        R,
        edge,
        edge.includes('w') ? -50 : 50,
        edge.includes('n') ? -40 : 40,
        VP
      );
      const right = (r: WindowRect) => r.x + r.width;
      const bottom = (r: WindowRect) => r.y + r.height;
      if (edge.includes('e')) {
        expect(next.x).toBe(R.x);
        expect(next.width).toBe(450);
      }
      if (edge.includes('w')) {
        expect(right(next)).toBe(right(R));
        expect(next.width).toBe(450);
      }
      if (edge.includes('s')) {
        expect(next.y).toBe(R.y);
        expect(next.height).toBe(520);
      }
      if (edge.includes('n')) {
        expect(bottom(next)).toBe(bottom(R));
        expect(next.height).toBe(520);
      }
      if (!/[ew]/.test(edge)) expect(next.width).toBe(R.width);
      if (!/[ns]/.test(edge)) expect(next.height).toBe(R.height);
    }
  );

  it('never resizes below 340 px wide', () => {
    expect(resizeRect(R, 'w', 500, 0, VP).width).toBe(340);
    expect(resizeRect(R, 'e', -500, 0, VP).width).toBe(340);
  });

  it('grows from the other side once the dragged edge reaches the margin, up to the viewport', () => {
    // 532 px of room beyond the end edge, then 68 px from the start side.
    expect(resizeRect(R, 'e', 600, 0, VP)).toEqual({ ...R, x: 432, width: 1000 });
    expect(resizeRect(R, 'w', -600, 0, VP)).toEqual({ ...R, x: 8, width: 1000 });
    expect(resizeRect(R, 'e', 5000, 0, VP)).toEqual({ ...R, x: 8, width: 1424 });
    expect(resizeRect(R, 'w', -5000, 0, VP)).toEqual({ ...R, x: 8, width: 1424 });
  });

  it('turns into the 56 px bar under 120 px tall and grows back past it', () => {
    expect(resizeRect(R, 's', 0, -400, VP).height).toBe(56);
    expect(resizeRect(R, 's', 0, -300, VP).height).toBe(220);
    expect(resizeRect({ ...R, height: 56 }, 's', 0, 200, VP).height).toBe(256);
    expect(isBar({ ...R, height: 56 })).toBe(true);
    expect(isBar(R)).toBe(false);
  });

  it('switches to the bar exactly at 120 px tall', () => {
    expect(resizeRect(R, 's', 0, -361, VP).height).toBe(56);
    expect(resizeRect(R, 's', 0, -360, VP).height).toBe(220);
  });

  it('keeps the bottom edge when the bar is resized from the top', () => {
    const next = resizeRect(R, 'n', 0, 400, VP);
    expect(next.height).toBe(56);
    expect(next.y + next.height).toBe(780);
  });

  // A bar minimized at the bottom has 64 px below its top in this viewport; one at the top has
  // its own 56 px above its bottom.
  const lowBar: WindowRect = { x: 1024, y: 828, width: 400, height: 56 };
  const highBar: WindowRect = { x: 1024, y: 8, width: 400, height: 56 };

  it('grows a bar dragged past the threshold to the minimum, upward when there is no room below', () => {
    expect(resizeRect(lowBar, 's', 0, 70, VP)).toEqual({ ...lowBar, y: 672, height: 220 });
    expect(resizeRect(highBar, 'n', 0, -70, VP)).toEqual({ ...highBar, y: 8, height: 220 });
  });

  it('grows a bar against the bottom or the top once its edge is pulled past the margin, away from it', () => {
    // The pointer can go only a few px past the screen's edge, never the threshold's 64.
    const cornerBar = { ...lowBar, y: 836 };
    expect(resizeRect(cornerBar, 's', 0, 1, VP)).toEqual({ ...cornerBar, y: 672, height: 220 });
    expect(resizeRect(cornerBar, 'se', 0, 1, VP)).toEqual({ ...cornerBar, y: 672, height: 220 });
    // The minimized default bar has 8 px below it to the margin.
    expect(resizeRect(lowBar, 's', 0, 8, VP)).toEqual(lowBar);
    expect(resizeRect(lowBar, 's', 0, 9, VP)).toEqual({ ...lowBar, y: 672, height: 220 });
    expect(resizeRect(highBar, 'n', 0, -1, VP)).toEqual({ ...highBar, height: 220 });
    expect(resizeRect(highBar, 'nw', 0, -1, VP)).toEqual({ ...highBar, height: 220 });
    // A push the other way, or a pull with room for the threshold, keeps the bar.
    expect(resizeRect(cornerBar, 'n', 0, 4, VP)).toEqual(cornerBar);
    const midBar = { ...lowBar, y: 400 };
    expect(resizeRect(midBar, 's', 0, 4, VP)).toEqual(midBar);
    expect(resizeRect(midBar, 'n', 0, -4, VP)).toEqual(midBar);
    // A window that is no bar grows upward as its bottom edge passes the margin.
    const low = { ...R, y: 412 };
    expect(resizeRect(low, 's', 0, 4, VP)).toEqual({ ...low, y: 408, height: 484 });
  });

  it('grows a tall drag from the other side once the edge reaches the margin', () => {
    expect(resizeRect(R, 's', 0, 200, VP)).toEqual({ ...R, y: 212, height: 680 });
    expect(resizeRect(R, 'n', 0, -400, VP)).toEqual({ ...R, y: 8, height: 880 });
    expect(resizeRect(R, 's', 0, 5000, VP)).toEqual({ ...R, y: 8, height: 884 });
  });

  it('grows a bar with Shift and the down arrow upward when there is no room below', () => {
    expect(keyStep(lowBar, 'ArrowDown', true, VP)).toEqual({ ...lowBar, y: 672, height: 220 });
  });

  it('gives a stored window at least the minimum size, or the bar height when it is a bar', () => {
    expect(clampToViewport({ x: 100, y: 100, width: 1, height: 1 }, VP)).toEqual({
      x: 100,
      y: 100,
      width: 340,
      height: 56,
    });
    expect(clampToViewport({ x: 100, y: 100, width: 400, height: 100 }, VP)).toEqual({
      x: 100,
      y: 100,
      width: 400,
      height: 220,
    });
    expect(clampToViewport({ ...lowBar, height: 100 }, VP)).toEqual({
      ...lowBar,
      y: 672,
      height: 220,
    });
    // A viewport too small for the minimum gives the window all it has.
    expect(
      clampToViewport({ x: 8, y: 8, width: 1, height: 100 }, { width: 300, height: 200 })
    ).toEqual({ x: 8, y: 8, width: 284, height: 184 });
  });

  it('drops a bar into the nearest corner', () => {
    const bar = { x: 100, y: 100, width: 400, height: 56 };
    expect(snapToCorner(bar, VP)).toEqual({ x: 8, y: 8, width: 400, height: 56 });
    const low = { x: 900, y: 700, width: 400, height: 56 };
    expect(snapToCorner(low, VP)).toEqual({
      x: 1440 - 400 - 8,
      y: 900 - 56 - 8,
      width: 400,
      height: 56,
    });
  });

  it('keeps a dropped bar 8 px inside even when it is wider or taller than the viewport', () => {
    const wide = { x: 100, y: 700, width: 1500, height: 56 };
    expect(snapToCorner(wide, VP)).toEqual({ x: 8, y: 900 - 56 - 8, width: 1500, height: 56 });
    const tall = { x: 900, y: 100, width: 400, height: 1000 };
    expect(snapToCorner(tall, VP)).toEqual({ x: 1440 - 400 - 8, y: 8, width: 400, height: 1000 });
  });

  it('fits a stored rectangle from a bigger screen inside the viewport', () => {
    expect(clampToViewport({ x: 2400, y: 1300, width: 3000, height: 2000 }, VP)).toEqual({
      x: 8,
      y: 8,
      width: 1424,
      height: 884,
    });
  });

  it('keeps the distance to the nearer edges when the viewport changes', () => {
    expect(
      fitToViewport({ x: 1024, y: 404, width: 400, height: 480 }, VP, { width: 1000, height: 700 })
    ).toEqual({
      x: 584,
      y: 204,
      width: 400,
      height: 480,
    });
    const left = { x: 20, y: 30, width: 400, height: 480 };
    expect(fitToViewport(left, VP, { width: 1000, height: 700 })).toEqual({
      x: 20,
      y: 30,
      width: 400,
      height: 480,
    });
  });

  it('shrinks to the viewport less the margins when the viewport is smaller than the window', () => {
    expect(fitToViewport(R, VP, { width: 300, height: 200 })).toEqual({
      x: 8,
      y: 8,
      width: 284,
      height: 184,
    });
  });

  it('moves 16 px per arrow, inside the viewport', () => {
    expect(keyStep(R, 'ArrowLeft', false, VP)).toEqual({ ...R, x: 484 });
    expect(keyStep(R, 'ArrowRight', false, VP)).toEqual({ ...R, x: 516 });
    expect(keyStep(R, 'ArrowUp', false, VP)).toEqual({ ...R, y: 284 });
    expect(keyStep(R, 'ArrowDown', false, VP)).toEqual({ ...R, y: 316 });
    expect(keyStep({ ...R, x: 10 }, 'ArrowLeft', false, VP).x).toBe(8);
  });

  it('grows a window at the default place with Shift and the right or down arrow, moving it in', () => {
    const start = defaultRect(VP, false);
    const wider = keyStep(start, 'ArrowRight', true, VP);
    expect(wider).toEqual({ ...start, x: 1016, width: 416 });
    expect(keyStep(wider, 'ArrowRight', true, VP)).toEqual({ ...start, x: 1000, width: 432 });
    const taller = keyStep(start, 'ArrowDown', true, VP);
    expect(taller).toEqual({ ...start, y: 396, height: 496 });
    expect(keyStep(taller, 'ArrowDown', true, VP)).toEqual({ ...start, y: 380, height: 512 });
    // Shrinking moves only the end or bottom edge.
    expect(keyStep(wider, 'ArrowLeft', true, VP)).toEqual({ ...start, x: 1016 });
    expect(keyStep(taller, 'ArrowUp', true, VP)).toEqual({ ...start, y: 396 });
  });

  it('resizes 16 px per arrow with Shift, keeping the top left corner', () => {
    expect(keyStep(R, 'ArrowRight', true, VP)).toEqual({ ...R, width: 416 });
    expect(keyStep(R, 'ArrowLeft', true, VP)).toEqual({ ...R, width: 384 });
    expect(keyStep(R, 'ArrowDown', true, VP)).toEqual({ ...R, height: 496 });
    expect(keyStep(R, 'ArrowUp', true, VP)).toEqual({ ...R, height: 464 });
    expect(keyStep({ ...R, width: 340 }, 'ArrowLeft', true, VP).width).toBe(340);
    expect(keyStep({ ...R, height: 56 }, 'ArrowDown', true, VP)).toEqual({ ...R, height: 220 });
    expect(keyStep({ ...R, height: 220 }, 'ArrowUp', true, VP)).toEqual({ ...R, height: 56 });
  });
});
