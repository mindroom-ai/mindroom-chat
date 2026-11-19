import { describe, expect, it } from 'vitest';
import type {
  CommandPaletteActionItem,
  CommandPaletteRoomItem,
  CommandPaletteThreadItem,
  CommandPaletteUserItem,
} from './commandPaletteTypes';
import { commandPaletteSearchConfig, matchCommandPaletteSection } from './commandPaletteSearch';

const action = (
  id: string,
  title: string,
  rest: Partial<CommandPaletteActionItem> = {}
): CommandPaletteActionItem => ({ id, kind: 'action', title, ...rest });

const room = (
  id: string,
  name: string,
  rest: Partial<CommandPaletteRoomItem> = {}
): CommandPaletteRoomItem => ({ id, kind: 'room', name, ...rest });

const user = (
  id: string,
  displayName: string,
  userId: string,
  rest: Partial<CommandPaletteUserItem> = {}
): CommandPaletteUserItem => ({
  id,
  kind: 'user',
  displayName,
  userId,
  localpart: userId.slice(1, userId.indexOf(':')),
  ...rest,
});

const ids = (items: readonly { id: string }[]) => items.map((item) => item.id);

const searchRooms = (items: CommandPaletteRoomItem[], query: string) =>
  ids(
    matchCommandPaletteSection({ items, query, config: commandPaletteSearchConfig.rooms }).map(
      ({ item }) => item
    )
  );

const searchUsers = (items: CommandPaletteUserItem[], query: string) =>
  ids(
    matchCommandPaletteSection({ items, query, config: commandPaletteSearchConfig.users }).map(
      ({ item }) => item
    )
  );

const searchActions = (items: CommandPaletteActionItem[], query: string) =>
  ids(
    matchCommandPaletteSection({ items, query, config: commandPaletteSearchConfig.actions }).map(
      ({ item }) => item
    )
  );

describe('commandPaletteSearchConfig', () => {
  const shape = (config: { fields: readonly { key: string; weight: number; name?: boolean }[] }) =>
    config.fields.map(({ key, weight, name }) => [key, weight, !!name]);

  it('searches each list by its fields, the names at full weight', () => {
    expect(shape(commandPaletteSearchConfig.actions)).toEqual([
      ['title', 1, true],
      ['keywords', 0.7, false],
      ['description', 0.5, false],
      ['tag', 0.5, false],
    ]);
    expect(shape(commandPaletteSearchConfig.rooms)).toEqual([
      ['name', 1, true],
      ['canonicalAlias', 0.7, false],
      ['topic', 0.5, false],
      ['parentNames', 0.5, false],
      ['tag', 0.4, false],
    ]);
    expect(shape(commandPaletteSearchConfig.users)).toEqual([
      ['displayName', 1, true],
      ['userName', 0.8, true],
      ['userId', 0.5, false],
      ['agentId', 0.5, false],
      ['dmRoomName', 0.5, false],
    ]);
    expect(shape(commandPaletteSearchConfig.threads)).toEqual([
      ['summaryText', 1, false],
      ['tags', 0.7, false],
      ['roomName', 0.5, false],
      ['participantNames', 0.5, false],
    ]);
  });
});

