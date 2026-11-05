import { useCallback, useEffect, useMemo, useState } from 'react';
import { MatrixClient, MatrixEvent, Room, RoomStateEvent } from 'matrix-js-sdk';
import { AccountDataEvent } from '../matrix/types/accountData';
import { StateEvent } from '../matrix/types/room';
import {
  getGlobalImagePacks,
  getRoomImagePacks,
  getUserImagePack,
  ImagePack,
  ImageUsage,
} from './custom';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useAccountData } from '../matrix/hooks/useAccountData';
import { matchesEnum } from '../lib/matchesEnum';

/** Re-renders when image pack state changes in one of `roomIds`. */
const usePackStateVersion = (mx: MatrixClient, roomIds: Set<string>): number => {
  const [version, setVersion] = useState(0);

  const handleStateEvent = useCallback(
    (event: MatrixEvent) => {
      const roomId = event.getRoomId();
      if (
        matchesEnum(event.getType(), StateEvent.PoniesRoomEmotes) &&
        roomId &&
        roomIds.has(roomId)
      ) {
        setVersion((current) => current + 1);
      }
    },
    [roomIds]
  );

  useEffect(() => {
    mx.on(RoomStateEvent.Events, handleStateEvent);
    return () => {
      mx.removeListener(RoomStateEvent.Events, handleStateEvent);
    };
  }, [mx, handleStateEvent]);

  return version;
};

/**
 * The image packs of `rooms`, following pack changes. A new array holding the same rooms keeps
 * the same packs, so pickers do not rebuild on every render of their parent.
 */
export const useRoomsImagePacks = (rooms: Room[]): ImagePack[] => {
  const mx = useMatrixClient();
  const roomKey = rooms.map((room) => room.roomId).join('\n');
  // The rooms behind `roomKey`; a new array of the same rooms reuses the previous one.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableRooms = useMemo(() => rooms, [roomKey]);
  const roomIds = useMemo(() => new Set(stableRooms.map((room) => room.roomId)), [stableRooms]);
  const version = usePackStateVersion(mx, roomIds);

  return useMemo(() => {
    void version;
    return stableRooms.flatMap((room) => getRoomImagePacks(room));
  }, [stableRooms, version]);
};

/** The image packs of one room. */
export const useRoomImagePacks = (room: Room): ImagePack[] =>
  useRoomsImagePacks(useMemo(() => [room], [room]));

/** The account's own pack (`im.ponies.user_emotes`). */
const useUserImagePack = (): ImagePack | undefined => {
  const mx = useMatrixClient();
  const userPackEvent = useAccountData(AccountDataEvent.PoniesUserEmotes);

  return useMemo(() => {
    void userPackEvent;
    return getUserImagePack(mx);
  }, [mx, userPackEvent]);
};

/** Room packs the account enabled everywhere (`im.ponies.emote_rooms`). */
const useGlobalImagePacks = (): ImagePack[] => {
  const mx = useMatrixClient();
  const emoteRoomsEvent = useAccountData(AccountDataEvent.PoniesEmoteRooms);
  const roomIds = useMemo(() => {
    const rooms: unknown = emoteRoomsEvent?.getContent().rooms;
    return new Set(rooms && typeof rooms === 'object' ? Object.keys(rooms) : []);
  }, [emoteRoomsEvent]);
  const version = usePackStateVersion(mx, roomIds);

  return useMemo(() => {
    void version;
    void emoteRoomsEvent;
    return getGlobalImagePacks(mx);
  }, [mx, emoteRoomsEvent, version]);
};

// A room pack is one pack wherever it is listed; only the user's own pack has no address.
const packKey = (pack: ImagePack): string =>
  pack.address ? JSON.stringify([pack.address.roomId, pack.address.stateKey]) : pack.id;

/**
 * The packs to offer for `usage`: the account's own pack, then the packs it enabled everywhere,
 * then those of `rooms`. A pack listed twice (a global pack that is also in `rooms`) shows once,
 * and a pack without an image for `usage` not at all.
 */
export const useRelevantImagePacks = (usage: ImageUsage, rooms: Room[]): ImagePack[] => {
  const ownPack = useUserImagePack();
  const everywherePacks = useGlobalImagePacks();
  const roomPacks = useRoomsImagePacks(rooms);

  return useMemo(() => {
    const byKey = new Map<string, ImagePack>();
    [...(ownPack ? [ownPack] : []), ...everywherePacks, ...roomPacks].forEach((pack) => {
      const key = packKey(pack);
      if (!byKey.has(key)) byKey.set(key, pack);
    });
    return [...byKey.values()].filter((pack) => pack.getImages(usage).length > 0);
  }, [usage, ownPack, everywherePacks, roomPacks]);
};
