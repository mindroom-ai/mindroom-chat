import { lazy } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../config/useClientConfig';
import { ThreadHeaderSlot } from './ThreadHeaderSlot';

const mocks = vi.hoisted(() => ({
  reportBoundaryError: vi.fn(),
  resolveLazy: undefined as undefined | (() => void),
}));
vi.mock('../bug-reports/error-reporting/errorReporting', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reportBoundaryError: mocks.reportBoundaryError,
}));

// Plugins as a build lists them: one draws two controls in the banner, one only messages, one
// fails in some threads and lists a value that is not a component, and one loads its code late.
vi.mock('../plugins/pluginEntries', async () => {
  const named = (label: string) =>
    function Named({ room, threadId }: { room: Room; threadId: string }) {
      return `${label}:${room.roomId}:${threadId}`;
    };
  const Late = lazy(
    () =>
      new Promise<{ default: () => string }>((resolve) => {
        mocks.resolveLazy = () => resolve({ default: () => 'late' });
      })
  );
  return {
    pluginEntries: [
      {
        id: 'example',
        version: '1.0.0',
        plugin: { threadHeaderSlot: [named('first'), named('second')] },
      },
      { id: 'messages-only', version: '1.0.0', plugin: { messageRenderers: [] } },
      {
        id: 'broken',
        version: '0.1.0',
        plugin: {
          threadHeaderSlot: [
            ({ threadId }: { threadId: string }) => {
              if (threadId === '$broken') throw new Error('boom');
              return `broken:${threadId}`;
            },
            null,
          ],
        },
      },
      { id: 'late', version: '1.0.0', plugin: { threadHeaderSlot: [Late] } },
    ],
  };
});

describe('ThreadHeaderSlot', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    vi.restoreAllMocks();
    mocks.reportBoundaryError.mockReset();
  });

  const slot = (threadId: string, config: ClientConfig = {}) => (
    <ClientConfigProvider value={config}>
      <ThreadHeaderSlot room={{ roomId: '!a:example.org' } as Room} threadId={threadId} />
    </ClientConfigProvider>
  );

  /** What the slot shows for a thread. */
  const render = (threadId: string, config?: ClientConfig): string => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    act(() => {
      renderer = create(slot(threadId, config));
    });
    return JSON.stringify(renderer!.toJSON());
  };

  it("shows each enabled plugin's components in build order, given the room and the thread", () => {
    expect(render('$t')).toMatch(/first:!a:example.org:\$t.*second:!a:example.org:\$t.*broken:\$t/);
  });

  it('shows nothing of a plugin that config.json turns off', () => {
    const config = { plugins: { example: { enabled: false } } } as unknown as ClientConfig;
    const shown = render('$t', config);
    expect(shown).not.toContain('first:');
    expect(shown).toContain('broken:$t');
  });

  it('renders nothing at all while no enabled plugin has anything for the slot', () => {
    const config = {
      plugins: {
        example: { enabled: false },
        broken: { enabled: false },
        late: { enabled: false },
      },
    } as unknown as ClientConfig;
    expect(render('$t', config)).toBe('null');
  });

  it("leaves out a component that throws, keeps the others, and reports it under the plugin's tag", () => {
    const shown = render('$broken');
    expect(shown).toContain('second:!a:example.org:$broken');
    expect(shown).not.toContain('broken:$broken');
    expect(mocks.reportBoundaryError).toHaveBeenCalledWith(
      expect.objectContaining({ message: '[plugin broken@0.1.0] boom' }),
      expect.any(String)
    );
  });

  it('shows the others while a component loads its code, and it once it has', async () => {
    expect(render('$t')).not.toContain('late');
    await act(async () => mocks.resolveLazy?.());
    expect(JSON.stringify(renderer!.toJSON())).toContain('late');
  });
});
