// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { PointerEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOUSE_REST_HOLD_MS, usePointerOverCards } from './usePointerOverCards';

describe('usePointerOverCards', () => {
  const pointer = (pointerType: string) => ({ pointerType } as PointerEvent<HTMLElement>);

  it('lets a mouse go when it leaves', () => {
    const { result } = renderHook(() => usePointerOverCards());
    act(() => result.current.onPointerEnter());
    expect(result.current.pointerInside).toBe(true);
    act(() => result.current.onPointerLeave(pointer('mouse')));
    expect(result.current.pointerInside).toBe(false);
  });

  describe('a mouse at rest', () => {
    const mouse = (buttons = 0) => ({ pointerType: 'mouse', buttons } as PointerEvent<HTMLElement>);
    afterEach(() => {
      vi.useRealTimers();
    });

    it(`lets go once it rested ${MOUSE_REST_HOLD_MS} ms, and holds again at its next move`, () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => usePointerOverCards());
      act(() => result.current.onPointerEnter(mouse()));
      act(() => {
        vi.advanceTimersByTime(MOUSE_REST_HOLD_MS - 1);
      });
      act(() => result.current.onPointerMove(mouse()));
      act(() => {
        vi.advanceTimersByTime(MOUSE_REST_HOLD_MS - 1);
      });
      expect(result.current.pointerInside).toBe(true);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(result.current.pointerInside).toBe(false);

      act(() => result.current.onPointerMove(mouse()));
      expect(result.current.pointerInside).toBe(true);
    });

    it('holds through a press however long, and rests again from its release', () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => usePointerOverCards());
      act(() => result.current.onPointerEnter(mouse()));
      act(() => result.current.onPointerDown(mouse(1)));
      act(() => result.current.onPointerMove(mouse(1)));
      act(() => {
        vi.advanceTimersByTime(MOUSE_REST_HOLD_MS * 2);
      });
      expect(result.current.pointerInside).toBe(true);

      act(() => result.current.onPointerUp(mouse()));
      act(() => {
        vi.advanceTimersByTime(MOUSE_REST_HOLD_MS);
      });
      expect(result.current.pointerInside).toBe(false);
    });

    it('keeps a pen that came after the mouse held when the mouse has rested', () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => usePointerOverCards());
      act(() => result.current.onPointerMove(mouse()));
      act(() => result.current.onPointerEnter(pointer('pen')));
      act(() => {
        vi.advanceTimersByTime(MOUSE_REST_HOLD_MS * 2);
      });
      expect(result.current.pointerInside).toBe(true);
    });

    it('lets no finger go by time', () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => usePointerOverCards());
      act(() => result.current.onPointerEnter(pointer('touch')));
      act(() => {
        vi.advanceTimersByTime(MOUSE_REST_HOLD_MS * 2);
      });
      expect(result.current.pointerInside).toBe(true);
    });
  });

  it("holds a finger that lifted until its tap's click", () => {
    // A finger's pointer leaves as it lifts; the tap's mousedown, mouseup and click come after.
    const { result } = renderHook(() => usePointerOverCards());
    act(() => result.current.onPointerEnter());
    act(() => result.current.onPointerLeave(pointer('touch')));
    expect(result.current.pointerInside).toBe(true);
    act(() => {
      document.body.click();
    });
    expect(result.current.pointerInside).toBe(false);
  });

  it('holds from a press, which renders before the enter of the same tap may', () => {
    const { result } = renderHook(() => usePointerOverCards());
    act(() => result.current.onPointerDown());
    expect(result.current.pointerInside).toBe(true);
  });

  it('lets a finger go at once when it scrolled instead of tapping', () => {
    const { result } = renderHook(() => usePointerOverCards());
    act(() => result.current.onPointerEnter());
    act(() => result.current.onPointerCancel());
    act(() => result.current.onPointerLeave(pointer('touch')));
    expect(result.current.pointerInside).toBe(false);
  });

  it('stops waiting for a click once unmounted', () => {
    const { result, unmount } = renderHook(() => usePointerOverCards());
    act(() => result.current.onPointerEnter());
    act(() => result.current.onPointerLeave(pointer('touch')));
    unmount();
    expect(() => document.body.click()).not.toThrow();
  });
});
