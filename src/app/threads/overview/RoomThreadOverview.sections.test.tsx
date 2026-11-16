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
};

const byData = (name: string): ReactTestInstance[] =>
  renderer?.root.findAll((node) => typeof node.type === 'string' && name in node.props) ?? [];
const sectionsSwitch = (): ReactTestInstance | undefined => byData('data-thread-sections')[0];
const filterKeys = () =>
  byData('data-filter-key').map((node) => node.props['data-filter-key'] as string);

describe('the Sections switch of the Compact filter bar', () => {
  it('shows only where the cards can show in sections', () => {
    renderBar(true);
    expect(sectionsSwitch()).toBeUndefined();

    act(() => renderer?.unmount());
    renderBar(true, { onToggleThreadSections: noop });
    expect(sectionsSwitch()).toBeDefined();
  });

  it.each([true, false])('shows beside the sort and turns Sections on (simple: %s)', (simple) => {
    const onToggleThreadSections = vi.fn();
    renderBar(simple, { onToggleThreadSections });
    const toggle = sectionsSwitch();
    if (!toggle) throw new Error('no Sections switch');
    expect(toggle.props['aria-pressed']).toBe(false);
    expect(toggle.props.className).not.toContain(css.SortButtonActive);
    expect(byData('data-sort-by')).toHaveLength(1);

    act(() => {
      toggle.props.onClick();
    });

    expect(onToggleThreadSections).toHaveBeenCalledTimes(1);
  });

  it('leaves out the controls Sections decide for themselves: sort, lock and Unresolved', () => {
    renderBar(true, { onToggleThreadSections: noop, threadSections: true });
    expect(sectionsSwitch()?.props['aria-pressed']).toBe(true);
    expect(sectionsSwitch()?.props.className).toContain(css.SortButtonActive);
    expect(byData('data-sort-by')).toHaveLength(0);
    expect(byData('data-simple-unresolved-toggle')).toHaveLength(0);

    act(() => renderer?.unmount());
    renderBar(false, { onToggleThreadSections: noop, threadSections: true });
    expect(byData('data-sort-by')).toHaveLength(0);
    expect(byData('data-thread-sort-freeze')).toHaveLength(0);
    // Resolved and snoozed threads have sections of their own; the other filters still apply.
    expect(filterKeys()).toEqual(['streaming', 'scheduled', 'unread', 'idle']);
    expect(byData('data-search-toggle')).toHaveLength(1);
  });

  it('offers only the presets that leave resolved and snoozed threads alone', () => {
    renderBar(false, { onToggleThreadSections: noop, threadSections: true });

    act(() => {
      byData('data-preset-button')[0]?.props.onClick();
    });

    expect(byData('data-preset-option').map((node) => node.props['data-preset-option'])).toEqual([
      'working',
      'all',
    ]);
  });
});
