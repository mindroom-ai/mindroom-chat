// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PopOut } from './directional';

// Folds' real placement (patches/folds+2.7.3.patch) on a 440x956 phone viewport.
const threadAnchor = { x: 315, y: 190, width: 28, height: 28 };
let menuWidth = 280;
let menuHeight = 357;

const clampY = (preferred: number, height: number) =>
  `clamp(min(calc(var(--app-inset-top, env(safe-area-inset-top, 0px)) + 0.5rem), max(0px, calc(100% - ${height}px))), ${preferred}px, calc(100% - env(safe-area-inset-bottom, 0px) - 0.5rem - ${height}px))`;

const clampX = (preferred: number, width: number) =>
  `clamp(min(calc(env(safe-area-inset-left, 0px) + 0.5rem), max(0px, calc(100% - ${width}px))), ${preferred}px, calc(100% - env(safe-area-inset-right, 0px) - 0.5rem - ${width}px))`;

const surface = () => document.querySelector<HTMLElement>('[data-surface]')!.parentElement!;
const placed = () => {
  const { top, bottom, left, right } = surface().style;
  return { top, bottom, left, right };
};
const open = (anchor = threadAnchor) =>
  render(
    <PopOut anchor={anchor} position="Bottom" align="End" offset={4} content={<div data-surface />}>
      <span />
    </PopOut>
  );

describe("folds' PopOut placement", () => {
  beforeEach(() => {
    menuWidth = 280;
    menuHeight = 357;
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(440);
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(956);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, 0, menuWidth, menuHeight)
    );
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('clamps a menu that fits below its trigger while preserving its preferred coordinates', () => {
    open();
    expect(placed()).toEqual({
      top: clampY(222, 357),
      bottom: 'unset',
      left: clampX(63, 280),
      right: 'unset',
    });
  });

  it('clamps a phone sub-space options menu clear of the top safe area even when folds fits it inside [0, clientHeight]', () => {
    // Cannot fit below y=520, so folds falls back to positionLeft + alignYEnd (preferred top = 4px).
    menuWidth = 220;
    menuHeight = 540;
    open({ x: 335, y: 520, width: 24, height: 24 });
    const style = placed();
    expect(style.top).toContain('var(--app-inset-top, env(safe-area-inset-top, 0px)) + 0.5rem');
    expect(style).toEqual({
      top: clampY(4, 540),
      bottom: 'unset',
      left: clampX(111, 220),
      right: 'unset',
    });
  });

  it('clamps a menu whose bottom lands inside the bottom safe area even when from + size <= clientHeight', () => {
    // Opens below the trigger at y=390 with height=540 (bottom 930 <= 956, inside a 34px bottom inset).
    menuWidth = 220;
    menuHeight = 540;
    open({ x: 335, y: 362, width: 24, height: 24 });
    const style = placed();
    expect(style.top).toContain('env(safe-area-inset-bottom, 0px)');
    expect(style).toEqual({
      top: clampY(390, 540),
      bottom: 'unset',
      left: clampX(139, 220),
      right: 'unset',
    });
  });

  it('clamps a menu too tall for either side of its trigger inside the safe area', () => {
    // Taller than the room below (734px) and above (186px) the trigger: folds sets no top or bottom.
    menuHeight = 893;
    open();
    expect(placed()).toEqual({
      top: clampY(-242.5, 893),
      bottom: 'unset',
      // Beside the trigger on the left (right=129px -> left=31px), clamped horizontally too.
      left: clampX(31, 280),
      right: 'unset',
    });
  });
});
