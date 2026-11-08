// @vitest-environment jsdom
import { createRef, type RefObject } from 'react';
import { cleanup, render as renderIntoDocument } from '@testing-library/react';
import {
  act,
  create,
  type ReactTestRenderer,
  type ReactTestRendererJSON,
} from 'react-test-renderer';
import type { Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../config/useClientConfig';
import { RoomHeaderSlot } from './RoomHeaderSlot';

const mocks = vi.hoisted(() => ({
  reportBoundaryError: vi.fn(),
  // What each named component's header element was when its first effect ran.
  headers: [] as [string, HTMLElement | null][],
}));
vi.mock('../bug-reports/error-reporting/errorReporting', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reportBoundaryError: mocks.reportBoundaryError,
}));

// Plugins as a build lists them: one shows two things under the header, one only messages, and one
// fails in some rooms (throwing an Error, a string or a value without text) and lists a value that
// is not a component.
vi.mock('../plugins/pluginEntries', async () => {
  const { useEffect } = await import('react');
  const named = (label: string) =>
    function Named({ room, headerRef }: { room: Room; headerRef: RefObject<HTMLElement> }) {
      useEffect(() => {
        mocks.headers.push([label, headerRef.current]);
      }, [headerRef]);
      return `${label}:${room.roomId}`;
    };
  return {
    pluginEntries: [
      {
        id: 'example',
        version: '1.0.0',
        plugin: { roomHeaderSlot: [named('first'), named('second')] },
      },
      { id: 'messages-only', version: '1.0.0', plugin: { messageRenderers: [] } },
      {
        id: 'broken',
        version: '0.1.0',
        plugin: {
          roomHeaderSlot: [
            ({ room }: { room: Room }) => {
              if (room.roomId.startsWith('!broken')) throw new Error('boom');
              // eslint-disable-next-line @typescript-eslint/no-throw-literal
              if (room.roomId.startsWith('!string')) throw 'not an error';
              // Something not even String() can turn into text.
              // eslint-disable-next-line @typescript-eslint/no-throw-literal
              if (room.roomId.startsWith('!bare')) throw Object.create(null);
              return `broken:${room.roomId}`;
            },
            null,
          ],
        },
      },
    ],
  };
});

describe('RoomHeaderSlot', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    cleanup();
    vi.restoreAllMocks();
    mocks.reportBoundaryError.mockReset();
    mocks.headers.length = 0;
  });

  const slot = (roomId: string, config: ClientConfig = {}) => (
    <ClientConfigProvider value={config}>
      <RoomHeaderSlot room={{ roomId } as Room} headerRef={createRef()} />
    </ClientConfigProvider>
  );

  /** What the slot shows in a room. */
  const render = (roomId: string, config?: ClientConfig): string => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    act(() => {
      renderer = create(slot(roomId, config));
    });
    return JSON.stringify(renderer!.toJSON());
  };

  /** What the same slot shows once the view moves to another room. */
  const moveTo = (roomId: string): string => {
    act(() => renderer!.update(slot(roomId)));
    return JSON.stringify(renderer!.toJSON());
  };

  it("shows each enabled plugin's components in build order, given the room", () => {
    const shown = render('!a:example.org');
    expect(shown).toMatch(/first:!a:example.org.*second:!a:example.org.*broken:!a:example.org/);
  });

  it('gives each component the element holding the header row and the slot, set by its first effect', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const headerRef = createRef<HTMLDivElement>();
    const { getByTestId } = renderIntoDocument(
      <ClientConfigProvider value={{}}>
        <div ref={headerRef} data-testid="header">
          <h1>Room name</h1>
          <RoomHeaderSlot room={{ roomId: '!a:example.org' } as Room} headerRef={headerRef} />
        </div>
      </ClientConfigProvider>
    );
    const header = getByTestId('header');
    expect(header.textContent).toContain('first:!a:example.org');
    expect(mocks.headers).toEqual([
      ['first', header],
      ['second', header],
    ]);
  });

  it('shows nothing of a plugin that config.json turns off', () => {
    const config = { plugins: { example: { enabled: false } } } as unknown as ClientConfig;
    const shown = render('!a:example.org', config);
    expect(shown).not.toContain('first:');
    expect(shown).toContain('broken:!a:example.org');
  });

  it('renders nothing at all while no enabled plugin has anything for the slot', () => {
    const config = {
      plugins: { example: { enabled: false }, broken: { enabled: false } },
    } as unknown as ClientConfig;
    expect(render('!a:example.org', config)).toBe('null');
  });

  it("leaves out a component that throws, keeps the others, and reports it under the plugin's tag", () => {
    render('!broken:example.org');
    expect((renderer!.toJSON() as ReactTestRendererJSON).children).toEqual([
      'first:!broken:example.org',
      'second:!broken:example.org',
    ]);
    expect(mocks.reportBoundaryError).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Error', message: '[plugin broken@0.1.0] boom' }),
      expect.any(String)
    );
    expect(
      vi
        .mocked(console.error)
        .mock.calls.some(([first]) => String(first).includes('[plugin broken@0.1.0]'))
    ).toBe(true);
  });

  it('reports under the tag a component that throws something not an Error', () => {
    expect(render('!string:example.org')).not.toContain('broken:!string');
    expect(mocks.reportBoundaryError).toHaveBeenCalledWith(
      expect.objectContaining({ message: '[plugin broken@0.1.0] not an error' }),
      expect.any(String)
    );
  });

  it('keeps the others and reports under the tag a component that throws a value without text', () => {
    expect(render('!bare:example.org')).toContain('second:!bare:example.org');
    expect(mocks.reportBoundaryError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '[plugin broken@0.1.0] a value that cannot be shown as text',
      }),
      expect.any(String)
    );
  });

  it('leaves out a value that is not a component, reported under its tag', () => {
    render('!a:example.org');
    expect(mocks.reportBoundaryError).toHaveBeenCalledTimes(1);
    expect(mocks.reportBoundaryError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/^\[plugin broken@0\.1\.0\] /) }),
      expect.any(String)
    );
  });

  it('tries a component that failed in one room again in the next', () => {
    expect(render('!broken:example.org')).not.toContain('broken:!broken');
    expect(moveTo('!b:example.org')).toContain('broken:!b:example.org');
  });
});
