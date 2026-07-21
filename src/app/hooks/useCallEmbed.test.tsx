import React, { createRef } from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { Room } from 'matrix-js-sdk';
import {
  CallEmbedRefContextProvider,
  getCallEmbedViewportPlacement,
  useCallJoined,
  useCallEmbedRef,
  useCallStart,
} from './useCallEmbed';
import { CallEmbed } from '../plugins/call';

vi.mock('./useMatrixClient', () => ({
  useMatrixClient: () => ({}),
}));

// The real useTheme drags in vanilla-extract styles that cannot load in vitest.
vi.mock('./useTheme', () => ({
  ThemeKind: { Dark: 'dark', Light: 'light' },
  useTheme: () => ({ id: 'dark-theme', kind: 'dark', classNames: [] }),
}));

type StartCall = ReturnType<typeof useCallStart>;

function CallStarter({ onReady }: { onReady: (startCall: StartCall) => void }) {
  const startCall = useCallStart();
  onReady(startCall);
  return <span>call-starter</span>;
}

describe('useCallStart', () => {
  // Regression: the 2026-07-12 device build rendered UserRoomProfileRenderer
  // outside CallEmbedProvider, and useCallStart threw during render for every
  // opened profile ("CallEmbedRef is not provided!"), taking down the whole
  // profile surface before a call could be attempted.
  it('renders without a CallEmbedRef provider and fails only at call time', () => {
    let startCall: StartCall | undefined;
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <CallStarter
          onReady={(fn) => {
            startCall = fn;
          }}
        />
      );
    });

    expect(JSON.stringify(renderer.toJSON())).toContain('call-starter');
    expect(startCall).toBeDefined();
    expect(() => startCall!({} as Room)).toThrow(
      'Failed to start call, No embed container element found!'
    );
  });

  it('fails at call time while the provided container is unmounted', () => {
    let startCall: StartCall | undefined;
    const emptyRef = createRef<HTMLDivElement>();
    act(() => {
      create(
        <CallEmbedRefContextProvider value={emptyRef}>
          <CallStarter
            onReady={(fn) => {
              startCall = fn;
            }}
          />
        </CallEmbedRefContextProvider>
      );
    });

    expect(() => startCall!({} as Room)).toThrow(
      'Failed to start call, No embed container element found!'
    );
  });
});

describe('useCallEmbedRef', () => {
  it('still requires a provider for consumers that own the container', () => {
    function RefConsumer() {
      useCallEmbedRef();
      return null;
    }

    expect(() => {
      act(() => {
        create(<RefConsumer />);
      });
    }).toThrow('CallEmbedRef is not provided!');
  });
});

describe('useCallJoined', () => {
  const makeEmbed = (joined: boolean): CallEmbed =>
    ({
      joined,
      call: { on: vi.fn(), off: vi.fn() },
    } as unknown as CallEmbed);

  function JoinedStatus({ embed }: { embed: CallEmbed }) {
    return <span>{useCallJoined(embed) ? 'joined' : 'joining'}</span>;
  }

  it('resets when a joined embed is replaced by an unjoined embed', () => {
    const first = makeEmbed(true);
    const replacement = makeEmbed(false);
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(<JoinedStatus embed={first} />);
    });
    expect(JSON.stringify(renderer.toJSON())).toContain('joined');

    act(() => {
      renderer.update(<JoinedStatus embed={replacement} />);
    });

    expect(JSON.stringify(renderer.toJSON())).toContain('joining');
  });
});

describe('getCallEmbedViewportPlacement', () => {
  it('positions the fixed call host from viewport coordinates', () => {
    const container = {
      // These offset-parent coordinates caused the call host to cover the app
      // shell when the room pane itself was offset by navigation columns.
      offsetTop: 0,
      offsetLeft: 0,
      clientWidth: 720,
      clientHeight: 480,
      getBoundingClientRect: () => ({
        top: 72,
        left: 396,
        width: 1180,
        height: 764,
      }),
    } as unknown as HTMLDivElement;

    expect(getCallEmbedViewportPlacement(container)).toEqual({
      top: '72px',
      left: '396px',
      width: '1180px',
      height: '764px',
    });
  });
});
