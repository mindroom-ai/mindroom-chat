// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installStatusBarTapScroll } from './statusBarTapScroll';

/** A scroll area scrolled `top` down, as jsdom lays nothing out. */
const area = (parent: HTMLElement, top: number, overflowY = 'auto'): HTMLElement => {
  const element = document.createElement('div');
  element.style.overflowY = overflowY;
  element.scrollTop = top;
  element.scrollTo = vi.fn((options?: ScrollToOptions | number) => {
    if (typeof options === 'object') element.scrollTop = options.top ?? element.scrollTop;
  }) as typeof element.scrollTo;
  parent.appendChild(element);
  return element;
};

const tapUnder = (hit: Element) => {
  document.elementFromPoint = () => hit;
  window.dispatchEvent(new Event('statusTap'));
};

describe('installStatusBarTapScroll', () => {
  let uninstall: (() => void) | undefined;
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    document.body.replaceChildren();
  });

  it('scrolls the scrolled area under the middle of the screen to its top, as a wheel turn up', () => {
    uninstall = installStatusBarTapScroll(window);
    const timeline = area(document.body, 900);
    const row = document.createElement('p');
    timeline.appendChild(row);
    const wheels: number[] = [];
    timeline.addEventListener('wheel', (event) => wheels.push(event.deltaY));

    tapUnder(row);

    expect(wheels).toEqual([-900]);
    expect(timeline.scrollTop).toBe(0);
  });

  it('passes over areas at their top and areas that do not scroll', () => {
    uninstall = installStatusBarTapScroll(window);
    const timeline = area(document.body, 400);
    const clipped = area(timeline, 50, 'hidden');
    const codeBlock = area(clipped, 0);

    tapUnder(codeBlock);

    expect(clipped.scrollTop).toBe(50);
    expect(timeline.scrollTop).toBe(0);
  });

  it('does nothing when nothing under the middle is scrolled, or once removed', () => {
    uninstall = installStatusBarTapScroll(window);
    const list = area(document.body, 0);
    tapUnder(list);
    expect(list.scrollTo).not.toHaveBeenCalled();

    list.scrollTop = 300;
    uninstall();
    uninstall = undefined;
    tapUnder(list);
    expect(list.scrollTop).toBe(300);
  });
});
