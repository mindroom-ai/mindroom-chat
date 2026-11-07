// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { hasOpenOverlay } from './openOverlay';

const add = (html: string): HTMLElement => {
  const element = document.createElement('div');
  element.innerHTML = html;
  document.body.append(element);
  return element;
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('hasOpenOverlay', () => {
  it('sees a menu that portals into the body', () => {
    expect(hasOpenOverlay()).toBe(false);
    add('<div role="menu"></div>');
    expect(hasOpenOverlay()).toBe(true);
  });

  it('leaves out one in an inert page and the asking layer itself', () => {
    add('<div inert><div role="listbox"></div></div>');
    expect(hasOpenOverlay()).toBe(false);
    const sheet = add('<div role="dialog"><ul role="listbox"></ul></div>');
    expect(hasOpenOverlay(sheet)).toBe(false);
    expect(hasOpenOverlay()).toBe(true);
  });
});
