import React, { createRef } from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { Room } from 'matrix-js-sdk';
import {
  CALL_ROOM_RETIRED_USER_MESSAGE,
  CallEmbedRefContextProvider,
  attemptCallStart,
  getCallEmbedViewportPlacement,
  useCallEmbedRef,
  useCallStart,
} from './useCallEmbed';
import { CallRoomRetiredError } from '../plugins/call';

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

describe('attemptCallStart', () => {
  // The shared guarded-start contract used by every call-start surface
  // (Prescreen Join, RoomNav second click, incoming-call Answer): a refusal
  // is consumed with one warn and mapped to user-presentable copy.
  it('returns undefined and warns nothing when the call starts', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(attemptCallStart(() => undefined)).toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('consumes a retired-room refusal into the retirement message with one warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const refusal = attemptCallStart(() => {
        throw new CallRoomRetiredError();
      });
      expect(refusal).toBe(CALL_ROOM_RETIRED_USER_MESSAGE);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][1])).toContain('shutting down');
    } finally {
      warn.mockRestore();
    }
  });

  it('consumes any other failure into a generic message, never the raw error text', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const refusal = attemptCallStart(() => {
        throw new Error('No embed container element found!');
      });
      expect(refusal).toBe('Failed to start the call.');
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
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
