// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { mockMedia, restoreMedia } from './__tests__/media';
import {
  hasCoarsePointer,
  hasNoHover,
  hasTouchCardActions,
  prefersReducedMotion,
} from './tourMotion';

afterEach(restoreMedia);

describe('tourMotion', () => {
  it('answers no where the page cannot ask its media', () => {
    expect(prefersReducedMotion()).toBe(false);
    expect(hasCoarsePointer()).toBe(false);
    expect(hasNoHover()).toBe(false);
    expect(hasTouchCardActions(false)).toBe(false);
    expect(hasTouchCardActions(true)).toBe(true);
  });

  it('follows the system for reduced motion, coarse pointer, and hover capability', () => {
    mockMedia({ reducedMotion: true });
    expect(prefersReducedMotion()).toBe(true);
    expect(hasCoarsePointer()).toBe(false);
    expect(hasNoHover()).toBe(false);

    mockMedia({ touch: true });
    expect(prefersReducedMotion()).toBe(false);
    expect(hasCoarsePointer()).toBe(true);
    expect(hasNoHover()).toBe(false);

    mockMedia({ noHover: true });
    expect(hasNoHover()).toBe(true);
    expect(hasTouchCardActions(false)).toBe(true);
  });
});
