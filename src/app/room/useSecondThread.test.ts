// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountStorageKeys, secondThreadStorageKey } from '../preferences/accountStorageKeys';
import { useSecondThread } from './useSecondThread';

const user = '@u:x';
const key = secondThreadStorageKey(user);
const stored = (): unknown => JSON.parse(localStorage.getItem(key) ?? 'null');

describe('useSecondThread', () => {
  beforeEach(() => localStorage.clear());

  it('remembers B per room across a new hook instance', () => {
    const first = renderHook(() => useSecondThread('!r1', user, undefined));
    act(() => first.result.current.open('$b'));
    expect(first.result.current.threadId).toBe('$b');
    first.unmount();

    expect(renderHook(() => useSecondThread('!r1', user, undefined)).result.current.threadId).toBe(
      '$b'
    );
    expect(
      renderHook(() => useSecondThread('!r2', user, undefined)).result.current.threadId
    ).toBeUndefined();
  });

  it('looks B up again when the room changes', () => {
    localStorage.setItem(key, JSON.stringify({ '!r2': '$b2' }));
    const { result, rerender } = renderHook(({ room }) => useSecondThread(room, user, undefined), {
      initialProps: { room: '!r1' },
    });
    expect(result.current.threadId).toBeUndefined();
    rerender({ room: '!r2' });
    expect(result.current.threadId).toBe('$b2');
  });

  it('close forgets B in its room only', () => {
    const r1 = renderHook(() => useSecondThread('!r1', user, undefined));
    act(() => r1.result.current.open('$b1'));
    const r2 = renderHook(() => useSecondThread('!r2', user, undefined));
    act(() => r2.result.current.open('$b2'));
    act(() => r1.result.current.close());
    expect(r1.result.current.threadId).toBeUndefined();
    expect(stored()).toEqual({ '!r2': '$b2' });
  });

  it.each(['[1]', '3', '{"!r1":5}', 'not json'])('ignores malformed storage %s', (value) => {
    localStorage.setItem(key, value);
    const { result } = renderHook(() => useSecondThread('!r1', user, undefined));
    expect(result.current.threadId).toBeUndefined();
    act(() => result.current.open('$b'));
    expect(stored()).toEqual({ '!r1': '$b' });
  });

  it('closes B when it becomes the main thread', () => {
    const { result, rerender } = renderHook(({ main }) => useSecondThread('!r1', user, main), {
      initialProps: { main: undefined as string | undefined },
    });
    act(() => result.current.open('$b'));
    rerender({ main: '$b' });
    expect(result.current.threadId).toBeUndefined();
    expect(stored()).toEqual({});
  });

  it('is listed among the keys sign-out removes', () => {
    expect(accountStorageKeys(user)).toEqual(
      expect.arrayContaining(['mindroom.secondThread:@u:x', 'mindroom.secondThread.width:@u:x'])
    );
  });
});
