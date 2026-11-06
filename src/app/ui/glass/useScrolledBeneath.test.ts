// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { SCROLLED_BENEATH_ATTRIBUTE, watchScrolledBeneath } from './useScrolledBeneath';

const scrollTo = (element: HTMLElement, top: number) => {
  element.scrollTop = top;
  element.dispatchEvent(new Event('scroll'));
};

afterEach(() => {
  document.body.replaceChildren();
});

describe('watchScrolledBeneath', () => {
  it('marks the title while its nearest scrolling ancestor is scrolled', () => {
    const outer = document.createElement('div');
    outer.style.overflowY = 'auto';
    const list = document.createElement('div');
    list.style.overflowY = 'scroll';
    const wrapper = document.createElement('div');
    const title = document.createElement('header');
    wrapper.append(title);
    list.append(wrapper);
    outer.append(list);
    document.body.append(outer);

    const stop = watchScrolledBeneath(title);
    expect(title.hasAttribute(SCROLLED_BENEATH_ATTRIBUTE)).toBe(false);
    scrollTo(outer, 40);
    expect(title.hasAttribute(SCROLLED_BENEATH_ATTRIBUTE)).toBe(false);
    scrollTo(list, 40);
    expect(title.hasAttribute(SCROLLED_BENEATH_ATTRIBUTE)).toBe(true);
    scrollTo(list, 0);
    expect(title.hasAttribute(SCROLLED_BENEATH_ATTRIBUTE)).toBe(false);

    scrollTo(list, 10);
    stop();
    expect(title.hasAttribute(SCROLLED_BENEATH_ATTRIBUTE)).toBe(false);
    scrollTo(list, 20);
    expect(title.hasAttribute(SCROLLED_BENEATH_ATTRIBUTE)).toBe(false);
  });

  it('starts marked when the list is already scrolled, and does nothing outside a list', () => {
    const list = document.createElement('div');
    list.style.overflowY = 'auto';
    const title = document.createElement('header');
    list.append(title);
    document.body.append(list);
    list.scrollTop = 30;
    watchScrolledBeneath(title);
    expect(title.hasAttribute(SCROLLED_BENEATH_ATTRIBUTE)).toBe(true);

    const loose = document.createElement('header');
    document.body.append(loose);
    watchScrolledBeneath(loose)();
    expect(loose.hasAttribute(SCROLLED_BENEATH_ATTRIBUTE)).toBe(false);
  });
});
