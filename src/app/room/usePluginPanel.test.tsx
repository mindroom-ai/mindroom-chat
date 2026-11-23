// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RoomSidePanel } from '../plugins/sidePanels';
import { usePluginPanel } from './usePluginPanel';

vi.mock('../plugins/pluginStorage', () => ({
  usePluginStorage: () => ({
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  }),
}));

const makePanel = (id: string): RoomSidePanel => ({
  id,
  tag: `${id}@1.0.0`,
  label: id,
  Component: () => null,
});

describe('usePluginPanel', () => {
  it('closes cleanly when the open panel disappears from enabled panels', () => {
    const panel = makePanel('example/panel');
    const closeMembers = vi.fn();
    const { result, rerender } = renderHook(
      ({ panels }: { panels: readonly RoomSidePanel[] }) =>
        usePluginPanel('!room:example.org', panels, false, { beside: false, close: closeMembers }),
      { initialProps: { panels: [panel] as readonly RoomSidePanel[] } }
    );

    act(() => {
      result.current.show(panel, { item: 1 });
    });
    expect(result.current.here).toEqual({
      roomId: '!room:example.org',
      id: 'example/panel',
      request: { item: 1 },
    });

    // Disabling the plugin removes its panel from `panels`.
    rerender({ panels: [] });
    expect(result.current.here).toBeUndefined();

    // Re-enabling the plugin does not unexpectedly pop the closed panel back open.
    rerender({ panels: [panel] });
    expect(result.current.here).toBeUndefined();
  });
});
