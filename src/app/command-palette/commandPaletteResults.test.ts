import { describe, expect, it } from 'vitest';
import { getCommandPaletteLocalSections, rankCommandPalettePeople } from './commandPaletteResults';
import type {
  CommandPaletteActionItem,
  CommandPaletteRoomItem,
  CommandPaletteTab,
  CommandPaletteThreadItem,
  CommandPaletteUserItem,
} from './commandPaletteTypes';

const action = (id: string, title: string, sortRank = 0): CommandPaletteActionItem => ({
  id,
  kind: 'action',
  title,
  sortRank,
});

const room = (
  id: string,
  name: string,
  rest: Partial<CommandPaletteRoomItem> = {}
): CommandPaletteRoomItem => ({ id, kind: 'room', name, ...rest });

const thread = (id: string, summaryText: string): CommandPaletteThreadItem => ({
  id,
  kind: 'thread',
  roomId: '!room:example.org',
  threadId: id,
  summaryText,
  roomName: 'Room',
});

const user = (id: string, displayName: string, boost = 0): CommandPaletteUserItem => ({
  id,
  kind: 'user',
  displayName,
  userId: `@${id}:example.org`,
  localpart: id,
  boost,
});

const SOURCE = {
  actions: [action('page-theme', 'Theme', 25), action('logout', 'Logout', 10)],
  commands: [action('theme:dark', 'Dark'), action('setting:zoom', 'Page Zoom')],
  rooms: [
    room('room:dark', 'Dark Mode Feedback', { sortRank: 3 }),
    room('room:general', 'General', { sortRank: 2 }),
    room('space:team', 'Team', { kind: 'space', sortRank: 1 }),
  ],
  threads: [thread('thread:contrast', 'Theme contrast in dark mode')],
  getUsers: () => [user('darko', 'Darko Milic'), user('gen', 'Gen Tanaka')],
};

const sections = (searchText: string, tab: CommandPaletteTab = 'all', source = SOURCE) =>
  getCommandPaletteLocalSections({ source, tab, searchText }).map(({ id, items }) => [
    id,
    ...items.map((item) => item.id),
  ]);

describe('getCommandPaletteLocalSections', () => {
  it('lists threads, rooms, the first actions and people before anything is typed', () => {
    expect(sections('')).toEqual([
      ['threads', 'thread:contrast'],
      ['rooms', 'room:dark', 'room:general'],
      ['actions', 'page-theme', 'logout'],
      ['users', 'darko', 'gen'],
    ]);
  });

  it('lists spaces on the Rooms tab, and commands only for typed text', () => {
    expect(sections('', 'rooms')).toEqual([['rooms', 'room:dark', 'room:general', 'space:team']]);
    expect(sections('', 'actions')).toEqual([['actions', 'page-theme', 'logout']]);
    expect(sections('zoom', 'actions')).toEqual([['actions', 'setting:zoom']]);
  });

  it('ranks actions and commands as one list', () => {
    expect(sections('dark', 'actions')).toEqual([['actions', 'theme:dark']]);
    expect(sections('t', 'actions')[0]?.slice(0, 2)).toEqual(['actions', 'page-theme']);
  });

  it('puts the section whose first row is named as typed first on All', () => {
    // "Dark" is the theme's whole name; the room and the thread only hold the word.
    expect(sections('dark').map(([id]) => id)).toEqual(['actions', 'threads', 'rooms', 'users']);
  });

  it('puts a section that holds the text at a word start above one that holds it inside a word', () => {
    const source = {
      ...SOURCE,
      rooms: [room('room:kindred', 'Kindred')],
      threads: [],
      getUsers: () => [user('ingrid', 'Ingrid Berg')],
    };
    expect(sections('in', 'all', source).map(([id]) => id)).toEqual(['users', 'rooms']);
  });

  it('puts a section that holds a typo of the text above one that only abbreviates it', () => {
    const source = {
      ...SOURCE,
      rooms: [room('room:crab', 'Crab Eaters')],
      threads: [],
      getUsers: () => [user('bot', 'Create Bot')],
    };
    // "Create" with two letters swapped, and "CRAb EaTErs".
    expect(sections('craete', 'all', source).map(([id]) => id)).toEqual(['users', 'rooms']);
  });

  it('keeps threads, rooms, people, actions in that order when they match alike', () => {
    expect(sections('gen').map(([id]) => id)).toEqual(['rooms', 'users']);
    expect(sections('the').map(([id]) => id)).toEqual(['threads', 'actions', 'users']);
  });

  it('keeps an empty People section for typed text, which the server may still fill', () => {
    expect(sections('zoom')).toEqual([['actions', 'setting:zoom'], ['users']]);
    expect(sections('zoom', 'users')).toEqual([['users']]);
    expect(sections('zoom', 'rooms')).toEqual([]);
  });

  it('lists nothing local on the Messages tab', () => {
    expect(sections('dark', 'messages')).toEqual([]);
  });

  it('takes the first few of each section on All, and up to fifty on a tab of its own', () => {
    const rooms = Array.from({ length: 60 }, (_, index) =>
      room(`room:${String(index).padStart(2, '0')}`, `Team ${index}`)
    );
    const source = { ...SOURCE, rooms };
    expect(sections('team', 'all', source)[0]).toHaveLength(1 + 5);
    expect(sections('team', 'rooms', source)[0]).toHaveLength(1 + 50);
  });

  it('carries the marks of each row by its ID', () => {
    const [first] = getCommandPaletteLocalSections({
      source: SOURCE,
      tab: 'rooms',
      searchText: 'gen',
    });
    expect(first?.marks.get('room:general')).toEqual({ name: [[0, 3]] });
  });
});

describe('rankCommandPalettePeople', () => {
  const rank = (people: CommandPaletteUserItem[], query: string) =>
    rankCommandPalettePeople(people, query).map(({ item }) => item.id);

  it('ranks local and server people together by how well they match', () => {
    const local = [user('johnny', 'Johnny Appleseed', 10), user('alice', 'Alice Johnson')];
    const server = [user('john', 'John')];
    expect(rank([...local, ...server], 'john')).toEqual(['john', 'johnny', 'alice']);
  });

  it('keeps equal matches in the order given, so local rows stay above the server ones', () => {
    const local = [user('zed', 'Sam Stone')];
    const server = [user('abe', 'Sam Stone')];
    expect(rank([...local, ...server], 'sam')).toEqual(['zed', 'abe']);
  });

  it('keeps people the server found its own way after the others, in its order', () => {
    const people = [user('x', 'Xavier'), user('sam', 'Sam Stone'), user('y', 'Yusuf')];
    expect(rank(people, 'sam')).toEqual(['sam', 'x', 'y']);
  });

  it('keeps the order given without text', () => {
    const people = [user('b', 'Bea'), user('a', 'Abe')];
    expect(rank(people, '  ')).toEqual(['b', 'a']);
  });
});
