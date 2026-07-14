import React from 'react';
import { Room } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateRoomInSpaceButton } from './CreateRoomInSpaceButton';

const mocks = vi.hoisted(() => ({
  canCreate: true,
  openCreateRoom: vi.fn(),
}));

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getSafeUserId: () => '@me:example.org' }),
}));
vi.mock('../../hooks/usePowerLevels', () => ({ usePowerLevels: () => ({}) }));
vi.mock('../../hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../../hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({ stateEvent: () => mocks.canCreate }),
}));
vi.mock('../../state/hooks/createRoomModal', () => ({
  useOpenCreateRoomModal: () => mocks.openCreateRoom,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const space = { roomId: '!space:example.org', name: 'Space' } as Room;

describe('CreateRoomInSpaceButton', () => {
  beforeEach(() => {
    mocks.canCreate = true;
    mocks.openCreateRoom.mockReset();
  });

  it('hides creation without m.space.child permission', () => {
    mocks.canCreate = false;
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(<CreateRoomInSpaceButton space={space} />);
    });
    expect(renderer!.toJSON()).toBeNull();
  });

  it('opens contextual creation when permission is present', () => {
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(<CreateRoomInSpaceButton space={space} />);
    });
    act(() =>
      renderer!.root.findByProps({ 'aria-label': 'nav.createRoomInSpace' }).props.onClick()
    );
    expect(mocks.openCreateRoom).toHaveBeenCalledWith(space.roomId);
  });
});
