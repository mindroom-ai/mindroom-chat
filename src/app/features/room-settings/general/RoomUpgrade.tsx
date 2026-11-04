import React, { useState } from 'react';
import { Box, Button, Spinner, Text, color } from 'folds';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { SettingTile } from '../../../components/setting-tile';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useAlive } from '../../../hooks/useAlive';
import { useCapabilities } from '../../../hooks/useCapabilities';
import { usePowerLevels } from '../../../hooks/usePowerLevels';
import { useRoomCreators } from '../../../hooks/useRoomCreators';
import { useRoomNavigate } from '../../../hooks/useRoomNavigate';
import { useRoomPermissions } from '../../../hooks/useRoomPermissions';
import { useStateEvent } from '../../../hooks/useStateEvent';
import { StateEvent } from '../../../../types/matrix/room';
import { ChoiceButton } from '../../settings/ChoiceButton';

const KEY = 'featureUi.commonSettings.general.roomUpgrade';

/** The room this one replaced (`m.room.create` `predecessor`), if any. */
const predecessorOf = (content: Record<string, unknown> | undefined): string | undefined => {
  const predecessor = content?.predecessor as { room_id?: unknown } | undefined;
  return typeof predecessor?.room_id === 'string' ? predecessor.room_id : undefined;
};

/** Versions sorted as numbers where they are numbers, the newest first. */
const newestFirst = (versions: string[]): string[] =>
  [...versions].sort((a, b) => {
    const [x, y] = [Number(a), Number(b)];
    if (Number.isFinite(x) && Number.isFinite(y)) return y - x;
    return b.localeCompare(a);
  });

type RoomUpgradeProps = {
  room: Room;
  space: boolean;
  /** Runs once the new room is open, so the dialog can close. */
  onOpened: () => void;
};

/**
 * Advanced Options: the room's version and an upgrade to another version the server offers,
 * after a warning that it cannot be undone. A replaced room links to its successor instead, and
 * a room that replaced an older one links back to it.
 */
export function RoomUpgrade({ room, space, onOpened }: RoomUpgradeProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const { navigateRoom } = useRoomNavigate();
  const me = client.getSafeUserId();
  const may = useRoomPermissions(useRoomCreators(room), usePowerLevels(room));
  const tombstone = useStateEvent(room, StateEvent.RoomTombstone);
  const create = useStateEvent(room, StateEvent.RoomCreate);
  const offered = useCapabilities()['m.room_versions'];
  const current = room.getVersion();
  const versions = newestFirst(Object.keys(offered?.available ?? {}));
  const [target, setTarget] = useState(offered?.default ?? versions[0] ?? current);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string>();

  const open = (roomId: string) => {
    onOpened();
    navigateRoom(roomId);
  };

  const replacement = tombstone?.getContent().replacement_room;
  const predecessor = predecessorOf(create?.getContent());
  const noun = space ? 'Space' : 'Room';

  const upgrade = () => {
    setBusy(true);
    setFailed(undefined);
    client
      .upgradeRoom(room.roomId, target)
      .then(({ replacement_room: next }) => alive() && open(next))
      .catch((error: unknown) => {
        if (!alive()) return;
        setFailed(error instanceof Error && error.message ? error.message : String(error));
      })
      .finally(() => alive() && setBusy(false));
  };

  const oldRoom = predecessor && (
    <SettingTile
      title={t(`${KEY}.old${noun}` as never)}
      after={
        <Button
          size="300"
          radii="300"
          variant="Secondary"
          fill="Soft"
          onClick={() => open(predecessor)}
        >
          <Text size="B300">{t(`${KEY}.old${noun}` as never)}</Text>
        </Button>
      }
    />
  );

  if (typeof replacement === 'string' && replacement) {
    return (
      <>
        <SettingTile
          title={t(`${KEY}.${space ? 'space' : 'room'}Replaced` as never)}
          description={t(`${KEY}.currentVersion`, { version: current })}
          after={
            <Button size="300" radii="300" variant="Primary" onClick={() => open(replacement)}>
              <Text size="B300">{t(`${KEY}.openNew${noun}` as never)}</Text>
            </Button>
          }
        />
        {oldRoom}
      </>
    );
  }

  const allowed = may.stateEvent(StateEvent.RoomTombstone, me);
  return (
    <>
      <SettingTile
        title={t(`${KEY}.${space ? 'space' : 'room'}Upgrade` as never)}
        description={t(`${KEY}.currentVersion`, { version: current })}
        after={
          <Box gap="200" alignItems="Center">
            <ChoiceButton
              label={t('sharedUi.roomVersionSelector.version')}
              value={target}
              choices={versions.map((version) => ({ value: version, label: version }))}
              disabled={!allowed || busy}
              onChoose={setTarget}
            />
            {!confirming && (
              <Button
                size="300"
                radii="300"
                variant="Secondary"
                fill="Soft"
                disabled={!allowed}
                onClick={() => setConfirming(true)}
              >
                <Text size="B300">{t(`${KEY}.upgrade`)}</Text>
              </Button>
            )}
          </Box>
        }
      >
        {confirming && (
          <Box direction="Column" gap="200">
            <Text size="T200" style={{ color: color.Critical.Main }}>
              {t(`${KEY}.thisActionIsIrreversible`)}
            </Text>
            <Box gap="200">
              <Button
                size="300"
                radii="300"
                variant="Critical"
                disabled={busy}
                before={busy ? <Spinner size="50" variant="Critical" fill="Solid" /> : undefined}
                onClick={upgrade}
              >
                <Text size="B300">{t(`${KEY}.upgrade${noun}` as never)}</Text>
              </Button>
              <Button
                size="300"
                radii="300"
                variant="Secondary"
                fill="Soft"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                <Text size="B300">{t('featureUi.commonSettings.general.roomProfile.cancel')}</Text>
              </Button>
            </Box>
          </Box>
        )}
        {failed && (
          <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
            {failed}
          </Text>
        )}
      </SettingTile>
      {oldRoom}
    </>
  );
}
