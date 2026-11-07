// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { type RoomPanel, useRoomPanels } from './roomPanels';

/** Panels a, b and c in that order, with `open` and `options` per panel. */
const panelsOf = (
  open: Record<string, boolean>,
  options: Record<string, Partial<RoomPanel>> = {}
): RoomPanel[] =>
  ['a', 'b', 'c'].map((id) => ({ id, open: !!open[id], close: vi.fn(), ...options[id] }));

const closed = (panels: RoomPanel[]) =>
  panels.filter((panel) => vi.mocked(panel.close).mock.calls.length > 0).map((panel) => panel.id);

describe('useRoomPanels', () => {
  it('shows the first open panel in their order', () => {
    const { result, rerender } = renderHook(useRoomPanels<RoomPanel>, {
      initialProps: panelsOf({ b: true, c: true }),
    });
    expect(result.current.shown?.id).toBe('b');
    rerender(panelsOf({}));
    expect(result.current.shown).toBeUndefined();
  });

  it('opens a panel after closing every other one that does not yield to it', () => {
    const panels = panelsOf({ a: true, c: true }, { c: { yieldsTo: ['b'] } });
    const { result } = renderHook(() => useRoomPanels(panels));
    const show = vi.fn(() => expect(closed(panels)).toEqual(['a']));
    act(() => result.current.request('b', show));
    expect(show).toHaveBeenCalledOnce();
  });

  it('closes the others the same way when a panel opens elsewhere, and only then', () => {
    const options = { b: { opensElsewhere: true }, c: { yieldsTo: ['b'] } };
    const { rerender } = renderHook(useRoomPanels<RoomPanel>, {
      initialProps: panelsOf({ b: true }, options),
    });
    // Open from the start: nothing to make room for.
    const first = panelsOf({ a: true, b: true, c: true }, options);
    rerender(first);
    expect(closed(first)).toEqual([]);

    const closedAgain = panelsOf({ a: true, c: true }, options);
    rerender(closedAgain);
    const reopened = panelsOf({ a: true, b: true, c: true }, options);
    rerender(reopened);
    expect(closed(reopened)).toEqual(['a']);
  });

  it('leaves the others alone when a panel opens by its own state without opensElsewhere', () => {
    const { rerender } = renderHook(useRoomPanels<RoomPanel>, {
      initialProps: panelsOf({ a: true }),
    });
    const next = panelsOf({ a: true, b: true });
    rerender(next);
    expect(closed(next)).toEqual([]);
  });
});
