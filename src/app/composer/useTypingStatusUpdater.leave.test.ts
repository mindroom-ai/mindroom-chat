// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { TYPING_TIMEOUT_MS } from '../matrix/state/typingMembers';
import { useTypingStatusUpdater } from './useTypingStatusUpdater';

const recordingClient = () => {
  const calls: unknown[][] = [];
  const requests: unknown[][] = [];
  return {
    calls,
    requests,
    client: {
      sendTyping: (...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve({});
      },
      getUserId: () => '@ash:example.org',
      getAccessToken: () => 'secret-token',
      http: {
        getUrl: (path: string) => new URL(`https://matrix.example.org/_matrix/client/v3${path}`),
        // Synchronous up to its fetch: the request must start before the page goes.
        requestOtherUrl: (...args: unknown[]) => {
          requests.push(args);
          return Promise.resolve({});
        },
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

  it('ends the typing notice in a request that outlives the page when the page goes', () => {
    const { calls, requests, client } = recordingClient();
    let update!: (typing: boolean) => void;
    const Harness = () => {
      update = useTypingStatusUpdater(client, '!garden:example.org');
      return null;
    };
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(React.createElement(Harness));
    });

    update(true);
    window.dispatchEvent(new Event('pagehide'));
    // A second pagehide (the page kept for back and forward, then left again) sends nothing.
    window.dispatchEvent(new Event('pagehide'));
    act(() => renderer.unmount());

    expect(requests).toEqual([
      [
        'PUT',
        new URL(
          'https://matrix.example.org/_matrix/client/v3/rooms/!garden%3Aexample.org/typing/%40ash%3Aexample.org'
        ),
        { typing: false },
        { keepAlive: true, headers: { Authorization: 'Bearer secret-token' } },
      ],
    ]);
    expect(calls).toEqual([['!garden:example.org', true, TYPING_TIMEOUT_MS]]);
  });

  it('sends nothing when the page goes and the person was not typing', () => {
    const { calls, requests, client } = recordingClient();
    const Harness = () => {
      useTypingStatusUpdater(client, '!garden:example.org');
      return null;
    };
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(React.createElement(Harness));
    });
    window.dispatchEvent(new Event('pagehide'));
    act(() => renderer.unmount());

    expect(requests).toEqual([]);
    expect(calls).toEqual([]);
  });
});
