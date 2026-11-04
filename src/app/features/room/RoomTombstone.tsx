import { type CSSProperties, useState } from 'react';
import { Box, Button, Spinner, Text, color, config } from 'folds';
import { useTranslation } from 'react-i18next';
import { KnownMembership, type MatrixEvent } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useAlive } from '../../hooks/useAlive';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { getMxIdServer } from '../../utils/matrix';

const KEY = 'featureUi.room.roomTombstone';

/** The room `tombstone` (`m.room.tombstone`) points to, if it names one. */
const replacementRoomOf = (tombstone: MatrixEvent | undefined): string | undefined => {
  const roomId = tombstone?.getContent().replacement_room;
  return typeof roomId === 'string' && roomId ? roomId : undefined;
};

/**
 * Takes the composer's place in a room that was upgraded: it says the room is no longer active
 * and opens its replacement, joining it first when needed (through the server of whoever
 * upgraded the room).
 */
export function RoomTombstone({
  tombstone,
  style,
}: {
  tombstone: MatrixEvent;
  style?: CSSProperties;
}) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const { navigateRoom } = useRoomNavigate();
  const [joining, setJoining] = useState(false);
  const [failed, setFailed] = useState(false);
  const replacement = replacementRoomOf(tombstone);
  const joined = replacement
    ? client.getRoom(replacement)?.getMyMembership() === KnownMembership.Join
    : false;

  const go = () => {
    if (!replacement) return;
    if (joined) {
      navigateRoom(replacement);
      return;
    }
    const server = getMxIdServer(tombstone.getSender() ?? '');
    setJoining(true);
    setFailed(false);
    client
      .joinRoom(replacement, { viaServers: server ? [server] : undefined })
      .then(() => alive() && navigateRoom(replacement))
      .catch(() => alive() && setFailed(true))
      .finally(() => alive() && setJoining(false));
  };

  return (
    <Box
      data-room-tombstone=""
      alignItems="Center"
      justifyContent="SpaceBetween"
      gap="300"
      wrap="Wrap"
      style={style ?? { padding: `${config.space.S200} ${config.space.S400}` }}
    >
      <Box direction="Column" gap="100">
        <Text size="T300">{t(`${KEY}.replacedDescription`)}</Text>
        {failed && (
          <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
            {t(`${KEY}.joinReplacementFailed`)}
          </Text>
        )}
      </Box>
      {replacement && (
        <Button
          size="300"
          radii="300"
          variant="Primary"
          disabled={joining}
          before={joining ? <Spinner size="50" variant="Primary" fill="Solid" /> : undefined}
          onClick={go}
        >
          <Text size="B300">{t(`${KEY}.${joined ? 'openNewRoom' : 'joinNewRoom'}`)}</Text>
        </Button>
      )}
    </Box>
  );
}
