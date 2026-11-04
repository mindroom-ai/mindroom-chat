import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RailButtons } from '../sidebar/railButtons';
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

vi.mock('../sidebar/railButtons', () => ({
  useOfferedRailButtons: () => state.offered,
  useRailButtons: () => state.shown,
}));
vi.mock('../sidebar/useOpenExplore', () => ({ useOpenExplore: () => state.openExplore }));
vi.mock('react-router-dom', () => ({ useNavigate: () => state.navigate }));
vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test-utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});
vi.mock('folds', () => ({ Icons: { Thread: 'Thread', Explore: 'Explore' }, Line: () => null }));
vi.mock('../../../components/MenuEntry', () => ({
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

  it('adds nothing while the rail shows Threads and Explore', () => {
    state.offered = ALL;
    state.shown = ALL;
    expect(entries()).toHaveLength(0);
  });

  it('opens Threads and Explore Community from the menu once the person hides their buttons', () => {
    state.offered = ALL;
    state.shown = { ...ALL, threads: false, explore: false };
    const onClose = vi.fn();
    const [threads, explore] = entries(onClose);
    expect(threads?.children).toEqual(['Threads']);
    expect(explore?.children).toEqual(['Explore Community']);

    act(() => {
      threads?.props.onClick();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(state.navigate).toHaveBeenCalledWith('/threads/');
    act(() => {
      explore?.props.onClick();
    });
    expect(state.openExplore).toHaveBeenCalledTimes(1);
  });

  it('offers nothing the deployment leaves out', () => {
    state.offered = { ...ALL, threads: false, explore: false };
    state.shown = { ...state.offered };
    expect(entries()).toHaveLength(0);
  });
});
