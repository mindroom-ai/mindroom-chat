import React from 'react';
import { useAtomValue } from 'jotai';
import { RoomSettings } from './RoomSettings';
import { Modal500 } from '../../components/Modal500';
import { useCloseRoomSettings, useRoomSettingsState } from '../../state/hooks/roomSettings';
import { useAllJoinedRoomsSet, useGetRoom } from '../../hooks/useGetRoom';
import { RoomSettingsState } from '../../state/roomSettings';
import { IsDirectRoomProvider, RoomProvider } from '../../hooks/useRoom';
import { SpaceProvider } from '../../hooks/useSpace';
import { mDirectAtom } from '../../state/mDirectList';

type RenderSettingsProps = {
  state: RoomSettingsState;
};
function RenderSettings({ state }: RenderSettingsProps) {
  const { roomId, spaceId, page } = state;
  const closeSettings = useCloseRoomSettings();
  const mDirects = useAtomValue(mDirectAtom);
  const allJoinedRooms = useAllJoinedRoomsSet();
  const getRoom = useGetRoom(allJoinedRooms);
  const room = getRoom(roomId);
  const space = spaceId ? getRoom(spaceId) : undefined;

  if (!room) return null;

  return (
    <Modal500 requestClose={closeSettings}>
      <SpaceProvider value={space ?? null}>
        <IsDirectRoomProvider value={mDirects.has(room.roomId)}>
          <RoomProvider value={room}>
            <RoomSettings initialPage={page} requestClose={closeSettings} />
          </RoomProvider>
        </IsDirectRoomProvider>
      </SpaceProvider>
    </Modal500>
  );
}

export function RoomSettingsRenderer() {
  const state = useRoomSettingsState();

  if (!state) return null;
  return <RenderSettings state={state} />;
}
