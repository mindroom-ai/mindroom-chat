import { createStore, Provider } from 'jotai';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import { getSettings, settingsAtom } from '../../state/settings';
import { RoomThreadOverview } from './RoomThreadOverview';
import { createDefaultThreadFilterState } from './roomThreadOverviewModel';

const noop = () => undefined;

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

describe('the thread filter bar search', () => {
  it('starts collapsed even while a query filters the threads', () => {
    // The search is one of the advanced filters.
    const store = createStore();
    store.set(settingsAtom, { ...getSettings(), simpleThreadFilters: false });
    act(() => {
      renderer = create(
        <Provider store={store}>
          <RoomThreadOverview
            hasMindroomAgents
            threadCount={1}
            totalThreadCount={4}
            state={{ ...createDefaultThreadFilterState(), freeText: 'launch', resolved: 'exclude' }}
            availableTags={[]}
            onToggle={noop}
            onSortDirectionChange={noop}
            onToggleThreadSortFreeze={noop}
            onReset={noop}
            onCycleTag={noop}
            onAddTag={noop}
            onRemoveTag={noop}
            onApplyPreset={noop}
            onSearchQueryChange={noop}
          />
        </Provider>
      );
    });
    const find = (name: string) =>
      renderer?.root.findAll((node) => typeof node.type === 'string' && name in node.props) ?? [];
    const one = (name: string) => {
      const [node] = find(name);
      if (!node) throw new Error(`no ${name}`);
      return node;
    };
    expect(find('data-search-input')).toHaveLength(0);
    expect(one('data-search-toggle').props['aria-expanded']).toBe(false);

    act(() => {
      one('data-search-toggle').props.onClick();
    });

    expect(one('data-search-input').props.value).toContain('launch');
  });
});
