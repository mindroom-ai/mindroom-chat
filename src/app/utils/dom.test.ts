import { afterEach, describe, expect, it, vi } from 'vitest';
import { isInScrollView, isIntersectingScrollView, pauseAllMediaElements } from './dom';

describe('dom', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('checks full containment using viewport-relative rectangles', () => {
    const scrollElement = {
      getBoundingClientRect: () => ({
        top: 200,
        bottom: 500,
      }),
    } as HTMLElement;
    const childElement = {
      getBoundingClientRect: () => ({
        top: 250,
        bottom: 300,
      }),
    } as HTMLElement;

    expect(isInScrollView(scrollElement, childElement)).toBe(true);
  });

  it('returns false when the child extends above the visible scroll range', () => {
    const scrollElement = {
      getBoundingClientRect: () => ({
        top: 200,
        bottom: 500,
      }),
    } as HTMLElement;
    const childElement = {
      getBoundingClientRect: () => ({
        top: 180,
        bottom: 220,
      }),
    } as HTMLElement;

    expect(isInScrollView(scrollElement, childElement)).toBe(false);
  });

  it('detects partial intersection using viewport-relative rectangles', () => {
    const scrollElement = {
      getBoundingClientRect: () => ({
        top: 200,
        bottom: 500,
      }),
    } as HTMLElement;
    const childElement = {
      getBoundingClientRect: () => ({
        top: 480,
        bottom: 540,
      }),
    } as HTMLElement;

    expect(isIntersectingScrollView(scrollElement, childElement)).toBe(true);
  });

  it('pauses all audio and video elements on the page', () => {
    const originalDocument = globalThis.document;
    const pauseAudio = vi.fn();
    const pauseVideo = vi.fn();

    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        querySelectorAll: vi.fn(() => [{ pause: pauseAudio }, { pause: pauseVideo }]),
      },
    });

    try {
      pauseAllMediaElements();

      expect(pauseAudio).toHaveBeenCalledOnce();
      expect(pauseVideo).toHaveBeenCalledOnce();
    } finally {
      if (originalDocument === undefined) {
        Reflect.deleteProperty(globalThis, 'document');
      } else {
        Object.defineProperty(globalThis, 'document', {
          configurable: true,
          value: originalDocument,
        });
      }
    }
  });
});