describe('matchCommandPaletteSection rows', () => {
  it('keeps the starter order without text, up to the limit', () => {
    const items = [
      action('logout', 'Logout', { sortRank: 10 }),
      action('settings', 'Open Settings', { sortRank: 20 }),
      action('home', 'Go Home', { sortRank: 30 }),
    ];

    const results = matchCommandPaletteSection({
      items,
      query: '   ',
      config: { ...commandPaletteSearchConfig.actions, limit: 2 },
    }).map(({ item }) => item);

    expect(ids(results)).toEqual(['home', 'settings']);
  });

  it('finds a room by the name of its parent space', () => {
    const items = [
      room('!eng:example.org', 'Engineering', { parentNames: ['Platform'] }),
      room('!sales:example.org', 'Sales'),
    ];

    expect(searchRooms(items, 'platform')).toEqual(['!eng:example.org']);
  });

  it('finds a thread by a tag', () => {
    const items: CommandPaletteThreadItem[] = [
      {
        id: '$thread-1',
        kind: 'thread',
        roomId: '!a:example.org',
        threadId: '$1',
        summaryText: 'Investigate login issue',
        roomName: 'Support',
        tags: ['urgent'],
      },
      {
        id: '$thread-2',
        kind: 'thread',
        roomId: '!a:example.org',
        threadId: '$2',
        summaryText: 'Review docs',
        roomName: 'Docs',
        tags: ['docs'],
      },
    ];

    const results = matchCommandPaletteSection({
      items,
      query: 'urgent',
      config: commandPaletteSearchConfig.threads,
    }).map(({ item }) => item);

    expect(ids(results)).toEqual(['$thread-1']);
  });

  it('breaks equal matches by boost, then rank, then ID', () => {
    const items = [
      user('@older:example.org', 'Alice', '@older:example.org', { boost: 10 }),
      user('@recent:example.org', 'Alice', '@recent:example.org', { boost: 100 }),
    ];
    expect(searchUsers(items, 'alice')).toEqual(['@recent:example.org', '@older:example.org']);

    const ranked = [
      room('!b:example.org', 'Team B', { sortRank: 1 }),
      room('!c:example.org', 'Team C', { sortRank: 2 }),
      room('!a:example.org', 'Team A', { sortRank: 1 }),
    ];
    expect(searchRooms(ranked, 'team')).toEqual([
      '!c:example.org',
      '!a:example.org',
      '!b:example.org',
    ]);
  });

  it('ranks a better match above a boosted one', () => {
    const items = [
      room('!boosted:example.org', 'Engineering Platform', { boost: 25 }),
      room('!named:example.org', 'Platform'),
    ];

    expect(searchRooms(items, 'platform')).toEqual(['!named:example.org', '!boosted:example.org']);
  });

  it('needs every typed word, in any order, in any of the fields', () => {
    const items = [
      room('!eng:example.org', 'Engineering', { topic: 'Deploys', parentNames: ['MindRoom'] }),
      room('!design:example.org', 'Design', { parentNames: ['MindRoom'] }),
    ];

    expect(searchRooms(items, 'mindroom eng')).toEqual(['!eng:example.org']);
    expect(searchRooms(items, 'deploy engineering')).toEqual(['!eng:example.org']);
    expect(searchRooms(items, 'eng zebra')).toEqual([]);
  });

  it('ranks a name that holds the typed words in order above one that holds them apart', () => {
    const items = [
      action('other', 'Room to create', { sortRank: 9 }),
      action('create-room', 'Create Room'),
    ];

    expect(searchActions(items, 'create room')).toEqual(['create-room', 'other']);
  });

  it('ranks a match in the name above one in the search words, above one in the description', () => {
    const items = [
      action('description', 'Toggle', { description: 'Switch the theme' }),
      action('keyword', 'Appearance', { keywords: ['theme'] }),
      action('title', 'Theme'),
    ];

    expect(searchActions(items, 'theme')).toEqual(['title', 'keyword', 'description']);
  });

  it('matches initials and abbreviations in names only', () => {
    const items = [
      action('create-room', 'Create Room'),
      action('other', 'Other', { description: 'Create Room', keywords: ['create room'] }),
    ];

    expect(searchActions(items, 'cr')).toContain('create-room');
    expect(searchActions(items, 'crm')).toEqual(['create-room']);
  });

  it('finds a row by its tag only beside a word that matches the row itself', () => {
    const items = [
      action('page-theme', 'Theme'),
      action('theme:dark', 'Dark', { tag: 'Theme' }),
      action('theme:dracula', 'Dracula', { tag: 'Theme' }),
      action('setting:zoom', 'Page Zoom', { tag: 'Settings' }),
    ];

    expect(searchActions(items, 'theme')).toEqual(['page-theme']);
    expect(searchActions(items, 'theme dracula')).toEqual(['theme:dracula']);
    expect(searchActions(items, 'dark theme')).toEqual(['theme:dark']);
    expect(searchActions(items, 'settings')).toEqual([]);
    expect(searchActions(items, 'settings zoom')).toEqual(['setting:zoom']);
    expect(searchActions(items, 'theme settings')).toEqual([]);
  });

  it('tells a space from a room of the same name by the word for its kind', () => {
    const items = [
      room('!garden-room:example.org', 'Garden', { tag: 'Room' }),
      room('!garden-space:example.org', 'Garden', { kind: 'space', tag: 'Space' }),
      room('!gardening:example.org', 'Gardening', { tag: 'Room' }),
    ];

    expect(searchRooms(items, 'spa garden')).toEqual(['!garden-space:example.org']);
    expect(searchRooms(items, 'space garden')).toEqual(['!garden-space:example.org']);
    expect(searchRooms(items, 'room garden')).toEqual([
      '!garden-room:example.org',
      '!gardening:example.org',
    ]);
    expect(searchRooms(items, 'space')).toEqual([]);
  });

  it('puts a word a room holds above the word for its kind', () => {
    const sprint = room('!sprint:example.org', 'Garden', {
      tag: 'Room',
      topic: 'Current sprint plans',
    });
    const space = room('!space:example.org', 'Garden', { kind: 'space', tag: 'Space' });
    const progress = room('!progress:example.org', 'Garden Progress', { tag: 'Room' });
    const plain = room('!plain:example.org', 'Garden', { tag: 'Room' });
    const gardening = room('!gardening:example.org', 'Gardening', {
      tag: 'Room',
      topic: 'Current sprint plans',
    });

    // One or two letters of a kind are not the kind: the rows are the ones the words find.
    expect(searchRooms([space, sprint, gardening], 'garden sp')).toEqual([
      '!sprint:example.org',
      '!gardening:example.org',
    ]);
    expect(searchRooms([plain, progress], 'garden ro')).toEqual(['!progress:example.org']);
    // Nor is a word that is only inside it, or a typo of it.
    expect(searchRooms([space], 'garden pace')).toEqual([]);
    expect(searchRooms([space], 'garden spare')).toEqual([]);
    // A kind word of one letter, such as Korean 룸, counts typed in full.
    const korean = room('!korean:example.org', 'Garden', { tag: '룸' });
    expect(searchRooms([korean, space], '룸 garden')).toEqual(['!korean:example.org']);

    const weekly = room('!weekly:example.org', 'Garden', {
      tag: 'Room',
      topic: 'Weekly room schedule',
    });
    const [match] = matchCommandPaletteSection({
      items: [weekly],
      query: 'room garden',
      config: commandPaletteSearchConfig.rooms,
    });
    expect(Object.keys(match?.marks ?? {}).sort()).toEqual(['name', 'topic']);
  });

  it('takes no initials of a thread title, which is a sentence', () => {
    const items: CommandPaletteThreadItem[] = [
      {
        id: '$dialog',
        kind: 'thread',
        roomId: '!a:example.org',
        threadId: '$1',
        summaryText: 'Create room dialog loses focus',
        roomName: 'Frontend',
      },
    ];
    const search = (query: string) =>
      ids(
        matchCommandPaletteSection({
          items,
          query,
          config: commandPaletteSearchConfig.threads,
        }).map(({ item }) => item)
      );

    expect(search('crd')).toEqual([]);
    expect(search('dialog')).toEqual(['$dialog']);
  });

  it('finds a person by name, user name and user ID, with or without the @', () => {
    const items = [
      user('john', 'John Smith', '@jsmith:example.org'),
      user('anna', 'Anna Lee', '@anna:matrix.org'),
    ];

    expect(searchUsers(items, 'jsmith')).toEqual(['john']);
    expect(searchUsers(items, '@jsmith')).toEqual(['john']);
    expect(searchUsers(items, '@jsmith:example.org')).toEqual(['john']);
    expect(searchUsers(items, 'matrix.org')).toEqual(['anna']);
    expect(searchUsers(items, '@')).toEqual(['anna', 'john']);
  });

  it("finds an agent by its user name without MindRoom's prefix, typed with it or not", () => {
    const items = [
      user('code', 'Code', '@mindroom_code:example.org'),
      user('helper', 'Helper', '@mindroom_assistant:example.org'),
      user('mindy', 'Mindy Room', '@mindy:example.org'),
    ];

    expect(searchUsers(items, 'assistant')).toEqual(['helper']);
    expect(searchUsers(items, 'mindroom_assistant')).toEqual(['helper']);
    expect(searchUsers(items, '@mindroom_code:example.org')).toEqual(['code']);
    expect(searchUsers(items, 'mind')).toEqual(['mindy']);
    expect(searchUsers(items, 'room')).toEqual(['mindy']);
  });

  it('finds a room by its name or alias typed with the # of an alias', () => {
    const items = [
      room('!gen:example.org', 'General'),
      room('!eng:example.org', 'Engineering', { canonicalAlias: '#eng-team:example.org' }),
    ];

    expect(searchRooms(items, '#general')).toEqual(['!gen:example.org']);
    expect(searchRooms(items, '#eng-team')).toEqual(['!eng:example.org']);
    expect(searchRooms(items, '#eng-team:example.org')).toEqual(['!eng:example.org']);
    // The sign alone is no text.
    expect(searchRooms(items, '#')).toHaveLength(2);
  });

  it('ignores a field that is missing, empty or an empty list', () => {
    const items = [
      room('!bare:example.org', 'Bare', { topic: '', parentNames: [], canonicalAlias: undefined }),
      room('!empty:example.org', ''),
    ];

    expect(searchRooms(items, 'bare')).toEqual(['!bare:example.org']);
    expect(searchRooms(items, 'topic')).toEqual([]);
  });

  it('answers a pasted paragraph', () => {
    const items = [room('!a:example.org', 'General', { topic: 'lorem ipsum dolor sit amet' })];
    const paragraph = 'lorem ipsum dolor sit amet consectetur adipiscing elit '.repeat(10);

    expect(searchRooms(items, paragraph)).toEqual([]);
    expect(searchRooms(items, 'x'.repeat(500))).toEqual([]);
  });

  it('searches a list by what it holds now, not by one that looked the same before', () => {
    const before = [room('!a:example.org', 'General')];
    const after = [room('!a:example.org', 'Random')];

    expect(searchRooms(before, 'general')).toEqual(['!a:example.org']);
    expect(searchRooms(after, 'general')).toEqual([]);
    expect(searchRooms([...before], 'general')).toEqual(['!a:example.org']);
  });
});

