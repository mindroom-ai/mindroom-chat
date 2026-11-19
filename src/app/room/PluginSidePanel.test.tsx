// @vitest-environment jsdom
import { lazy } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomSidePanel } from '../plugins/sidePanels';
import { PluginSidePanel } from './PluginSidePanel';

vi.mock('../bug-reports/error-reporting/errorReporting', () => ({
  reportBoundaryError: () => undefined,
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
  afterEach(cleanup);

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
});
