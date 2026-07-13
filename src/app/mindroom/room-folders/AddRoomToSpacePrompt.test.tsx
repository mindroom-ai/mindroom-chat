import React from 'react';
import { Room } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AddRoomToSpacePrompt } from './AddRoomToSpacePrompt';

const mocks = vi.hoisted(() => ({
  sendStateEvent: vi.fn(),
  canAdd: true,
}));

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('folds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('folds')>();
  return {
    ...actual,
    Overlay: ({ children }: { children: React.ReactNode }) => children,
  };
});

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getSafeUserId: () => '@me:example.org',
    sendStateEvent: mocks.sendStateEvent,
  }),
}));
vi.mock('../../hooks/usePowerLevels', () => ({ usePowerLevels: () => ({}) }));
vi.mock('../../hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../../hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({ stateEvent: () => mocks.canAdd }),
}));
vi.mock('../../plugins/via-servers', () => ({
  getViaServers: () => ['example.org'],
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const room = { roomId: '!room:example.org', name: 'Room' } as Room;
const space = { roomId: '!space:example.org', name: 'Space' } as Room;

describe('AddRoomToSpacePrompt', () => {
  beforeEach(() => {
    mocks.sendStateEvent.mockReset();
    mocks.sendStateEvent.mockResolvedValue(undefined);
    mocks.canAdd = true;
  });

  it('requires confirmation before writing shared Matrix space state', async () => {
    const onCancel = vi.fn();
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(<AddRoomToSpacePrompt room={room} space={space} onCancel={onCancel} />);
    });

    expect(renderer!.root.findByProps({ role: 'dialog' }).props['aria-modal']).toBe('true');
    const addButton = renderer!.root
      .findAllByType('button')
      .find((button) => button.findAll((node) => node.props.children === 'nav.add').length);
    expect(addButton).toBeTruthy();
    expect(addButton!.props.autoFocus).toBe(true);
    await act(async () => addButton!.props.onClick());

    expect(mocks.sendStateEvent).toHaveBeenCalledWith(
      space.roomId,
      'm.space.child',
      { auto_join: false, suggested: false, via: ['example.org'] },
      room.roomId
    );
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('explains and disables an unauthorized shared-state change', () => {
    mocks.canAdd = false;
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(<AddRoomToSpacePrompt room={room} space={space} onCancel={vi.fn()} />);
    });

    expect(renderer!.root.findByProps({ role: 'alert' })).toBeTruthy();
    const disabledButton = renderer!.root
      .findAllByType('button')
      .find((button) => button.props.disabled && button.props.onClick);
    expect(disabledButton).toBeTruthy();
    expect(
      renderer!.root
        .findAllByType('button')
        .find((button) => button.props.autoFocus && !button.props.disabled)
    ).toBeTruthy();
    expect(mocks.sendStateEvent).not.toHaveBeenCalled();
  });
});
