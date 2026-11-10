import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TYPING_TIMEOUT_MS } from '../matrix/state/typingMembers';
import { useTypingStatusUpdater } from './useTypingStatusUpdater';

let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
});

describe('useTypingStatusUpdater', () => {
  it('keeps failed typing notices from surfacing as unhandled rejections', async () => {
    vi.useFakeTimers();
    // A plain function: Vitest mocks observe returned promises, which would handle the rejection.
    const calls: unknown[][] = [];
    const sendTyping = (...args: unknown[]) => {
      calls.push(args);
      return Promise.reject(new TypeError('Load failed'));
    };
    let sendTypingStatus!: (typing: boolean) => void;
    const Harness = () => {
      sendTypingStatus = useTypingStatusUpdater({ sendTyping } as never, '!room:example.org');
      return null;
    };
    const unhandled: unknown[] = [];
    const trackUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', trackUnhandled);

    try {
      act(() => {
        renderer = create(React.createElement(Harness));
      });
      // Start typing, let the stale notice expire, then start and stop again.
      sendTypingStatus(true);
      await vi.advanceTimersByTimeAsync(TYPING_TIMEOUT_MS);
      sendTypingStatus(true);
      sendTypingStatus(false);
      vi.useRealTimers();
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });

      expect(calls).toEqual([
        ['!room:example.org', true, TYPING_TIMEOUT_MS],
        ['!room:example.org', false, TYPING_TIMEOUT_MS],
        ['!room:example.org', true, TYPING_TIMEOUT_MS],
        ['!room:example.org', false, TYPING_TIMEOUT_MS],
      ]);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', trackUnhandled);
    }
  });

  it('keeps the notice of a room on while any of its composers types, and ends it with the last', async () => {
    vi.useFakeTimers();
    const calls: unknown[][] = [];
    const client = {
      sendTyping: (...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve({});
      },
    } as never;
    // The room page's composer and a thread view's of the same room.
    const typing: Record<'page' | 'view', (typing: boolean) => void> = {} as never;
    const Composer = ({ name }: { name: 'page' | 'view' }) => {
      typing[name] = useTypingStatusUpdater(client, '!room:example.org');
      return null;
    };
    act(() => {
      renderer = create(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(Composer, { name: 'page' }),
          React.createElement(Composer, { name: 'view' })
        )
      );
    });

    typing.page(true);
    typing.view(true);
    typing.page(false);
    expect(calls).toEqual([['!room:example.org', true, TYPING_TIMEOUT_MS]]);
    typing.view(false);
    expect(calls).toEqual([
      ['!room:example.org', true, TYPING_TIMEOUT_MS],
      ['!room:example.org', false, TYPING_TIMEOUT_MS],
    ]);

    // The notice expires once for the room; the next key in either composer starts it again.
    calls.length = 0;
    typing.page(true);
    await vi.advanceTimersByTimeAsync(TYPING_TIMEOUT_MS / 2);
    typing.view(true);
    await vi.advanceTimersByTimeAsync(TYPING_TIMEOUT_MS / 2);
    expect(calls).toEqual([
      ['!room:example.org', true, TYPING_TIMEOUT_MS],
      ['!room:example.org', false, TYPING_TIMEOUT_MS],
    ]);
    typing.view(true);
    expect(calls.at(-1)).toEqual(['!room:example.org', true, TYPING_TIMEOUT_MS]);
    act(() => renderer?.unmount());
    renderer = undefined;
    expect(calls.at(-1)).toEqual(['!room:example.org', false, TYPING_TIMEOUT_MS]);
  });

  it('ends the notice of the room for all its composers once Hide Typing is turned on', () => {
    const calls: unknown[][] = [];
    const client = {
      sendTyping: (...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve({});
      },
    } as never;
    const typing: Record<'page' | 'view', (typing: boolean) => void> = {} as never;
    const Composer = ({ name, hidden }: { name: 'page' | 'view'; hidden: boolean }) => {
      typing[name] = useTypingStatusUpdater(client, '!room:example.org', hidden);
      return null;
    };
    const both = (hidden: boolean) =>
      React.createElement(
        React.Fragment,
        null,
        React.createElement(Composer, { name: 'page', hidden }),
        React.createElement(Composer, { name: 'view', hidden })
      );
    act(() => {
      renderer = create(both(false));
    });
    typing.page(true);
    typing.view(true);
    act(() => renderer?.update(both(true)));

    // The next key in either composer sends the stop, and starts nothing.
    typing.view(true);
    expect(calls).toEqual([
      ['!room:example.org', true, TYPING_TIMEOUT_MS],
      ['!room:example.org', false, TYPING_TIMEOUT_MS],
    ]);
    typing.page(true);
    act(() => renderer?.unmount());
    renderer = undefined;
    expect(calls).toHaveLength(2);
  });
});
