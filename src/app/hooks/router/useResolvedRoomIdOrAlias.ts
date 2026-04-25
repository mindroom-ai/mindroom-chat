import { useEffect, useMemo, useState } from 'react';
import { useMatrixClient } from '../useMatrixClient';
import { getCanonicalAliasRoomId, isRoomAlias } from '../../utils/matrix';

const resolveKnownRoomId = (
  mx: ReturnType<typeof useMatrixClient>,
  roomIdOrAlias: string | undefined
): string | undefined => {
  if (!roomIdOrAlias) return undefined;
  if (!isRoomAlias(roomIdOrAlias)) return roomIdOrAlias;
  return getCanonicalAliasRoomId(mx, roomIdOrAlias);
};

export const useResolvedRoomIdOrAlias = (roomIdOrAlias: string | undefined) => {
  const mx = useMatrixClient();
  const knownRoomCount = mx.getRooms().length;
  const knownRoomId = useMemo(
    () => resolveKnownRoomId(mx, roomIdOrAlias),
    [mx, roomIdOrAlias, knownRoomCount]
  );
  const [resolvedRoomId, setResolvedRoomId] = useState<string | undefined>(knownRoomId);
  const [isResolvingAlias, setIsResolvingAlias] = useState(
    !!roomIdOrAlias && isRoomAlias(roomIdOrAlias) && !knownRoomId
  );

  useEffect(() => {
    if (!roomIdOrAlias) {
      setResolvedRoomId(undefined);
      setIsResolvingAlias(false);
      return;
    }

    if (!isRoomAlias(roomIdOrAlias)) {
      setResolvedRoomId(roomIdOrAlias);
      setIsResolvingAlias(false);
      return;
    }

    if (knownRoomId) {
      setResolvedRoomId(knownRoomId);
      setIsResolvingAlias(false);
      return;
    }

    let disposed = false;
    setResolvedRoomId(undefined);
    setIsResolvingAlias(true);

    mx.getRoomIdForAlias(roomIdOrAlias)
      .then((aliasResponse) => {
        if (disposed) return;
        setResolvedRoomId(aliasResponse.room_id);
      })
      .catch(() => {
        if (disposed) return;
        setResolvedRoomId(undefined);
      })
      .finally(() => {
        if (disposed) return;
        setIsResolvingAlias(false);
      });

    return () => {
      disposed = true;
    };
  }, [knownRoomId, mx, roomIdOrAlias]);

  return {
    roomId: resolvedRoomId,
    isResolvingAlias,
  };
};
