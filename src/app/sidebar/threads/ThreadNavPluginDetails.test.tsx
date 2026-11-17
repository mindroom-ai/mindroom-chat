// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import type { Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../../config/useClientConfig';
import type { RegisteredPlugin } from '../../plugins/registry';
import { useRoomSidePanel } from '../../plugins/sidePanels';
import type { ThreadDetail, ThreadDetailProps } from '../../plugins/threadDetails';
import { ThreadNavPluginDetails } from './ThreadNavPluginDetails';

vi.mock('../../bug-reports/error-reporting/errorReporting', () => ({
  reportBoundaryError: vi.fn(),
}));
vi.mock('./threadNav.css', () => ({ EntryTooltipPluginDetails: 'EntryTooltipPluginDetails' }));

const room = { roomId: '!room:example.org' } as Room;
const Named = ({ room: detailRoom, threadId }: ThreadDetailProps) => (
  <span data-detail>{`Details of ${detailRoom.roomId} ${threadId}`}</span>
);
const Broken = (): never => {
  throw new Error('boom');
};
/** A detail that asks for its plugin's side panel, which only a room's page has. */
const WithPanel = () => {
  const panel = useRoomSidePanel('test', 'panel');
  return <span data-detail>{`panel ${panel === undefined ? 'none' : 'given'}`}</span>;
};
const plugin = (id: string, threadDetails: ThreadDetail[]): RegisteredPlugin => ({
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
  threadCardBadges: [],
  threadDetails,
});

const renderDetails = (
  plugins: readonly RegisteredPlugin[],
  { threadId = '$root', config = {} as ClientConfig } = {}
) =>
  render(
    <ClientConfigProvider value={config}>
      <ThreadNavPluginDetails room={room} threadId={threadId} plugins={plugins} />
    </ClientConfigProvider>
  );

const shown = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-detail]'), (detail) => detail.textContent);

describe('ThreadNavPluginDetails', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the plugins' details for the thread under one rule", () => {
    const { container } = renderDetails([plugin('test', [{ Component: Named }])]);

    expect(shown(container)).toEqual(['Details of !room:example.org $root']);
    expect(container.querySelector('.EntryTooltipPluginDetails [data-detail]')).not.toBeNull();
  });

  it('shows nothing for a throwing detail and keeps the others', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { container } = renderDetails([
      plugin('broken', [{ Component: Broken }]),
      plugin('test', [{ Component: Named }]),
    ]);

    expect(shown(container)).toEqual(['Details of !room:example.org $root']);
  });

  it('hides the details of a plugin config.json turns off, and of unconfirmed roots', () => {
    const plugins = [plugin('test', [{ Component: Named }])];
    const off = { plugins: { test: { enabled: false } } } as unknown as ClientConfig;

    expect(renderDetails(plugins, { config: off }).container.innerHTML).toBe('');
    cleanup();
    expect(renderDetails(plugins, { threadId: '~local' }).container.innerHTML).toBe('');
  });

  it('reads which details show once, as the card opens', () => {
    const shows = vi.fn(() => true);
    const plugins = [plugin('test', [{ shows, Component: Named }])];
    const { rerender } = renderDetails(plugins);
    rerender(
      <ClientConfigProvider value={{}}>
        <ThreadNavPluginDetails room={room} threadId="$root" plugins={plugins} />
      </ClientConfigProvider>
    );

    expect(shows).toHaveBeenCalledTimes(1);
    expect(shows).toHaveBeenCalledWith(room, '$root');
  });

  it("renders a detail that asks for its side panel, which the sidebar's card has none of", () => {
    const { container } = renderDetails([plugin('test', [{ Component: WithPanel }])]);

    expect(shown(container)).toEqual(['panel none']);
  });
});
