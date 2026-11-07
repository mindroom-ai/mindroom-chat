import { useState } from 'react';
import { Box, Button, Spinner, Text, color } from 'folds';
import { useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { SettingTile } from '../../../ui/SettingTile';
import { useMatrixClient } from '../../../matrix/hooks/useMatrixClient';
import { useAlive } from '../../../lib/hooks/useAlive';
import { useCapabilities } from '../../../matrix/hooks/useCapabilities';
import { usePowerLevels } from '../../../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../../../matrix/hooks/useRoomCreators';
import { useRoomNavigate } from '../../../navigation/useRoomNavigate';
import { useRoomPermissions } from '../../../matrix/hooks/useRoomPermissions';
import { useStateEvent } from '../../../matrix/hooks/useStateEvent';
import { StateEvent } from '../../../matrix/types/room';
import { ChoiceButton } from '../../../ui/settings/ChoiceButton';
import { roomToParentsAtom } from '../../../matrix/state/roomToParents';
import { moveSpaceLinks } from './moveSpaceLinks';
import { describeError } from '../../../lib/describeError';
import { ErrorDetail } from '../../../ui/ErrorDetail';
import { revealDirectionControls } from '../../../ui/directional';

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
 * after a warning that it cannot be undone; the room's spaces then list the new room, and the new
 * room lists the old one's rooms. The new room opens, unless some of those rooms did not come
 * along: the settings then name them. A replaced room links to its successor instead, and a room
 * that replaced an older one links back to it.
 */
export function RoomUpgrade({ room, space, onOpened }: RoomUpgradeProps) {
  const { t, i18n } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const { navigateRoom } = useRoomNavigate();
  const me = client.getSafeUserId();
  const may = useRoomPermissions(useRoomCreators(room), usePowerLevels(room));
  const tombstone = useStateEvent(room, StateEvent.RoomTombstone);
  const create = useStateEvent(room, StateEvent.RoomCreate);
  const offered = useCapabilities()['m.room_versions'];
  const parents = useAtomValue(roomToParentsAtom).get(room.roomId);
  const current = room.getVersion();
  const versions = newestFirst(Object.keys(offered?.available ?? {}));
  const [target, setTarget] = useState(offered?.default ?? versions[0] ?? current);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<{ error: unknown }>();
  /** The new room, when rooms the old one listed did not come along (`moveSpaceLinks`). */
  const [unmoved, setUnmoved] = useState<{ roomId: string; rooms: string[] }>();

  const open = (roomId: string) => {
    onOpened();
    navigateRoom(roomId);
  };

  const replacement = tombstone?.getContent().replacement_room ?? unmoved?.roomId;
  const predecessor = predecessorOf(create?.getContent());
  const noun = space ? 'Space' : 'Room';

  const upgrade = () => {
    setBusy(true);
    setFailed(undefined);
    client
      .upgradeRoom(room.roomId, target)
      .then(async ({ replacement_room: next }) => {
        const rooms = await moveSpaceLinks(client, room.roomId, next, parents ?? []);
        if (!alive()) return;
        if (rooms.length > 0) setUnmoved({ roomId: next, rooms });
        else open(next);
      })
      .catch((error: unknown) => {
        if (!alive()) return;
        setFailed({ error });
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
        {unmoved && (
          <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
            {t(`${KEY}.notMoved`, {
              rooms: new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(
                unmoved.rooms.map((id) => revealDirectionControls(client.getRoom(id)?.name ?? id))
              ),
            })}
          </Text>
        )}
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
      />
      {/* The warning sits under the row, so the version picker stays beside the title. */}
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
          {describeError(t, failed.error)}
          <ErrorDetail error={failed.error} />
        </Text>
      )}
      {oldRoom}
    </>
  );
}
