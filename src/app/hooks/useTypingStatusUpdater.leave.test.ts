import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { TYPING_TIMEOUT_MS } from '../state/typingMembers';
import { useTypingStatusUpdater } from './useTypingStatusUpdater';

const recordingClient = () => {
  const calls: unknown[][] = [];
  return {
    calls,
    client: {
      sendTyping: (...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve({});
      },
    } as never,
  };
};

describe('useTypingStatusUpdater when the composer goes away', () => {
  it('ends the typing notice in the room it was sent to', () => {
    const { calls, client } = recordingClient();
    let update!: (typing: boolean) => void;
    const Harness = ({ roomId }: { roomId: string }) => {
      update = useTypingStatusUpdater(client, roomId);
      return null;
    };
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(React.createElement(Harness, { roomId: '!garden:example.org' }));
    });

    update(true);
    act(() => renderer.update(React.createElement(Harness, { roomId: '!orchard:example.org' })));
    update(true);
    act(() => renderer.unmount());

    expect(calls).toEqual([
      ['!garden:example.org', true, TYPING_TIMEOUT_MS],
      ['!garden:example.org', false, TYPING_TIMEOUT_MS],
      ['!orchard:example.org', true, TYPING_TIMEOUT_MS],
      ['!orchard:example.org', false, TYPING_TIMEOUT_MS],
    ]);
  });

  it('sends nothing on the way out when the person was not typing', () => {
    const { calls, client } = recordingClient();
    const Harness = () => {
      useTypingStatusUpdater(client, '!garden:example.org');
      return null;
    };
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(React.createElement(Harness));
    });
    act(() => renderer.unmount());

    expect(calls).toEqual([]);
  });
});
