import { describe, expect, it } from 'vitest';
import { isInScrollView } from './dom';

describe('dom', () => {
  it('checks scrollTop in the scroll container coordinate space', () => {
    const scrollElement = {
      offsetHeight: 300,
      offsetTop: 200,
      scrollTop: 100,
    } as HTMLElement;
    const childElement = {
      offsetHeight: 50,
      offsetTop: 150,
    } as HTMLElement;

    expect(isInScrollView(scrollElement, childElement)).toBe(true);
  });

  it('still returns false when the child is above the visible scroll range', () => {
    const scrollElement = {
      offsetHeight: 300,
      offsetTop: 200,
      scrollTop: 100,
    } as HTMLElement;
    const childElement = {
      offsetHeight: 40,
      offsetTop: 20,
    } as HTMLElement;

    expect(isInScrollView(scrollElement, childElement)).toBe(false);
  });
});
