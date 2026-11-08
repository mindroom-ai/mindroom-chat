// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientConfig } from '../config/useClientConfig';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import { type RoomSidePanelControl, useRoomSidePanel } from '../plugins/sidePanels';
import type { RoomViewProps } from './RoomView';
import { importBeforeTests } from '../../test/utils/importBeforeTests';

// A plugin's side panel whose `label` is a key of the plugin's strings, named in the app's language
// wherever the room names it: its toggle in the room header, its frame, its Close and its resize
// handle, again when the language changes, which leaves what the plugin's code holds as it was.

const { mx, room, state } = vi.hoisted(() => ({
  state: {
    view: undefined as RoomViewProps | undefined,
    /** What the plugin's code in the conversation holds of its panel. */
    control: undefined as RoomSidePanelControl | undefined,
  },
  mx: {
    getSafeUserId: () => '@alice:example.org',
    isInitialSyncComplete: () => true,
    getSyncState: () => 'SYNCING',
    on: () => undefined,
    removeListener: () => undefined,
  },
  room: {
    roomId: '!room:example.org',
    getMember: () => undefined,
    getThread: () => undefined,
    findEventById: () => undefined,
    on: () => undefined,
    removeListener: () => undefined,
  },
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({}),
  useSearchParams: () => [new URLSearchParams()],
}));
function PluginCode() {
  state.control = useRoomSidePanel('notes', 'panel');
  return null;
}
vi.mock('./RoomView', () => ({
  RoomView: (props: RoomViewProps) => {
    state.view = props;
    return (
      <div data-testid="room-view">
        <PluginCode />
      </div>
    );
  },
}));
vi.mock('../members/MembersDrawer', () => ({ MembersDrawer: () => <aside /> }));
vi.mock('../members/useMembersDrawer', async () => {
  const { useState } = await vi.importActual<typeof import('react')>('react');
  return { useMembersDrawer: () => useState(false) };
});
vi.mock('../canvas/canvasIndex', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../canvas/canvasIndex')>()),
  useConversationCanvases: () => [],
  useComputerShown: () => false,
}));
vi.mock('../matrix/hooks/useRoom', () => ({ useRoom: () => room }));
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../matrix/hooks/useRoomMembers', () => ({ useRoomMembers: () => [] }));
vi.mock('../matrix/hooks/usePowerLevels', () => ({
  PowerLevelsContextProvider: ({ children }: { children: React.ReactNode }) => children,
  usePowerLevels: () => ({}),
}));
vi.mock('../config/useClientConfig', () => ({ useClientConfig: () => ({} as ClientConfig) }));
vi.mock('../computer/useAgentServers', () => ({
  useRoomAgentServers: () => [],
  useBindsOpenIdTokens: () => false,
}));
vi.mock('../navigation/useRoomViewMode', () => ({
  useRoomViewMode: () => ({ viewMode: 'threaded', setViewMode: () => undefined }),
}));
vi.mock('../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoom: () => undefined, navigateRoomThread: () => undefined }),
}));
// A plugin whose panel is labelled by a key of its strings, in English and German.
vi.mock('../plugins/pluginEntries', () => ({
  pluginEntries: [
    {
      id: 'notes',
      version: '1.0.0',
      plugin: {
        sidePanels: [{ id: 'panel', label: 'panel', Component: () => <p>Notes content</p> }],
        translations: {
          en: { panel: 'Notes' },
          load: async (language: string) => (language === 'de' ? { panel: 'Notizen' } : undefined),
        },
      },
    },
  ],
}));

importBeforeTests(() => import('./Room'));

/**
 * Every name the room gives the panel, in the app's strings of the language in use: its toggle's,
 * its own, its frame's Fold, its Close and its resize handle.
 */
const names = async (label: string) => {
  const { default: i18n } = await import('../i18n/i18n');
  const named = (role: string, key: string) =>
    screen.queryByRole(role, { name: i18n.t(key as never, { label }) as string }) !== null;
  return {
    toggle: state.view?.pluginPanels?.map((panel) => panel.label),
    panel: screen.queryByRole('region', { name: label }) !== null,
    fold: named('button', 'mindroomUi.sidePanel.fold'),
    close: named('button', 'mindroomUi.plugins.sidePanel.close'),
    resize: named('separator', 'mindroomUi.plugins.sidePanel.resize'),
  };
};

describe("a plugin's side panel's name", () => {
  beforeEach(() => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    // The app's own German catalog, which these names do not need.
    vi.stubGlobal('fetch', async () => Response.json({}));
  });

  afterEach(async () => {
    cleanup();
    const { default: i18n } = await import('../i18n/i18n');
    await i18n.changeLanguage('en');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("is in the app's language wherever the room names it, and changes with it", async () => {
    const { Room } = await import('./Room');
    const { default: i18n } = await import('../i18n/i18n');
    await act(async () => i18n.changeLanguage('de'));
    await act(async () =>
      render(
        <ScreenSizeProvider value={ScreenSize.Desktop}>
          <Room />
        </ScreenSizeProvider>
      )
    );
    await act(async () => state.view?.onPanelToggle?.('notes/panel'));
    const shown = { toggle: ['Notizen'], panel: true, fold: true, close: true, resize: true };
    expect(await names('Notizen')).toEqual(shown);
    expect(screen.getByRole('button', { name: 'Notizen schließen' })).toBeTruthy();

    const held = state.control;

    await act(async () => i18n.changeLanguage('en'));
    expect(await names('Notes')).toEqual({ ...shown, toggle: ['Notes'] });
    expect(screen.getByRole('button', { name: 'Close Notes' })).toBeTruthy();
    // The plugin's code keeps the calls it holds, as it does while the room shows.
    expect(state.control?.open).toBe(held?.open);
    expect(state.control?.close).toBe(held?.close);
    expect(state.control?.openBesideThread).toBe(held?.openBesideThread);
  });
});
