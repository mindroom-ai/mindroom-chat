// @vitest-environment jsdom
import type { Room } from 'matrix-js-sdk';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThreadPeopleFilter } from './ThreadPeopleFilter';
import * as peopleFilter from '../../event-store/threads/threadPeopleFilter';
import type { ThreadRecord } from '../../event-store/threads/types';

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});
const getUserSpy = vi.fn((userId: string) =>
  userId === '@extern:example.org'
    ? { displayName: 'Private Nickname', avatarUrl: 'mxc://example.org/private' }
    : null
);
const mockClient = {
  getHomeserverUrl: () => 'https://example.org',
  getUser: getUserSpy,
  mxcUrlToHttp: (mxc: string) =>
    mxc ? mxc.replace('mxc://', 'https://example.org/_matrix/media/v3/download/') : null,
};
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mockClient }));
vi.mock('../../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));
vi.mock('../../event-store/threads/threadPeopleFilter', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../event-store/threads/threadPeopleFilter')>();
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
  }) as unknown as ThreadRecord;

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
  getUserSpy.mockClear();
});

const render = (
  props: { selected?: string[]; onToggle?: (userId: string) => void; onClear?: () => void } = {}
) => {
  const element = (
    selected: string[] | undefined,
    map: ReadonlyMap<string, ThreadRecord> = records
  ) => (
    <ThreadPeopleFilter
      room={room}
      records={map}
      selected={selected}
      onToggle={props.onToggle ?? vi.fn()}
      onClear={props.onClear ?? vi.fn()}
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
const listedPeople = () =>
  byData('data-person-option').map((node) => node.props['data-person-option']);
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
    // A press on the row must not take the focus out of the panel, which would close it.
    const preventDefault = vi.fn();
    one('data-people-filter-list').props.onMouseDown({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
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

  it('clears everyone at once, with a Clear button only while someone is chosen', () => {
    const onClear = vi.fn();
    const rerender = render({ onClear });
    open();
    expect(byData('data-people-filter-clear')).toHaveLength(0);
    rerender(['@bob:example.org', '@carol:example.org']);
    act(() => {
      one('data-people-filter-clear').props.onClick();
    });
    expect(onClear).toHaveBeenCalledTimes(1);
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

  it('resolves display names and avatars across multiple rooms with user and localpart fallbacks', () => {
    const makeLookupRoom = (
      roomId: string,
      members: Record<string, { rawDisplayName?: string; avatarMxc?: string }>
    ) =>
      ({
        roomId,
        getMember: (userId: string) => {
          const member = members[userId];
          return member
            ? {
                rawDisplayName: member.rawDisplayName,
                getMxcAvatarUrl: () => member.avatarMxc,
              }
            : null;
        },
      }) as unknown as Room;

    const roomA = makeLookupRoom('!a:example.org', {
      '@alice:example.org': { rawDisplayName: 'Alice A' },
    });
    const roomB = makeLookupRoom('!b:example.org', {
      '@alice:example.org': { rawDisplayName: 'Alice B', avatarMxc: 'mxc://example.org/alice' },
      '@bob:example.org': { rawDisplayName: 'Bob B', avatarMxc: 'mxc://example.org/bob' },
    });
    const multiRecords = new Map([
      ['$1', record('$1', ['@alice:example.org', '@bob:example.org'])],
      ['$2', record('$2', ['@extern:example.org', '@ghost:example.org'])],
    ]);

    act(() => {
      renderer = create(
        <ThreadPeopleFilter
          rooms={[roomA, roomB]}
          records={multiRecords}
          selected={undefined}
          onToggle={vi.fn()}
          onClear={vi.fn()}
        />
      );
    });
    open();

    const optionOf = (userId: string) =>
      byData('data-person-option').find((node) => node.props['data-person-option'] === userId)!;
    const textOf = (userId: string) =>
      optionOf(userId)
        .findAllByType('span')
        .map((node) => node.children.join(''))
        .join(' ');
    const imgSrcOf = (userId: string) => optionOf(userId).findAllByType('img')[0]?.props.src;

    expect(textOf('@alice:example.org')).toContain('Alice A');
    expect(imgSrcOf('@alice:example.org')).toBe(
      'https://example.org/_matrix/media/v3/download/example.org/alice'
    );
    expect(textOf('@bob:example.org')).toContain('Bob B');
    expect(imgSrcOf('@bob:example.org')).toBe(
      'https://example.org/_matrix/media/v3/download/example.org/bob'
    );
    // Never leaks global mx.getUser profile/avatar when absent from supplied rooms.
    expect(getUserSpy).not.toHaveBeenCalled();
    expect(textOf('@extern:example.org')).toContain('extern');
    expect(textOf('@extern:example.org')).not.toContain('Private Nickname');
    expect(imgSrcOf('@extern:example.org')).toBeUndefined();
    expect(textOf('@ghost:example.org')).toContain('ghost');
    expect(imgSrcOf('@ghost:example.org')).toBeUndefined();
  });

  it('disambiguates Unicode, homoglyph, and same-room suffixed names into an ltr disambiguator span', () => {
    const makeMembersRoom = (
      roomId: string,
      entries: Array<{ userId: string; rawDisplayName: string; disambiguate?: boolean }>
    ) => {
      const members = entries.map((entry) => ({
        ...entry,
        membership: 'join',
        getMxcAvatarUrl: () => undefined,
      }));
      return {
        roomId,
        getMembers: () => members,
        getMember: (id: string) => members.find((member) => member.userId === id) ?? null,
      } as unknown as Room;
    };

    const joseA = '@jose-a:example.org';
    const joseB = '@jose-b:example.org';
    const latinAlice = '@alice-latin:example.org';
    const cyrillicAlice = '@alice-cyr:example.org';
    const sameRoomA = '@same-a:example.org';
    const sameRoomB = '@same-b:example.org';
    const solo = '@solo:example.org';

    const roomA = makeMembersRoom('!a:example.org', [
      { userId: joseA, rawDisplayName: 'Jose\u0301' },
      { userId: latinAlice, rawDisplayName: 'Alice' },
      { userId: sameRoomA, rawDisplayName: 'Long Name', disambiguate: true },
      { userId: sameRoomB, rawDisplayName: 'Long Name', disambiguate: true },
    ]);
    const roomB = makeMembersRoom('!b:example.org', [
      { userId: joseB, rawDisplayName: 'Jos\u00e9' },
      { userId: cyrillicAlice, rawDisplayName: '\u0410lice' },
      { userId: solo, rawDisplayName: 'Solo' },
    ]);
    const collidingRecords = new Map([
      ['$1', record('$1', [joseA, latinAlice, sameRoomA, sameRoomB])],
      ['$2', record('$2', [joseB, cyrillicAlice, solo])],
    ]);

    act(() => {
      renderer = create(
        <ThreadPeopleFilter
          rooms={[roomA, roomB]}
          records={collidingRecords}
          selected={undefined}
          onToggle={vi.fn()}
          onClear={vi.fn()}
        />
      );
    });
    open();

    const optionOf = (userId: string) =>
      byData('data-person-option').find((node) => node.props['data-person-option'] === userId)!;
    const disambiguatorNodesOf = (userId: string) =>
      optionOf(userId).findAll(
        (node) => typeof node.type === 'string' && 'data-person-disambiguator' in node.props
      );
    const nameTextOf = (userId: string) =>
      optionOf(userId)
        .findAll(
          (node) =>
            typeof node.type === 'string' &&
            node.type === 'span' &&
            !('data-person-disambiguator' in node.props) &&
            node.children.every((child) => typeof child === 'string')
        )
        .map((node) => node.children.join(''));

    for (const userId of [joseA, joseB, latinAlice, cyrillicAlice, sameRoomA, sameRoomB]) {
      const nodes = disambiguatorNodesOf(userId);
      expect(nodes.map((node) => node.children.join(''))).toEqual([userId]);
      expect(nodes[0]?.props.dir).toBe('ltr');
    }
    expect(nameTextOf(sameRoomA)).toContain('Long Name');
    expect(nameTextOf(sameRoomA).join(' ')).not.toContain(sameRoomA);
    expect(disambiguatorNodesOf(solo)).toEqual([]);
  });
});
