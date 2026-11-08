// @vitest-environment jsdom

import React from 'react';
import type { Room } from 'matrix-js-sdk';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, expect, it, vi } from 'vitest';
import { RoomUpgrade } from './RoomUpgrade';

// After an upgrade the new room opens, unless rooms listed under the old one did not come along:
// then the settings stay open, name those rooms, and offer the new room.

type Content = Record<string, unknown>;

const fakeRoom = (name: string, state: Record<string, Record<string, Content>>) => ({
  name,
  getMyMembership: () => 'join',
  isSpaceRoom: () => false,
  getLiveTimeline: () => ({
    getState: () => ({
      getStateEvents: (type: string, stateKey?: string) => {
        const byKey = state[type] ?? {};
        const event = (key: string) => ({ getContent: () => byKey[key], getStateKey: () => key });
        if (stateKey === undefined) return Object.keys(byKey).map(event);
        return byKey[stateKey] ? event(stateKey) : null;
      },
    }),
  }),
});

const rooms: Record<string, ReturnType<typeof fakeRoom>> = {};
const navigateRoom = vi.fn();
const client = {
  getSafeUserId: () => '@me:example.org',
  getRoom: (roomId: string) => rooms[roomId] ?? null,
  upgradeRoom: vi.fn(async () => ({ replacement_room: '!new' })),
  sendStateEvent: vi.fn(async (roomId: string) => {
    if (roomId === '!theirs') throw new Error('M_FORBIDDEN');
    return {};
  }),
};

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn, i18n: { language: 'en' } }) };
});
vi.mock('../../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => client }));
vi.mock('../../../matrix/hooks/useCapabilities', () => ({
  useCapabilities: () => ({ 'm.room_versions': { default: '11', available: { '11': 'stable' } } }),
}));
vi.mock('../../../matrix/hooks/usePowerLevels', () => ({ usePowerLevels: () => ({}) }));
vi.mock('../../../matrix/hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../../../matrix/hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({ stateEvent: () => true }),
}));
vi.mock('../../../matrix/hooks/useStateEvent', () => ({ useStateEvent: () => undefined }));
vi.mock('../../../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoom }),
}));
vi.mock('../../../ui/settings/ChoiceButton', () => ({ ChoiceButton: () => null }));
vi.mock('../../../ui/SettingTile', () => ({
  SettingTile: ({ title, after }: { title: string; after?: React.ReactNode }) =>
    React.createElement('div', null, title, after),
}));
vi.mock('folds', () => {
  const element =
    (tag: string) =>
    ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement(tag, props, children);
  return {
    Box: element('div'),
    Button: element('button'),
    Spinner: element('span'),
    Text: element('span'),
    color: { Critical: { Main: 'red' } },
  };
});

const room = { roomId: '!old', getVersion: () => '10' } as unknown as Room;

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('');

const buttonNamed = (renderer: ReactTestRenderer, label: string) =>
  renderer.root.findAll((node) => node.type === 'button' && textOf(node) === label)[0];

const upgrade = async (onOpened: () => void): Promise<ReactTestRenderer> => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<RoomUpgrade room={room} space={false} onOpened={onOpened} />);
  });
  act(() => {
    buttonNamed(renderer, 'Upgrade')?.props.onClick();
  });
  await act(async () => {
    buttonNamed(renderer, 'Upgrade Room')?.props.onClick();
  });
  return renderer;
};

const subRoomOf = (name: string) =>
  fakeRoom(name, { 'm.space.parent': { '!old': { via: ['s'], canonical: true } } });

beforeEach(() => {
  Object.keys(rooms).forEach((roomId) => delete rooms[roomId]);
  navigateRoom.mockClear();
  client.sendStateEvent.mockClear();
});

it('opens the new room once every room under the old one came along', async () => {
  rooms['!old'] = fakeRoom('Garden', { 'm.space.child': { '!mine': { via: ['s'] } } });
  rooms['!mine'] = subRoomOf('Seeds');
  const onOpened = vi.fn();

  await upgrade(onOpened);

  expect(client.sendStateEvent).toHaveBeenCalledWith(
    '!mine',
    'm.space.parent',
    { via: ['s'], canonical: true },
    '!new'
  );
  expect(onOpened).toHaveBeenCalledOnce();
  expect(navigateRoom).toHaveBeenCalledWith('!new');
});

it('names the rooms that did not come along, and offers the new room', async () => {
  rooms['!old'] = fakeRoom('Garden', {
    'm.space.child': { '!mine': { via: ['s'] }, '!theirs': { via: ['s'] } },
  });
  rooms['!mine'] = subRoomOf('Seeds');
  rooms['!theirs'] = subRoomOf('Tools');
  const onOpened = vi.fn();

  const renderer = await upgrade(onOpened);

  expect(onOpened).not.toHaveBeenCalled();
  const alert = textOf(renderer.root.findByProps({ role: 'alert' }));
  expect(alert).toContain('Tools');
  expect(alert).not.toContain('Seeds');
  act(() => {
    buttonNamed(renderer, 'Open New Room')?.props.onClick();
  });
  expect(onOpened).toHaveBeenCalledOnce();
  expect(navigateRoom).toHaveBeenCalledWith('!new');
});
