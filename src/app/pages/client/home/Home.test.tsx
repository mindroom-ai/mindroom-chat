import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeContent } from './Home';

const state = vi.hoisted(() => ({
  createFolder: vi.fn(),
  folders: [] as Array<{ id: string; name: string; roomIds: string[] }>,
  roomIds: [] as string[],
  spaceIds: [] as string[],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('folds', async () => {
  const reactModule = await import('react');
  const Wrapper = ({ children }: { children?: React.ReactNode }) =>
    reactModule.createElement('div', null, children);
  const Button = ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    reactModule.createElement('button', { type: 'button', ...props }, children);

  return {
    Avatar: Wrapper,
    Box: Wrapper,
    Button,
    Icon: () => reactModule.createElement('i'),
    IconButton: Button,
    Icons: {
      Category: 'Category',
      Hash: 'Hash',
      Link: 'Link',
      Plus: 'Plus',
      Space: 'Space',
      VerticalDots: 'VerticalDots',
    },
    Menu: reactModule.forwardRef<HTMLDivElement, { children: React.ReactNode }>(
      ({ children }, ref) => reactModule.createElement('div', { ref }, children)
    ),
    MenuItem: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
      reactModule.createElement(
        'button',
        { type: 'button', 'data-testid': 'home-menu-item', ...props },
        children
      ),
    PopOut: ({ anchor, content }: { anchor?: unknown; content: React.ReactNode }) =>
      anchor ? reactModule.createElement('div', { 'data-testid': 'popout' }, content) : null,
    Text: ({ children }: { children?: React.ReactNode }) =>
      reactModule.createElement('span', null, children),
    config: { space: { S100: '4px' } },
    toRem: () => '10rem',
  };
});

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('../../../components/nav', async () => {
  const reactModule = await import('react');
  const Wrapper = ({ children }: { children?: React.ReactNode }) =>
    reactModule.createElement('div', null, children);
  return {
    NavButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
      reactModule.createElement('button', { type: 'button', ...props }, children),
    NavCategory: Wrapper,
    NavEmptyCenter: Wrapper,
    NavEmptyLayout: () => reactModule.createElement('div', { 'data-testid': 'home-empty' }),
    NavItem: Wrapper,
    NavItemContent: Wrapper,
    NavLink: Wrapper,
  };
});

vi.mock('../../pathUtils', () => ({
  encodeSearchParamValueArray: () => '',
  getCreatePath: () => '/create',
  getExplorePath: () => '/explore',
  getHomeCreatePath: () => '/home/create',
  getHomeRoomPath: () => '/home/room',
  getHomeSearchPath: () => '/home/search',
  withSearchParam: (path: string) => path,
}));

vi.mock('../../../hooks/router/useSelectedRoom', () => ({
  useSelectedRoom: () => undefined,
}));

vi.mock('../../../hooks/router/useHomeSelected', () => ({
  useHomeCreateSelected: () => false,
  useHomeSearchSelected: () => false,
}));

vi.mock('./useHomeRooms', () => ({
  useHomeNavigationRooms: () => ({ roomIds: state.roomIds, spaceIds: state.spaceIds }),
}));

vi.mock('jotai', () => ({
  useAtomValue: () => new Map(),
}));

vi.mock('../../../state/room/roomToUnread', () => ({
  roomToUnreadAtom: {},
}));

vi.mock('../../../hooks/useNavToActivePathMapper', () => ({
  useNavToActivePathMapper: vi.fn(),
}));

vi.mock('../../../components/page', async () => {
  const reactModule = await import('react');
  const Wrapper = ({ children }: { children?: React.ReactNode }) =>
    reactModule.createElement('div', null, children);
  return {
    PageNav: Wrapper,
    PageNavContent: Wrapper,
    PageNavHeader: Wrapper,
  };
});

vi.mock('../../../hooks/useRoomsNotificationPreferences', () => ({
  useRoomsNotificationPreferencesContext: () => ({}),
}));

vi.mock('../../../components/UseStateProvider', () => ({
  UseStateProvider: () => null,
}));

vi.mock('../../../components/join-address-prompt', () => ({
  JoinAddressPrompt: () => null,
}));

vi.mock('../../../mindroom/recent-threads/RecentThreadsPanel', async () => {
  const reactModule = await import('react');
  return {
    RecentThreadsPageNav: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
  };
});

vi.mock('../../../mindroom/notifications/MindroomMarkRoomsReadMenuItem', () => ({
  MindroomMarkRoomsReadMenuItem: () => null,
}));

vi.mock('../../../mindroom/settings/useMindroomAccountSettings', () => ({
  useSimpleMode: () => true,
}));

vi.mock('../../../mindroom/room-folders/RoomFolderNav', async () => {
  const reactModule = await import('react');
  return {
    RoomFolderNav: () => reactModule.createElement('div', { 'data-testid': 'room-folder-nav' }),
  };
});

vi.mock('../../../mindroom/room-folders/RoomFoldersProvider', () => ({
  useRoomFolders: () => ({ folders: state.folders, createFolder: state.createFolder }),
}));

vi.mock('../../../mindroom/room-folders/RoomFolderPrompt', async () => {
  const reactModule = await import('react');
  return {
    RoomFolderPrompt: ({ onCancel }: { onCancel: () => void }) =>
      reactModule.createElement(
        'div',
        { 'data-testid': 'room-folder-prompt' },
        reactModule.createElement(
          'button',
          { type: 'button', onClick: onCancel, 'data-testid': 'cancel-folder-prompt' },
          'Cancel'
        )
      ),
  };
});

vi.mock('../../../utils/keyboard', () => ({
  stopPropagation: vi.fn(),
}));

describe('HomeContent', () => {
  beforeEach(() => {
    state.createFolder.mockReset();
    state.folders = [];
    state.roomIds = [];
    state.spaceIds = [];
  });

  it('opens and closes the folder prompt from the Home create menu', () => {
    const renderer = create(<HomeContent />);

    act(() => {
      renderer.root.findByProps({ 'aria-label': 'nav.create' }).props.onClick({
        currentTarget: { getBoundingClientRect: () => ({ top: 0, left: 0 }) },
      });
    });

    const menuItems = renderer.root.findAllByProps({ 'data-testid': 'home-menu-item' });
    expect(JSON.stringify(renderer.toJSON())).not.toContain('nav.createSpace');
    act(() => menuItems[1].props.onClick());
    expect(renderer.root.findByProps({ 'data-testid': 'room-folder-prompt' })).toBeTruthy();

    act(() => {
      renderer.root.findByProps({ 'data-testid': 'cancel-folder-prompt' }).props.onClick();
    });
    expect(renderer.root.findAllByProps({ 'data-testid': 'room-folder-prompt' })).toHaveLength(0);

    act(() => renderer.unmount());
  });

  it('treats a folder as Home navigation content even without rooms or Spaces', () => {
    const renderer = create(<HomeContent />);
    expect(renderer.root.findByProps({ 'data-testid': 'home-empty' })).toBeTruthy();

    state.folders = [{ id: 'work', name: 'Work', roomIds: [] }];
    act(() => renderer.update(<HomeContent />));

    expect(renderer.root.findAllByProps({ 'data-testid': 'home-empty' })).toHaveLength(0);
    expect(renderer.root.findByProps({ 'data-testid': 'room-folder-nav' })).toBeTruthy();
    act(() => renderer.unmount());
  });
});
