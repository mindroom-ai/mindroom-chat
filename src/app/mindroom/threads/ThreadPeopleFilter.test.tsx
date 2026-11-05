// @vitest-environment jsdom
import type { Room } from 'matrix-js-sdk';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThreadPeopleFilter } from './ThreadPeopleFilter';
import * as peopleFilter from './threadPeopleFilter';
import type { ThreadRecord } from './types';

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test-utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});
vi.mock('../../hooks/useMatrixClient', () => ({ useMatrixClient: () => ({}) }));
vi.mock('../../hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));
vi.mock('./threadPeopleFilter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./threadPeopleFilter')>();
  return { ...actual, buildThreadPeopleActivity: vi.fn(actual.buildThreadPeopleActivity) };
});

const NAMES: Record<string, string> = {
  '@alice:example.org': 'Alice',
  '@bob:example.org': 'Bob',
  '@carol:example.org': 'Carol',
  '@mindroom_helper:example.org': 'Helper',
};
const room = {
  roomId: '!room:example.org',
  getMember: (userId: string) =>
    NAMES[userId] ? { rawDisplayName: NAMES[userId], getMxcAvatarUrl: () => undefined } : null,
} as unknown as Room;

const record = (threadRootId: string, peopleIds: string[]): ThreadRecord =>
  ({
    roomId: room.roomId,
    threadRootId,
    presentation: { participantIds: [], replyParticipantIds: [], peopleIds },
    status: { lastActivityTs: 0 },
  } as unknown as ThreadRecord);

const records = new Map([
  ['$1', record('$1', ['@alice:example.org', '@mindroom_helper:example.org'])],
  ['$2', record('$2', ['@bob:example.org', '@mindroom_helper:example.org'])],
  ['$3', record('$3', ['@carol:example.org'])],
]);

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.mocked(peopleFilter.buildThreadPeopleActivity).mockClear();
});

const render = (props: { selected?: string[]; onToggle?: (userId: string) => void } = {}) => {
  const element = (
    selected: string[] | undefined,
    map: ReadonlyMap<string, ThreadRecord> = records
  ) => (
    <ThreadPeopleFilter
      room={room}
      records={map}
      selected={selected}
      onToggle={props.onToggle ?? vi.fn()}
    />
  );
  act(() => {
    renderer = create(element(props.selected));
  });
  return (selected: string[] | undefined, map?: ReadonlyMap<string, ThreadRecord>) =>
    act(() => renderer?.update(element(selected, map)));
};

const byData = (name: string): ReactTestInstance[] =>
  renderer?.root.findAll((node) => typeof node.type === 'string' && name in node.props) ?? [];
const one = (name: string): ReactTestInstance => {
  const [node] = byData(name);
  if (!node) throw new Error(`no ${name}`);
  return node;
};
const listedPeople = () => byData('data-person-option').map((node) => node.props['data-person-option']);
const open = () =>
  act(() => {
    one('data-people-filter-button').props.onClick();
  });

describe('the People dropdown', () => {
  it('lists the people of the threads, most active first, with agents marked', () => {
    render();
    expect(byData('data-people-filter-panel')).toHaveLength(0);
    open();
    expect(listedPeople()).toEqual([
      '@mindroom_helper:example.org',
      '@alice:example.org',
      '@bob:example.org',
      '@carol:example.org',
    ]);
    const helper = one('data-person-option');
    expect(helper.findAllByProps({ children: 'Agent' }).length).toBeGreaterThan(0);
  });

  it('narrows the list by name or Matrix ID', () => {
    render();
    open();
    act(() => {
      one('data-people-filter-search').props.onChange({ target: { value: 'car' } });
    });
    expect(listedPeople()).toEqual(['@carol:example.org']);
    act(() => {
      one('data-people-filter-search').props.onChange({ target: { value: 'bob:example' } });
    });
    expect(listedPeople()).toEqual(['@bob:example.org']);
    act(() => {
      one('data-people-filter-search').props.onChange({ target: { value: 'nobody' } });
    });
    expect(listedPeople()).toEqual([]);
  });

  it('checks a person and shows the count of chosen people on its button', () => {
    const onToggle = vi.fn();
    const rerender = render({ onToggle });
    expect(one('data-people-filter-button').props['aria-label']).toBe('Filter threads by people');
    open();
    const [bob] = byData('data-person-option').filter(
      (node) => node.props['data-person-option'] === '@bob:example.org'
    );
    if (!bob) throw new Error('no Bob');
    act(() => {
      bob.findByProps({ readOnly: true }).props.onClick();
    });
    expect(onToggle).toHaveBeenCalledWith('@bob:example.org');

    rerender(['@bob:example.org', '@carol:example.org']);
    expect(one('data-people-filter-button').props['data-people-filter-count']).toBe(2);
    expect(one('data-people-filter-button').props['aria-label']).toBe(
      'Filter threads by people (2 selected)'
    );
  });

  it('keeps a chosen person listed after their threads are gone', () => {
    const rerender = render({ selected: ['@dave:example.org'] });
    open();
    expect(listedPeople()).toContain('@dave:example.org');
    rerender(['@dave:example.org'], new Map());
    expect(listedPeople()).toEqual(['@dave:example.org']);
  });

  it('builds its list once per change of the threads, not per render or per choice', () => {
    const rerender = render();
    expect(peopleFilter.buildThreadPeopleActivity).not.toHaveBeenCalled();
    open();
    expect(peopleFilter.buildThreadPeopleActivity).toHaveBeenCalledTimes(1);

    rerender(['@alice:example.org']);
    rerender(['@alice:example.org', '@bob:example.org']);
    rerender(undefined);
    act(() => {
      one('data-people-filter-search').props.onChange({ target: { value: 'a' } });
    });
    expect(peopleFilter.buildThreadPeopleActivity).toHaveBeenCalledTimes(1);

    rerender(undefined, new Map(records));
    expect(peopleFilter.buildThreadPeopleActivity).toHaveBeenCalledTimes(2);
  });
});
