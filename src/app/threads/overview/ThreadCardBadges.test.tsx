// @vitest-environment jsdom
import { lazy, Suspense, type ComponentType } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import type { Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../../config/useClientConfig';
import type { RegisteredPlugin } from '../../plugins/registry';
import type { ThreadCardBadge, ThreadCardBadgeProps } from '../../plugins/threadCardBadges';
import { ThreadCardBadges } from './ThreadCardBadges';

const mocks = vi.hoisted(() => ({ reportBoundaryError: vi.fn() }));
vi.mock('../../bug-reports/error-reporting/errorReporting', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reportBoundaryError: mocks.reportBoundaryError,
}));

const room = { roomId: '!room:example.org' } as Room;

/** A badge that shows its label with the room and thread it was given. */
const named = (label: string) =>
  function Named({ room: badgeRoom, threadId }: ThreadCardBadgeProps) {
    return <span data-badge={label}>{`${label} ${badgeRoom.roomId} ${threadId}`}</span>;
  };

const Broken = (): never => {
  throw new Error('boom');
};

/** A badge whose code never loads. */
const NeverLoads = lazy<ComponentType<ThreadCardBadgeProps>>(() => new Promise(() => undefined));

const plugin = (id: string, threadCardBadges: ThreadCardBadge[]): RegisteredPlugin => ({
  id,
  tag: `${id}@1.0.0`,
  conversationCovers: [],
  messageRenderers: [],
  pages: [],
  roomHeaderSlot: [],
  sidePanels: [],
  headerActions: [],
  slashCommands: [],
  roomActions: [],
  messageLinks: [],
  threadCardBadges,
  threadDetails: [],
});

/** What a thread's card shows of these plugins' badges, under this config.json. */
const renderBadges = (plugins: readonly RegisteredPlugin[], config: ClientConfig = {}) =>
  render(
    <ClientConfigProvider value={config}>
      <ThreadCardBadges room={room} threadId="$root" plugins={plugins} />
    </ClientConfigProvider>
  );

const shown = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-badge]'), (badge) => badge.textContent);

describe('ThreadCardBadges', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    mocks.reportBoundaryError.mockReset();
  });

  it("renders each enabled plugin's badge in build order, given the thread's room and root", () => {
    const { container } = renderBadges([
      plugin('alpha', [{ Component: named('first') }]),
      plugin('beta', [{ Component: named('second') }]),
    ]);
    expect(shown(container)).toEqual([
      'first !room:example.org $root',
      'second !room:example.org $root',
    ]);
  });

  it('renders nothing at all while no enabled plugin has a badge', () => {
    expect(renderBadges([]).container.firstChild).toBeNull();
    cleanup();
    const config = { plugins: { off: { enabled: false } } } as unknown as ClientConfig;
    const { container } = renderBadges(
      [plugin('none', []), plugin('off', [{ Component: named('hidden') }])],
      config
    );
    expect(container.firstChild).toBeNull();
  });

  it("leaves out a badge that throws, keeps the other, and reports it once under its plugin's tag", () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { container } = renderBadges([
      plugin('broken', [{ Component: Broken }]),
      plugin('alpha', [{ Component: named('first') }]),
    ]);
    expect(shown(container)).toEqual(['first !room:example.org $root']);
    expect(mocks.reportBoundaryError).toHaveBeenCalledTimes(1);
    expect(mocks.reportBoundaryError).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Error', message: '[plugin broken@1.0.0] boom' }),
      expect.any(String)
    );
    expect(
      vi
        .mocked(console.error)
        .mock.calls.some(([first]) =>
          String(first).includes('[plugin broken@1.0.0] failed to render on a thread card')
        )
    ).toBe(true);
  });

  it('keeps the card and the other badges while a badge waits for its code', () => {
    // The page's own boundary, which would show its fallback in place of the page.
    const { container } = render(
      <Suspense fallback={<p>Page loading</p>}>
        <ClientConfigProvider value={{}}>
          <span data-testid="card-text">Thread title</span>
          <ThreadCardBadges
            room={room}
            threadId="$root"
            plugins={[
              plugin('waiting', [{ Component: NeverLoads }]),
              plugin('alpha', [{ Component: named('first') }]),
            ]}
          />
        </ClientConfigProvider>
      </Suspense>
    );
    expect(screen.queryByText('Page loading')).toBeNull();
    expect(screen.getByTestId('card-text')).toBeTruthy();
    expect(shown(container)).toEqual(['first !room:example.org $root']);
    expect(mocks.reportBoundaryError).not.toHaveBeenCalled();
  });
});
