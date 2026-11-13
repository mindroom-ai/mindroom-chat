import { createStore, Provider } from 'jotai';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSettings, settingsAtom } from '../../preferences/settings';
import { RoomThreadOverview, type RoomThreadOverviewProps } from './RoomThreadOverview';
import * as css from './RoomThreadOverview.css';
import { createDefaultThreadFilterState } from '../../event-store/threads/roomThreadOverviewModel';

const noop = () => undefined;
const props = (overrides: Partial<RoomThreadOverviewProps> = {}): RoomThreadOverviewProps => ({
  hasMindroomAgents: true,
  threadCount: 3,
  totalThreadCount: 3,
  state: createDefaultThreadFilterState(),
  availableTags: [],
  onToggle: noop,
  onSortDirectionChange: noop,
  onToggleThreadSortFreeze: noop,
  onToggleUnresolvedOnly: noop,
  onReset: noop,
  onClearTags: noop,
  onAddTag: noop,
  onRemoveTag: noop,
  onApplyPreset: noop,
  onSearchQueryChange: noop,
  ...overrides,
});

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

const renderBar = (simple: boolean, overrides: Partial<RoomThreadOverviewProps> = {}) => {
  const store = createStore();
  store.set(settingsAtom, { ...getSettings(), simpleThreadFilters: simple });
  act(() => {
    renderer = create(
      <Provider store={store}>
        <RoomThreadOverview {...props(overrides)} />
      </Provider>
    );
  });
  return store;
};

const byData = (name: string): ReactTestInstance[] =>
  renderer?.root.findAll((node) => typeof node.type === 'string' && name in node.props) ?? [];
const modeSwitch = (): ReactTestInstance => {
  const [node] = byData('data-thread-filter-mode-switch');
  if (!node) throw new Error('no filter mode switch');
  return node;
};
const unresolvedToggles = () => byData('data-simple-unresolved-toggle');
const statusToggles = () => byData('data-filter-state');

describe('thread filter bar modes', () => {
  it('starts with the simple filters', () => {
    expect(getSettings().simpleThreadFilters).toBe(true);
  });

  it('switches between the simple filters and the advanced ones, and stores the choice', () => {
    const store = renderBar(true);
    expect(modeSwitch().props['aria-pressed']).toBe(false);
    expect(modeSwitch().props.className).not.toContain(css.PauseButtonActive);
    expect(modeSwitch().props['aria-label']).toBe('Advanced filters');
    expect(statusToggles()).toHaveLength(0);
    expect(unresolvedToggles()).toHaveLength(1);
    expect(byData('data-thread-count')).toHaveLength(1);
    expect(byData('data-sort-by')).toHaveLength(1);

    act(() => {
      modeSwitch().props.onClick();
    });

    expect(store.get(settingsAtom).simpleThreadFilters).toBe(false);
    expect(modeSwitch().props['aria-pressed']).toBe(true);
    expect(modeSwitch().props.className).toContain(css.PauseButtonActive);
    expect(statusToggles().length).toBeGreaterThan(0);
    expect(unresolvedToggles()).toHaveLength(0);

    act(() => {
      modeSwitch().props.onClick();
    });

    expect(store.get(settingsAtom).simpleThreadFilters).toBe(true);
    expect(statusToggles()).toHaveLength(0);
  });

  it('shows Unresolved pressed while resolved threads are hidden, and flips it on click', () => {
    const onToggleUnresolvedOnly = vi.fn();
    renderBar(true, {
      state: { ...createDefaultThreadFilterState(), resolved: 'exclude' },
      onToggleUnresolvedOnly,
    });
    const [toggle] = unresolvedToggles();
    if (!toggle) throw new Error('no Unresolved toggle');
    expect(toggle.props['aria-pressed']).toBe(true);

    act(() => {
      toggle.props.onClick();
    });

    expect(onToggleUnresolvedOnly).toHaveBeenCalledTimes(1);
  });

  it('says no thread matches only when a filter hides threads, not in a room with none', () => {
    const unresolved = { ...createDefaultThreadFilterState(), resolved: 'exclude' as const };
    const emptyStates = () =>
      renderer?.root.findAll((node) => node.props.className === css.EmptyState) ?? [];

    renderBar(true, { state: unresolved, threadCount: 0, totalThreadCount: 0 });
    expect(emptyStates()).toHaveLength(0);

    act(() => renderer?.unmount());
    renderBar(true, { state: unresolved, threadCount: 0, totalThreadCount: 2 });
    expect(emptyStates()).toHaveLength(1);
  });

  it('keeps only the sort and the switch in a simple bar without agents', () => {
    renderBar(true, { hasMindroomAgents: false });
    expect(unresolvedToggles()).toHaveLength(0);
    expect(byData('data-thread-count')).toHaveLength(0);
    expect(byData('data-sort-by')).toHaveLength(1);
    expect(byData('data-thread-filter-mode-switch')).toHaveLength(1);
  });

  it('speaks the summary when the filters change, not when a message moves the count', () => {
    const store = renderBar(true);
    const rerender = (overrides: Partial<RoomThreadOverviewProps>) =>
      act(() => {
        renderer?.update(
          <Provider store={store}>
            <RoomThreadOverview {...props(overrides)} />
          </Provider>
        );
      });
    const text = (node: ReactTestInstance) =>
      node.children.filter((child) => typeof child === 'string').join('');
    const live = () => {
      const [node] = renderer?.root.findAll((n) => n.props['aria-live'] === 'polite') ?? [];
      if (!node) throw new Error('no live region');
      return text(node);
    };
    const summary = () =>
      renderer?.root
        .findAll((n) => n.type === 'div' && n.props['aria-live'] === undefined)
        .map(text)
        .find((value) => value.startsWith('Showing'));

    expect(live()).toBe('');
    rerender({ threadCount: 4, totalThreadCount: 4 });
    expect(live()).toBe('');
    expect(summary()).toBe('Showing 4 threads');

    const unresolved = { ...createDefaultThreadFilterState(), resolved: 'exclude' as const };
    rerender({ threadCount: 2, totalThreadCount: 4, state: unresolved });
    expect(live()).toBe(summary());
    expect(live()).toContain('2');
  });
});
