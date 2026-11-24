// @vitest-environment jsdom
import { lazy } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomSidePanel } from '../plugins/sidePanels';
import { PluginSidePanel } from './PluginSidePanel';

const sampleMemoryMock = vi.hoisted(() => vi.fn());

vi.mock('../bug-reports/error-reporting/errorReporting', () => ({
  reportBoundaryError: () => undefined,
}));

vi.mock('../diagnostics/memorySampler', () => ({
  sampleMemory: sampleMemoryMock,
}));

const titled = (Component: RoomSidePanel['Component']): RoomSidePanel => ({
  id: 'example/notes',
  tag: 'example',
  label: 'Notes',
  title: 'own',
  Component,
});

const show = (panel: RoomSidePanel, onClose = () => undefined) =>
  render(
    <PluginSidePanel
      panel={panel}
      roomId="!lobby:example.org"
      request={undefined}
      onClose={onClose}
    />
  );

const titleRow = () => screen.queryByRole('heading', { name: 'Notes' });
const close = () => screen.queryByRole('button', { name: 'Close Notes' });

describe('PluginSidePanel', () => {
  afterEach(() => {
    cleanup();
    sampleMemoryMock.mockClear();
  });

  it('draws the title row and Close above a panel by default', () => {
    show({ ...titled(() => <p>Notes body</p>), title: undefined });
    expect(titleRow()).not.toBeNull();
    expect(close()).not.toBeNull();
  });

  it('draws no title row above a panel with its own title, and keeps the region and its body', () => {
    show(titled(() => <p>Notes body</p>));
    expect(titleRow()).toBeNull();
    expect(close()).toBeNull();
    expect(screen.getByRole('region', { name: 'Notes' }).textContent).toBe('Notes body');
  });

  it('draws the title row and Close while the panel with its own title loads', () => {
    const onClose = vi.fn();
    show(titled(lazy(() => new Promise<never>(() => undefined))), onClose);
    expect(titleRow()).not.toBeNull();
    act(() => close()?.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('draws the title row and Close once the panel with its own title failed', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    show(
      titled(() => {
        throw new Error('no notes today');
      })
    );
    expect(titleRow()).not.toBeNull();
    expect(close()).not.toBeNull();
    expect(screen.getByRole('region', { name: 'Notes' }).textContent).toBe(
      'NotesThis panel stopped working.'
    );
    vi.restoreAllMocks();
  });

  it('leaves the frame to a panel that draws its own, also with its own title', () => {
    show({ ...titled(() => <p>Notes body</p>), frame: 'own' });
    expect(screen.queryByRole('region', { name: 'Notes' })).toBeNull();
    expect(screen.getByText('Notes body')).not.toBeNull();
  });

  it('samples memory on mount, request change, and unmount without spamming on unrelated re-renders', () => {
    const Body = () => <p>Notes body</p>;
    const panel = titled(Body);
    const requestA = { pr: 1 };
    const rendered = render(
      <PluginSidePanel
        panel={panel}
        roomId="!lobby:example.org"
        request={requestA}
        onClose={() => undefined}
      />
    );
    expect(sampleMemoryMock.mock.calls).toEqual([['plugin_panel_open']]);

    // Unrelated re-render with a fresh panel wrapper and onClose keeps the same panel/request.
    rendered.rerender(
      <PluginSidePanel
        panel={{ ...panel, label: 'Renamed Notes' }}
        roomId="!lobby:example.org"
        request={requestA}
        onClose={() => undefined}
      />
    );
    expect(sampleMemoryMock.mock.calls).toEqual([['plugin_panel_open']]);

    rendered.rerender(
      <PluginSidePanel
        panel={panel}
        roomId="!lobby:example.org"
        request={{ pr: 2 }}
        onClose={() => undefined}
      />
    );
    expect(sampleMemoryMock.mock.calls).toEqual([
      ['plugin_panel_open'],
      ['plugin_panel_close'],
      ['plugin_panel_open'],
    ]);

    rendered.unmount();
    expect(sampleMemoryMock.mock.calls).toEqual([
      ['plugin_panel_open'],
      ['plugin_panel_close'],
      ['plugin_panel_open'],
      ['plugin_panel_close'],
    ]);
  });
});
