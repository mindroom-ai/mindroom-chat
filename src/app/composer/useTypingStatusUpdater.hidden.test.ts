// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { getDefaultStore } from 'jotai';
import { afterEach, describe, expect, it } from 'vitest';
import { TYPING_TIMEOUT_MS } from '../matrix/state/typingMembers';
import { conversationCoveredAtom } from '../navigation/conversationCover';
import { useTypingStatusUpdater } from './useTypingStatusUpdater';

const ROOM = '!garden:example.org';

const mountUpdater = (hidden: boolean) => {
  const calls: unknown[][] = [];
  const client = {
    sendTyping: (...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve({});
    },
  } as never;
  let update!: (typing: boolean) => void;
  const Harness = ({ hide }: { hide: boolean }) => {
    update = useTypingStatusUpdater(client, ROOM, hide);
    return null;
  };
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(React.createElement(Harness, { hide: hidden }));
  });
  return {
    calls,
    type: (typing: boolean) => update(typing),
    setHidden: (hide: boolean) =>
      act(() => renderer.update(React.createElement(Harness, { hide }))),
    unmount: () => act(() => renderer.unmount()),
  };
};

describe('useTypingStatusUpdater with activity hidden', () => {
  it('never tells the room the person is typing', () => {
    const updater = mountUpdater(true);
    updater.type(true);
    updater.type(false);
    updater.type(true);
    updater.unmount();
    expect(updater.calls).toEqual([]);
  });

  it('ends a notice sent before the setting was turned on, and sends no new one', () => {
    const updater = mountUpdater(false);
    updater.type(true);
    updater.setHidden(true);
    updater.type(true);
    updater.type(true);
    expect(updater.calls).toEqual([
      [ROOM, true, TYPING_TIMEOUT_MS],
      [ROOM, false, TYPING_TIMEOUT_MS],
    ]);
  });
});

describe("useTypingStatusUpdater under a plugin's cover", () => {
  afterEach(() => {
    act(() => getDefaultStore().set(conversationCoveredAtom, false));
  });

  it('ends a notice as the cover shows, sends none while it does, and types again after', () => {
    const updater = mountUpdater(false);
    updater.type(true);
    act(() => getDefaultStore().set(conversationCoveredAtom, true));
    const ended = [
      [ROOM, true, TYPING_TIMEOUT_MS],
      [ROOM, false, TYPING_TIMEOUT_MS],
    ];
    expect(updater.calls).toEqual(ended);
    updater.type(true);
    expect(updater.calls).toEqual(ended);
    act(() => getDefaultStore().set(conversationCoveredAtom, false));
    updater.type(true);
    expect(updater.calls).toEqual([...ended, [ROOM, true, TYPING_TIMEOUT_MS]]);
    updater.unmount();
  });
});
