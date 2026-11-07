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

  it('stops a resize at the margin of the viewport', () => {
    expect(resizeRect(R, 'e', 5000, 0, VP).width).toBe(1440 - 8 - 500);
    expect(resizeRect(R, 'w', -5000, 0, VP).x).toBe(8);
  });

  it('turns into the 56 px bar under 120 px tall and grows back past it', () => {
    expect(resizeRect(R, 's', 0, -400, VP).height).toBe(56);
    expect(resizeRect(R, 's', 0, -300, VP).height).toBe(220);
    expect(resizeRect({ ...R, height: 56 }, 's', 0, 200, VP).height).toBe(256);
    expect(isBar({ ...R, height: 56 })).toBe(true);
    expect(isBar(R)).toBe(false);
  });

  it('keeps the bottom edge when the bar is resized from the top', () => {
    const next = resizeRect(R, 'n', 0, 400, VP);
    expect(next.height).toBe(56);
    expect(next.y + next.height).toBe(780);
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

  it('resizes 16 px per arrow with Shift, keeping the top left corner', () => {
    expect(keyStep(R, 'ArrowRight', true, VP)).toEqual({ ...R, width: 416 });
    expect(keyStep(R, 'ArrowLeft', true, VP)).toEqual({ ...R, width: 384 });
    expect(keyStep(R, 'ArrowDown', true, VP)).toEqual({ ...R, height: 496 });
    expect(keyStep(R, 'ArrowUp', true, VP)).toEqual({ ...R, height: 464 });
    expect(keyStep({ ...R, width: 340 }, 'ArrowLeft', true, VP).width).toBe(340);
    expect(keyStep({ ...R, height: 220 }, 'ArrowUp', true, VP).height).toBe(220);
  });
});