describe('matchCommandPaletteSection', () => {
  const matchRooms = (items: CommandPaletteRoomItem[], query: string, ordered = false) =>
    matchCommandPaletteSection({
      items,
      query,
      config: commandPaletteSearchConfig.rooms,
      ordered,
    });

  it('marks what matched in each field, as ranges of the text as written', () => {
    const [match] = matchRooms(
      [room('!cafe:example.org', 'Café Français', { topic: 'On parle français' })],
      'francais cafe'
    );

    expect(match?.marks).toEqual({
      name: [
        [0, 4],
        [5, 13],
      ],
    });
  });

  it('marks the field a word matched best, not every field that holds it', () => {
    const [match] = matchRooms(
      [room('!eng:example.org', 'Engineering', { topic: 'Engineering deploys' })],
      'deploys eng'
    );

    expect(match?.marks).toEqual({ name: [[0, 3]], topic: [[12, 19]] });
  });

  it('marks letters that two typed words matched once', () => {
    const [prefix] = matchRooms([room('!create:example.org', 'Create Room')], 'create c');
    expect(prefix?.marks).toEqual({ name: [[0, 6]] });

    const [twice] = matchRooms([room('!general:example.org', 'General')], 'gen gen');
    expect(twice?.marks).toEqual({ name: [[0, 3]] });
  });

  it('marks nothing in a field that is a list', () => {
    const [match] = matchRooms(
      [room('!eng:example.org', 'Engineering', { parentNames: ['Platform'] })],
      'platform'
    );

    expect(match?.marks).toEqual({});
  });

  it('gives no marks and no score without text', () => {
    expect(matchRooms([room('!a:example.org', 'General')], '')).toEqual([
      { item: expect.objectContaining({ id: '!a:example.org' }), score: 0, marks: {} },
    ]);
  });

  it('keeps rows nothing matches after the others, in their order, when asked', () => {
    const items = [
      room('!x:example.org', 'Xylophone'),
      room('!gen:example.org', 'General'),
      room('!y:example.org', 'Yacht'),
    ];

    expect(ids(matchRooms(items, 'gen', true).map(({ item }) => item))).toEqual([
      '!gen:example.org',
      '!x:example.org',
      '!y:example.org',
    ]);
    expect(matchRooms(items, 'gen', true)[1]?.score).toBe(0);
  });

  it('keeps equal rows in their order, and the order itself without text, when asked', () => {
    const items = [room('!z:example.org', 'Team'), room('!a:example.org', 'Team')];

    expect(ids(matchRooms(items, 'team').map(({ item }) => item))).toEqual([
      '!a:example.org',
      '!z:example.org',
    ]);
    expect(ids(matchRooms(items, 'team', true).map(({ item }) => item))).toEqual([
      '!z:example.org',
      '!a:example.org',
    ]);
    expect(ids(matchRooms(items, '', true).map(({ item }) => item))).toEqual([
      '!z:example.org',
      '!a:example.org',
    ]);
  });

  it('scores a name that only starts with the typed words under one that is them', () => {
    const [longer, exact] = [
      matchRooms([room('!a:example.org', 'Url Preview in Encrypted Room')], 'url preview'),
      matchRooms([room('!b:example.org', 'Url Preview')], 'url preview'),
    ];

    expect(exact[0]?.score).toBe(100);
    expect(longer[0]?.score).toBeLessThan(100);
  });

  it('ranks a room named by the typed text above one whose alias starts with it', () => {
    const items = [
      room('!alias:example.org', 'Engineering Platform', {
        canonicalAlias: '#eng-platform:example.org',
        sortRank: 1,
      }),
      room('!named:example.org', 'Engineering', { sortRank: 2 }),
    ];

    expect(ids(matchRooms(items, 'eng').map(({ item }) => item))).toEqual([
      '!named:example.org',
      '!alias:example.org',
    ]);
  });

  it('scores a name that is the typed text 100', () => {
    expect(matchRooms([room('!a:example.org', 'Design System')], 'design system')[0]?.score).toBe(
      100
    );
  });
});
