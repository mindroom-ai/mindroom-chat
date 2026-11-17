// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PopOut } from './directional';

// Folds' real placement (patches/folds+2.7.1.patch) of a phone's thread menu: a 440x956 viewport
// and the banner's kebab at x315 y190, 28px square.
const anchor = { x: 315, y: 190, width: 28, height: 28 };
let menuHeight = 357;

const surface = () => document.querySelector<HTMLElement>('[data-surface]')!.parentElement!;
// jsdom's style drops `unset` and `clamp()`, so the test records what folds writes to each side.
const SIDES = ['top', 'bottom', 'left', 'right'] as const;
let written = new WeakMap<CSSStyleDeclaration, Record<string, string>>();
const placed = () => written.get(surface().style);
const open = () =>
  render(
    <PopOut anchor={anchor} position="Bottom" align="End" offset={4} content={<div data-surface />}>
      <span />
    </PopOut>
  );

describe("folds' PopOut placement", () => {
  beforeEach(() => {
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(440);
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(956);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, 0, 280, menuHeight)
    );
    written = new WeakMap();
    for (const side of SIDES) {
      vi.spyOn(CSSStyleDeclaration.prototype, side, 'set').mockImplementation(function record(
        this: CSSStyleDeclaration,
        value: string
      ) {
        written.set(this, { ...written.get(this), [side]: value });
      });
    }
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('keeps the placement of a menu that fits below its trigger', () => {
    menuHeight = 357;
    open();
    expect(placed()).toEqual({
      top: '222px',
      bottom: 'unset',
      left: 'unset',
      right: '97px',
    });
  });

  it('clamps a menu too tall for either side of its trigger inside the safe area', () => {
    // Taller than the room below (734px) and above (186px) the trigger: folds sets no top or bottom.
    menuHeight = 893;
    open();
    expect(placed()).toEqual({
      top:
        'clamp(calc(env(safe-area-inset-top, 0px) + 0.5rem), -242.5px, ' +
        'calc(100% - env(safe-area-inset-bottom, 0px) - 0.5rem - 893px))',
      bottom: 'unset',
      // Beside the trigger on the left, as folds placed it.
      left: 'unset',
      right: '129px',
    });
  });
});
