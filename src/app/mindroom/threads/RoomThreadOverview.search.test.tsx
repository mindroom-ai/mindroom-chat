import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
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
    act(() => {
      renderer = create(
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
      );
    });
    const find = (name: string) =>
      renderer?.root.findAll((node) => typeof node.type === 'string' && name in node.props) ?? [];
    expect(find('data-search-input')).toHaveLength(0);
    expect(find('data-search-toggle')[0].props['aria-expanded']).toBe(false);

    act(() => {
      find('data-search-toggle')[0].props.onClick();
    });

    expect(find('data-search-input')[0].props.value).toContain('launch');
  });
});
