// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { mockMedia, restoreMedia } from './__tests__/media';
import { hasCoarsePointer, prefersReducedMotion } from './tourMotion';

afterEach(restoreMedia);

describe('tourMotion', () => {
  it('answers no where the page cannot ask its media', () => {
    expect(prefersReducedMotion()).toBe(false);
    expect(hasCoarsePointer()).toBe(false);
  });

  it('follows the system for reduced motion and the pointer, each by itself', () => {
    mockMedia({ reducedMotion: true });
    expect(prefersReducedMotion()).toBe(true);
    expect(hasCoarsePointer()).toBe(false);

    mockMedia({ touch: true });
    expect(prefersReducedMotion()).toBe(false);
    expect(hasCoarsePointer()).toBe(true);
  });
});
