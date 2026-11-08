import { describe, expect, it } from 'vitest';
import {
  advanceHistoryStack,
  emptyHistoryStack,
  findHistoryOrigin,
  showsRoom,
  type HistoryStack,
} from './historyStack';

const entry = (key: string) => ({ key, pathname: `/${key}/`, search: '' });
const walk = (...steps: [string, 'PUSH' | 'REPLACE' | 'POP'][]): HistoryStack =>
  steps.reduce(
    (stack, [key, action]) => advanceHistoryStack(stack, entry(key), action),
    emptyHistoryStack
  );
const previous = (stack: HistoryStack) => stack.entries[stack.index - 1]?.pathname;

describe('advanceHistoryStack', () => {
  it('knows the entry before a pushed page', () => {
    expect(previous(walk(['home', 'POP'], ['list', 'PUSH'], ['room', 'PUSH']))).toBe('/list/');
  });

  it('follows back and forward steps to entries it has seen', () => {
    const stack = walk(['home', 'POP'], ['list', 'PUSH'], ['room', 'PUSH'], ['list', 'POP']);
    expect(stack.index).toBe(1);
    expect(previous(stack)).toBe('/home/');
    expect(walk(['home', 'POP'], ['list', 'PUSH'], ['home', 'POP'], ['list', 'POP']).index).toBe(1);
  });

  it('drops the forward entries when a page is pushed after a back step', () => {
    const stack = walk(
      ['home', 'POP'],
      ['list', 'PUSH'],
      ['room', 'PUSH'],
      ['list', 'POP'],
      ['other', 'PUSH']
    );
    expect(stack.entries.map(({ key }) => key)).toEqual(['home', 'list', 'other']);
  });

  it('puts a replacing page in the current entry', () => {
    const stack = walk(['home', 'POP'], ['room', 'PUSH'], ['list', 'REPLACE']);
    expect(stack.entries.map(({ key }) => key)).toEqual(['home', 'list']);
    expect(previous(stack)).toBe('/home/');
  });

  it('starts over at an entry it has not seen, so it never guesses what came before', () => {
    expect(previous(walk(['home', 'POP'], ['list', 'PUSH'], ['unknown', 'POP']))).toBeUndefined();
  });
});

describe('findHistoryOrigin', () => {
  const page = (key: string, pathname: string, search = '') => ({ key, pathname, search });
  const stack = (...pages: ReturnType<typeof page>[]): HistoryStack => ({
    entries: pages,
    index: pages.length - 1,
  });
  const room = '!harbor:example.org';
  const inRoom = (candidate: { pathname: string; search: string }) =>
    showsRoom(candidate, [room, '#harbor:example.org']);

  it('passes over the pages of the room to the page it was opened from', () => {
    const history = stack(
      page('a', '/home/search/', '?term=crane'),
      page('b', `/home/${encodeURIComponent(room)}/`),
      page('c', `/home/${encodeURIComponent(room)}/%24event`, '?focusEvent=1'),
      page('d', `/home/${encodeURIComponent(room)}/`, '?threadId=%24root')
    );
    expect(findHistoryOrigin(history, (candidate) => !inRoom(candidate))).toEqual({
      steps: 3,
      path: '/home/search/?term=crane',
    });
  });

  it('knows a room by its alias too', () => {
    expect(inRoom(page('a', '/space/%23harbor%3Aexample.org/'))).toBe(true);
    expect(inRoom(page('a', '/home/!garden:example.org/'))).toBe(false);
  });

  it("counts a space's own pages as the space", () => {
    expect(inRoom(page('a', `/${encodeURIComponent(room)}/lobby/`))).toBe(true);
  });

  it('stops at a page of another kind whose path only carries the room, such as a plugin page', () => {
    const plugin = `/p/example/rooms/${encodeURIComponent(room)}/%24root`;
    const history = stack(page('a', plugin), page('b', `/home/${encodeURIComponent(room)}/`));
    expect(findHistoryOrigin(history, (candidate) => !inRoom(candidate))).toEqual({
      steps: 1,
      path: plugin,
    });
  });

  it('tells a thread of the room from the room itself', () => {
    const thread = (candidate: { pathname: string; search: string }) =>
      showsRoom(candidate, [room], ['$root']);
    expect(thread(page('a', `/home/${room}/`, '?threadId=%24root'))).toBe(true);
    expect(thread(page('a', `/home/${room}/`))).toBe(false);
    expect(thread(page('a', `/home/${room}/`, '?threadId=%24other'))).toBe(false);
  });

  it('finds nothing when every page the app has shown is the room', () => {
    const history = stack(page('a', `/home/${room}/`), page('b', `/home/${room}/`, '?threadId=x'));
    expect(findHistoryOrigin(history, (candidate) => !inRoom(candidate))).toBeUndefined();
  });
});
