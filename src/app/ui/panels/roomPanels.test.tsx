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

/** The rule in room `room` over `panels`, as a room renders it. */
const useRoomPanelsIn = ({
  room = '!a',
  panels,
}: {
  room?: string;
  panels: readonly RoomPanel[];
}) => useRoomPanels(room, panels);

describe('useRoomPanels', () => {
  it('shows the first open panel in their order', () => {
    const { result, rerender } = renderHook(useRoomPanelsIn, {
      initialProps: { panels: panelsOf({ b: true, c: true }) },
    });
    expect(result.current.shown?.id).toBe('b');
    rerender({ panels: panelsOf({}) });
    expect(result.current.shown).toBeUndefined();
  });

  it('opens a panel after closing every other one that does not yield to it', () => {
    const panels = panelsOf({ a: true, c: true }, { c: { yieldsTo: ['b'] } });
    const { result } = renderHook(() => useRoomPanels('!a', panels));
    const show = vi.fn(() => expect(closed(panels)).toEqual(['a']));
    act(() => result.current.request('b', show));
    expect(show).toHaveBeenCalledOnce();
  });

  it('closes the others the same way when a panel opens elsewhere, and only then', () => {
    const options = { b: { opensElsewhere: true }, c: { yieldsTo: ['b'] } };
    const { rerender } = renderHook(useRoomPanelsIn, {
      initialProps: { panels: panelsOf({ b: true }, options) },
    });
    // Open from the start: nothing to make room for.
    const first = panelsOf({ a: true, b: true, c: true }, options);
    rerender({ panels: first });
    expect(closed(first)).toEqual([]);

    const closedAgain = panelsOf({ a: true, c: true }, options);
    rerender({ panels: closedAgain });
    const reopened = panelsOf({ a: true, b: true, c: true }, options);
    rerender({ panels: reopened });
    expect(closed(reopened)).toEqual(['a']);
  });

  it('leaves the others alone when a panel opens by its own state without opensElsewhere', () => {
    const { rerender } = renderHook(useRoomPanelsIn, {
      initialProps: { panels: panelsOf({ a: true }) },
    });
    const next = panelsOf({ a: true, b: true });
    rerender({ panels: next });
    expect(closed(next)).toEqual([]);
  });

  it("keeps each room's layout of a panel while it stays open, also while it is hidden", () => {
    const { result, rerender } = renderHook(useRoomPanelsIn, {
      initialProps: { panels: panelsOf({ b: true }) },
    });
    expect(result.current.layout).toBe('beside');
    act(() => result.current.setLayout('b', 'folded'));
    expect(result.current.layout).toBe('folded');

    // Another room shows its own b beside, and gets its own layout.
    rerender({ room: '!b', panels: panelsOf({ b: true }) });
    expect(result.current.layout).toBe('beside');
    act(() => result.current.setLayout('b', 'filled'));
    expect(result.current.layout).toBe('filled');

    // Back in the first room, hidden for a while behind a, b is folded again.
    rerender({ panels: panelsOf({ a: true, b: true }) });
    expect(result.current.shown?.id).toBe('a');
    expect(result.current.layout).toBe('beside');
    rerender({ panels: panelsOf({ b: true }) });
    expect(result.current.layout).toBe('folded');
  });

  it('keeps a panel opened elsewhere as it was when its room shows again', () => {
    const options = { b: { opensElsewhere: true } };
    const { result, rerender } = renderHook(useRoomPanelsIn, {
      initialProps: { panels: panelsOf({ b: true }, options) },
    });
    act(() => result.current.setLayout('b', 'folded'));
    // Another room, where b is not open, and back: b did not open again.
    rerender({ room: '!b', panels: panelsOf({}, options) });
    const again = panelsOf({ b: true }, options);
    rerender({ panels: again });
    expect(closed(again)).toEqual([]);
    expect(result.current.layout).toBe('folded');
  });

  it('keeps an open panel filling the room when it is asked for again, and brings a folded one back', () => {
    const { result } = renderHook(useRoomPanelsIn, {
      initialProps: { panels: panelsOf({ a: true }) },
    });
    act(() => result.current.setLayout('a', 'filled'));
    act(() => result.current.request('a', () => undefined));
    expect(result.current.layout).toBe('filled');
    act(() => result.current.setLayout('a', 'folded'));
    act(() => result.current.request('a', () => undefined));
    expect(result.current.layout).toBe('beside');
  });

  it('forgets the layout a panel had in other rooms when it opens', () => {
    const { result, rerender } = renderHook(useRoomPanelsIn, {
      initialProps: { panels: panelsOf({ a: true }) },
    });
    act(() => result.current.setLayout('a', 'filled'));
    // Open in every room (as the members are): closed and opened again in another room.
    rerender({ room: '!b', panels: panelsOf({}) });
    act(() => result.current.request('a', () => undefined));
    rerender({ room: '!b', panels: panelsOf({ a: true }) });
    rerender({ panels: panelsOf({ a: true }) });
    expect(result.current.layout).toBe('beside');
  });

  it('opens a panel beside the conversation again, by a request or from elsewhere', () => {
    const options = { b: { opensElsewhere: true } };
    const { result, rerender } = renderHook(useRoomPanelsIn, {
      initialProps: { panels: panelsOf({ a: true }, options) },
    });
    act(() => result.current.setLayout('a', 'filled'));
    rerender({ panels: panelsOf({}, options) });
    act(() => result.current.request('a', () => undefined));
    rerender({ panels: panelsOf({ a: true }, options) });
    expect(result.current.layout).toBe('beside');

    act(() => result.current.setLayout('b', 'folded'));
    rerender({ panels: panelsOf({ b: true }, options) });
    expect(result.current.layout).toBe('beside');
  });
});
