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
  hasCanvases: true,
  navigate: vi.fn(),
  openExplore: vi.fn(),
  openCreateSpace: vi.fn(),
}));

vi.mock('../../settings/railButtons', () => ({
  useOfferedRailButtons: () => state.offered,
  useRailButtons: () => state.shown,
}));
vi.mock('../rail/useOpenExplore', () => ({ useOpenExplore: () => state.openExplore }));
vi.mock('../rail/CanvasesTab', () => ({ useHasCanvases: () => state.hasCanvases }));
vi.mock('../../navigation/useCreateSpaceModal', () => ({
  useOpenCreateSpaceModal: () => state.openCreateSpace,
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => state.navigate }));
vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});
vi.mock('folds', () => ({
  Icons: {
    Thread: 'Thread',
    Category: 'Category',
    Explore: 'Explore',
    Plus: 'Plus',
  },
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
    state.hasCanvases = true;
  });

  it('adds nothing while the rail shows every button', () => {
    state.offered = ALL;
    state.shown = ALL;
    expect(entries()).toHaveLength(0);
  });

  it('lists every hidden button in rail order, and each one opens its page', () => {
    state.offered = ALL;
    state.shown = { ...ALL, threads: false, canvases: false, explore: false };
    state.shown = { ...state.shown, createSpace: false, search: false };
    const onClose = vi.fn();
    const buttons = entries(onClose);
    expect(buttons.map((entry) => entry.children)).toEqual([
      ['Threads'],
      ['Canvases'],
      ['Explore Community'],
      ['Create Space'],
    ]);
    const [threads, canvases, explore, createSpace] = buttons;

    act(() => {
      threads?.props.onClick();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(state.navigate).toHaveBeenCalledWith('/threads/');
    act(() => {
      canvases?.props.onClick();
    });
    expect(state.navigate).toHaveBeenLastCalledWith('/canvases/');
    act(() => {
      explore?.props.onClick();
    });
    expect(state.openExplore).toHaveBeenCalledTimes(1);
    act(() => {
      createSpace?.props.onClick();
    });
    expect(state.openCreateSpace).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it('lists only the hidden buttons', () => {
    state.offered = ALL;
    state.shown = { ...ALL, canvases: false };
    expect(entries().map((entry) => entry.children)).toEqual([['Canvases']]);
    // The search field stands in for a hidden search button.
    state.shown = { ...ALL, search: false };
    expect(entries()).toHaveLength(0);
  });

  it('lists Canvases only once the account has a canvas, as the rail button does', () => {
    state.offered = ALL;
    state.shown = { ...ALL, canvases: false };
    state.hasCanvases = false;
    expect(entries()).toHaveLength(0);
    state.hasCanvases = true;
    expect(entries().map((entry) => entry.children)).toEqual([['Canvases']]);
  });

  it('offers nothing the deployment leaves out', () => {
    state.offered = { ...ALL, threads: false, canvases: false, explore: false, createSpace: false };
    state.shown = { ...state.offered, search: true };
    expect(entries()).toHaveLength(0);
  });
});
