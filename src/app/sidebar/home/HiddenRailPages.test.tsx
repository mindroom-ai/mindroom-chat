import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RailButtons } from '../../settings/railButtons';
import { HiddenRailPages } from './HiddenRailPages';

const ALL: RailButtons = {
  threads: true,
  canvases: true,
  explore: true,
  createSpace: true,
  search: true,
  localMindroom: true,
};

const state = vi.hoisted(() => ({
  offered: {} as RailButtons,
  shown: {} as RailButtons,
  navigate: vi.fn(),
  openExplore: vi.fn(),
}));

vi.mock('../../settings/railButtons', () => ({
  useOfferedRailButtons: () => state.offered,
  useRailButtons: () => state.shown,
}));
vi.mock('../rail/useOpenExplore', () => ({ useOpenExplore: () => state.openExplore }));
vi.mock('react-router-dom', () => ({ useNavigate: () => state.navigate }));
vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});
vi.mock('folds', () => ({
  Icons: { Thread: 'Thread', Category: 'Category', Explore: 'Explore' },
  Line: () => null,
}));
vi.mock('../../ui/MenuEntry', () => ({
  MenuGroup: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
  MenuEntry: ({ label, onSelect }: { label: string; onSelect: () => void }) =>
    React.createElement('button', { onClick: onSelect }, label),
}));

const entries = (onClose = vi.fn()) => {
  const renderer = create(<HiddenRailPages onClose={onClose} />);
  return renderer.root.findAllByType('button');
};

describe('HiddenRailPages', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('adds nothing while the rail shows Threads, Canvases and Explore', () => {
    state.offered = ALL;
    state.shown = ALL;
    expect(entries()).toHaveLength(0);
  });

  it('opens Threads, Canvases and Explore Community from the menu once their buttons are hidden', () => {
    state.offered = ALL;
    state.shown = { ...ALL, threads: false, canvases: false, explore: false };
    const onClose = vi.fn();
    const [threads, canvases, explore] = entries(onClose);
    expect(threads?.children).toEqual(['Threads']);
    expect(canvases?.children).toEqual(['Canvases']);
    expect(explore?.children).toEqual(['Explore Community']);

    act(() => {
      threads?.props.onClick();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(state.navigate).toHaveBeenCalledWith('/threads/');
    act(() => {
      canvases?.props.onClick();
    });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(state.navigate).toHaveBeenLastCalledWith('/canvases/');
    act(() => {
      explore?.props.onClick();
    });
    expect(state.openExplore).toHaveBeenCalledTimes(1);
  });

  it('lists only the hidden buttons', () => {
    state.offered = ALL;
    state.shown = { ...ALL, canvases: false };
    expect(entries().map((entry) => entry.children)).toEqual([['Canvases']]);
  });

  it('offers nothing the deployment leaves out', () => {
    state.offered = { ...ALL, threads: false, canvases: false, explore: false };
    state.shown = { ...state.offered };
    expect(entries()).toHaveLength(0);
  });
});
