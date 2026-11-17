import { createStore, Provider } from 'jotai';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ThreadWorkflowCounts,
  ThreadWorkflowTab,
} from '../../event-store/threads/threadWorkflow';
import { createDefaultThreadFilterState } from '../../event-store/threads/roomThreadOverviewModel';
import { getSettings, settingsAtom } from '../../preferences/settings';
import { RoomThreadOverview } from './RoomThreadOverview';
import { WorkflowTabs } from './WorkflowTabs';
import * as css from './WorkflowTabs.css';

const COUNTS: ThreadWorkflowCounts = { needsYou: 6, working: 8, later: 0, done: 14, all: 28 };
const ZERO: ThreadWorkflowCounts = { needsYou: 0, working: 0, later: 0, done: 0, all: 0 };

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

const show = (element: React.ReactElement) => {
  act(() => {
    if (renderer) renderer.update(element);
    else renderer = create(element);
  });
};
const render = (
  active: ThreadWorkflowTab | undefined,
  counts: ThreadWorkflowCounts,
  settled = true
) => show(<WorkflowTabs active={active} counts={counts} countsSettled={settled} />);

const tab = (key: ThreadWorkflowTab) =>
  renderer!.root.find((node) => node.type === 'button' && node.props['data-thread-tab'] === key);
const gestures = () =>
  renderer!.root
    .findAll((node) => node.type === 'button' && node.props['data-gesture'] !== undefined)
    .map((node) => node.props['data-thread-tab'] as string);
const byClass = (className: string) =>
  renderer!.root.findAll((node) => node.type === 'span' && node.props.className === className);
const rolls = () =>
  renderer!.root
    .findAll((node) => node.props['data-roll'] !== undefined && !!node.props.as)
    .map((node) => node.props['data-roll'] as string);
const moving = () => ({
  gestures: gestures(),
  pings: byClass(css.PingDot).length,
  rolls: rolls(),
  rollingOut: byClass(css.RollOut).length,
});
const STILL = { gestures: [], pings: 0, rolls: [], rollingOut: 0 };

describe('WorkflowTabs', () => {
  it('moves nothing on mount', () => {
    render('needsYou', COUNTS);
    expect(tab('needsYou').props['aria-pressed']).toBe(true);
    expect(moving()).toEqual(STILL);
  });

  it('plays the gesture of a newly pressed tab only', () => {
    render('needsYou', COUNTS);
    render('done', COUNTS);
    expect(gestures()).toEqual(['done']);
    // A count changing meanwhile keeps the gesture going.
    render('done', { ...COUNTS, working: 9 });
    expect(gestures()).toEqual(['done']);
    // Other filters press no tab, and the next pressed one gestures again.
    render(undefined, COUNTS);
    expect(gestures()).toEqual([]);
    render('done', COUNTS);
    expect(gestures()).toEqual(['done']);
  });

  it('clears a gesture once its last animation ends', () => {
    render('needsYou', COUNTS);
    render('all', COUNTS);
    const icon = tab('all').findByProps({ 'aria-hidden': 'true' });
    const end = (running: object[]) => {
      act(() => {
        icon.props.onAnimationEnd({ currentTarget: { getAnimations: () => running } });
      });
    };
    // One of the list's lines ended; another still slides in.
    end([{ animationName: 'slideIn' }]);
    expect(gestures()).toEqual(['all']);
    // An icon transition still running is not part of the gesture.
    end([{ transitionProperty: 'width' }]);
    expect(gestures()).toEqual([]);
  });

  it('takes counts that load page by page silently, and moves only for later changes', () => {
    render('all', ZERO, false);
    render('all', { ...ZERO, needsYou: 2, all: 5 }, false);
    render('all', COUNTS, false);
    expect(moving()).toEqual(STILL);
    expect(tab('needsYou').props['aria-label']).toBe('Needs you 6');

    render('all', COUNTS, true);
    expect(moving()).toEqual(STILL);
    render('all', { ...COUNTS, needsYou: 7, all: 29 });
    expect(rolls()).toEqual(['up', 'up']);
    expect(byClass(css.RollOut).map((node) => node.props.children)).toEqual(['6', '28']);
    expect(byClass(css.PingDot)).toHaveLength(1);

    // A count that falls rolls down; the next change ends the ping.
    render('all', { ...COUNTS, needsYou: 5, all: 29 });
    expect(rolls()).toEqual(['down', 'up']);
    expect(byClass(css.PingDot)).toHaveLength(0);
    expect(tab('needsYou').props['aria-label']).toBe('Needs you 5');
  });

  it('takes the last page silently when it arrives with the end of loading', () => {
    // React batches the last page's counts with the end of loading: one render changes both.
    render('all', { ...ZERO, needsYou: 2, all: 5 }, false);
    render('all', COUNTS, true);
    expect(moving()).toEqual(STILL);
    render('all', { ...COUNTS, needsYou: 7, all: 29 }, true);
    expect(rolls()).toEqual(['up', 'up']);
    expect(byClass(css.PingDot)).toHaveLength(1);
  });

  it('makes no motion state with reduced motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
    render('needsYou', COUNTS);
    render('done', { ...COUNTS, needsYou: 7, all: 29 });
    expect(moving()).toEqual(STILL);
  });

  it('starts afresh in another room, whatever its counts', () => {
    const store = createStore();
    store.set(settingsAtom, { ...getSettings(), simpleThreadFilters: false });
    const room = (roomId: string, counts: ThreadWorkflowCounts, settled: boolean) =>
      show(
        <Provider store={store}>
          <RoomThreadOverview
            roomId={roomId}
            hasMindroomAgents
            threadCount={counts.all}
            totalThreadCount={counts.all}
            bucketCounts={counts}
            countsSettled={settled}
            state={{ ...createDefaultThreadFilterState(), tab: 'needsYou' }}
            availableTags={[]}
            onSortDirectionChange={() => undefined}
            onToggleThreadSortFreeze={() => undefined}
            onReset={() => undefined}
            onClearTags={() => undefined}
            onAddTag={() => undefined}
            onRemoveTag={() => undefined}
            onSearchQueryChange={() => undefined}
          />
        </Provider>
      );
    room('!a', COUNTS, true);
    // The first render of the next room can still read the last room's settled list.
    room('!b', { ...COUNTS, needsYou: 40, all: 90 }, true);
    expect(moving()).toEqual(STILL);
    room('!b', { ...COUNTS, needsYou: 41, all: 91 }, true);
    expect(byClass(css.PingDot)).toHaveLength(1);
  });
});
