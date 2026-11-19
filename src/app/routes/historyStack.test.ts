import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  MemoryRouter,
  useNavigate,
  type NavigateFunction,
  type NavigateOptions,
} from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  advanceHistoryStack,
  emptyHistoryStack,
  findHistoryOrigin,
  historyPageOf,
  OPENED_FROM_OUTSIDE_STATE,
  previousHistoryOrigin,
  previousHistoryPathname,
  showsRoom,
  useHistoryStackRecorder,
  type HistoryStack,
} from './historyStack';

const entry = (key: string) => ({ key, pathname: `/${key}/`, search: '', hash: '' });
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

  it('starts over at a page opened from outside the app, and keeps nothing before it on a replace', () => {
    const opened = advanceHistoryStack(
      walk(['home', 'POP'], ['dm', 'PUSH']),
      entry('thread'),
      'PUSH',
      true
    );
    expect(opened.entries.map(({ key }) => key)).toEqual(['thread']);
    const redirected = advanceHistoryStack(opened, entry('reply'), 'REPLACE');
    expect(redirected.entries.map(({ key }) => key)).toEqual(['reply']);
    expect(previous(advanceHistoryStack(redirected, entry('next'), 'PUSH'))).toBe('/reply/');
  });

  it('keeps the pages after a page opened from outside the app when back or forward returns to it', () => {
    const opened = advanceHistoryStack(
      walk(['home', 'POP'], ['dm', 'PUSH']),
      entry('thread'),
      'PUSH',
      true
    );
    const next = advanceHistoryStack(opened, entry('next'), 'PUSH');
    // Back to the page, whose navigation state still says it was opened from outside.
    const back = advanceHistoryStack(next, entry('thread'), 'POP', true);
    expect(back.entries.map(({ key }) => key)).toEqual(['thread', 'next']);
    expect(back.index).toBe(0);
  });

  it('starts over at a page another account shows', () => {
    const as = (key: string, sessionId: string) => ({ ...entry(key), sessionId });
    const first = advanceHistoryStack(
      advanceHistoryStack(emptyHistoryStack, as('home', 'a'), 'POP'),
      as('room', 'a'),
      'PUSH'
    );
    expect(previous(first)).toBe('/home/');
    expect(previous(advanceHistoryStack(first, as('other', 'b'), 'PUSH'))).toBeUndefined();
    expect(previous(advanceHistoryStack(first, as('other', 'b'), 'REPLACE'))).toBeUndefined();
  });
});

describe('useHistoryStackRecorder', () => {
  // The stack is the module's own: each test's first page has a key no other test used, which
  // starts it over.
  const record = async (sessionId: string) => {
    let navigate: NavigateFunction | undefined;
    function Recorder({ session }: { session: string }) {
      useHistoryStackRecorder(session);
      navigate = useNavigate();
      return null;
    }
    const element = (session: string) =>
      React.createElement(
        MemoryRouter,
        { initialEntries: [{ pathname: '/home/', key: `first-page-of-${sessionId}` }] },
        React.createElement(Recorder, { session })
      );
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(element(sessionId));
    });
    return {
      go: (to: string, options?: NavigateOptions, session = sessionId) =>
        act(async () => {
          renderer?.update(element(session));
          navigate?.(to, options);
        }),
      unmount: () => renderer?.unmount(),
    };
  };

  it('keeps no page before one a navigation opened from outside the app', async () => {
    const router = await record('@outside:example.org');
    await router.go('/home/!dm:example.org/');
    expect(previousHistoryPathname()).toBe('/home/');
    await router.go('/home/!room:example.org/%24reply', { state: OPENED_FROM_OUTSIDE_STATE });
    expect(previousHistoryPathname()).toBeUndefined();
    expect(previousHistoryOrigin(() => true)).toBeUndefined();
    await router.go('/home/!room:example.org/%24reply?threadId=%24root', { replace: true });
    expect(previousHistoryOrigin(() => true)).toBeUndefined();
    await router.go('/home/!other:example.org/');
    expect(previousHistoryPathname()).toBe('/home/!room:example.org/%24reply');
    router.unmount();
  });

  it('keeps no page of the account that was active before', async () => {
    const router = await record('@first:example.org');
    await router.go('/home/!first:example.org/');
    expect(previousHistoryPathname()).toBe('/home/');
    await router.go('/home/!second:example.org/', undefined, '@second:example.org');
    expect(previousHistoryPathname()).toBeUndefined();
    await router.go('/home/!second-other:example.org/', undefined, '@second:example.org');
    expect(previousHistoryPathname()).toBe('/home/!second:example.org/');
    router.unmount();
  });
});

describe('findHistoryOrigin', () => {
  const page = (key: string, pathname: string, search = '') => ({
    key,
    pathname,
    search,
    hash: '',
  });
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
    expect(inRoom(page('a', '/%23garden%3Aexample.org/%23harbor%3Aexample.org/'))).toBe(true);
    expect(inRoom(page('a', '/direct/%23harbor%3Aexample.org/'))).toBe(true);
    expect(inRoom(page('a', '/home/!garden:example.org/'))).toBe(false);
  });

  it('knows the room in the Activity and Threads sections', () => {
    expect(inRoom(page('a', `/activity/${encodeURIComponent(room)}/`))).toBe(true);
    expect(inRoom(page('a', `/threads/${encodeURIComponent(room)}/%24event`))).toBe(true);
    expect(inRoom(page('a', '/activity/'))).toBe(false);
  });

  it('reads a recorded path as the page it opens', () => {
    const path = `/home/${encodeURIComponent(room)}/?threadId=%24root`;
    expect(historyPageOf(path)).toEqual({
      pathname: `/home/${encodeURIComponent(room)}/`,
      search: '?threadId=%24root',
    });
    expect(showsRoom(historyPageOf(path), [room], ['$root'])).toBe(true);
    expect(showsRoom(historyPageOf(`/home/${encodeURIComponent(room)}/`), [room], [''])).toBe(true);
  });

  it("counts a space's own pages as the space", () => {
    expect(inRoom(page('a', `/${encodeURIComponent(room)}/lobby/`))).toBe(true);
  });

  it('stops at a page of another kind whose path only carries the room, such as a plugin page', () => {
    expect(inRoom(page('a', `/explore/${encodeURIComponent(room)}/`))).toBe(false);
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
