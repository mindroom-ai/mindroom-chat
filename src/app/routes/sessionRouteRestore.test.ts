import { describe, expect, it } from 'vitest';
import { getHomePath } from './pathUtils';
import { resolveSessionRestorePath } from './sessionRouteRestore';

describe('sessionRouteRestore', () => {
  it('restores valid in-app paths and falls back to home for invalid ones', () => {
    expect(resolveSessionRestorePath('/home/%23room%3Amindroom.chat?threadId=%24abc')).toBe(
      '/home/%23room%3Amindroom.chat?threadId=%24abc'
    );
    expect(resolveSessionRestorePath(undefined)).toBe(getHomePath());
    expect(resolveSessionRestorePath('')).toBe(getHomePath());
    expect(resolveSessionRestorePath('//evil.com')).toBe(getHomePath());
    expect(resolveSessionRestorePath('https://example.com/outside')).toBe(getHomePath());
  });
});
