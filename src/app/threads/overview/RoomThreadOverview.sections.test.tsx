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
  onSortDirectionChange: noop,
  onToggleThreadSortFreeze: noop,
  onToggleUnresolvedOnly: noop,
  onReset: noop,
  onClearTags: noop,
  onAddTag: noop,
  onRemoveTag: noop,
  onSearchQueryChange: noop,
  ...overrides,
});

let renderer: ReactTestRenderer | undefined;
let store = createStore();
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

const renderBar = (simple: boolean, overrides: Partial<RoomThreadOverviewProps> = {}) => {
  store = createStore();
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
const tabs = () => byData('data-thread-tab').map((node) => node.props['data-thread-tab'] as string);

describe('the Group switch of the Compact filter bar', () => {
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
    if (!toggle) throw new Error('no Group switch');
    expect(toggle.props['aria-pressed']).toBe(false);
    expect(toggle.props.className).not.toContain(css.SortButtonActive);
    expect(byData('data-sort-by')).toHaveLength(1);

    act(() => {
      toggle.props.onClick();
    });

    expect(onToggleThreadSections).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])(
    'shows the layers icon and a label a narrow bar folds away (simple: %s)',
    (simple) => {
      renderBar(simple, { onToggleThreadSections: noop });
      const toggle = sectionsSwitch();
      if (!toggle) throw new Error('no Group switch');
      expect(toggle.props['aria-label']).toBe('Group');
      expect(toggle.findAll((node) => node.type === 'path')).toHaveLength(3);
      expect(toggle.findByProps({ className: css.SectionsSwitchLabel }).props.children).toBe(
        'Group'
      );
    }
  );

  it('leaves out only the sort and its lock, which Sections decide, and keeps every filter', () => {
    renderBar(true, { onToggleThreadSections: noop, threadSections: true });
    expect(sectionsSwitch()?.props['aria-pressed']).toBe(true);
    expect(sectionsSwitch()?.props.className).toContain(css.SortButtonActive);
    expect(byData('data-sort-by')).toHaveLength(0);
    expect(byData('data-simple-unresolved-toggle')).toHaveLength(1);

    act(() => renderer?.unmount());
    renderBar(false, { onToggleThreadSections: noop, threadSections: true });
    expect(byData('data-sort-by')).toHaveLength(0);
    expect(byData('data-thread-sort-freeze')).toHaveLength(0);
    expect(tabs()).toEqual(['needsYou', 'working', 'later', 'done', 'all']);
    expect(byData('data-search-toggle')).toHaveLength(1);
  });
});
