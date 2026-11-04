import { useEffect, useState } from 'react';
import { Box, Button, Spinner, Switch, Text, color } from 'folds';
import { useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import { type Room, Visibility } from 'matrix-js-sdk';
import { SettingTile } from '../../../components/setting-tile';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useAlive } from '../../../hooks/useAlive';
import { usePowerLevels } from '../../../hooks/usePowerLevels';
import { useRoomCreators } from '../../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../../hooks/useRoomPermissions';
import { useStateEvent } from '../../../hooks/useStateEvent';
import { roomToParentsAtom } from '../../../state/room/roomToParents';
import { HistoryVisibility, StateEvent } from '../../../../types/matrix/room';
import { type Choice, ChoiceButton } from '../../settings/ChoiceButton';
import {
  ACCESS_LABEL,
  type AccessChoice,
  availableAccessChoices,
  joinRulesContent,
} from './joinRules';

const GENERAL = 'featureUi.commonSettings.general';
const FAILED =
  'featureUi.commonSettings.permissions.permissionGroups.failedToApplyChangesPleaseTryAgain';

type OptionProps = { room: Room; space: boolean };

/** A red line under a tile whose change the server refused. */
function Refused({ shown }: { shown: boolean }) {
  const { t } = useTranslation();
  if (!shown) return null;
  return (
    <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
      {t(FAILED)}
    </Text>
  );
}

/** Sends one state event and remembers whether the server took it. */
function useStateWrite(room: Room) {
  const client = useMatrixClient();
  const alive = useAlive();
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);
  const write = (type: string, content: Record<string, unknown>) => {
    setBusy(true);
    setRefused(false);
    client
      .sendStateEvent(room.roomId, type as never, content as never, '')
      .catch(() => alive() && setRefused(true))
      .finally(() => alive() && setBusy(false));
  };
  return { busy, refused, write };
}

/** Who may join: a menu of the join rules this room version knows. */
function AccessTile({ room, space }: OptionProps) {
  const { t } = useTranslation();
  const me = useMatrixClient().getSafeUserId();
  const may = useRoomPermissions(useRoomCreators(room), usePowerLevels(room));
  const rulesEvent = useStateEvent(room, StateEvent.RoomJoinRules);
  const parents = useAtomValue(roomToParentsAtom).get(room.roomId);
  const { busy, refused, write } = useStateWrite(room);

  const content = rulesEvent?.getContent() as Record<string, unknown> | undefined;
  const current = typeof content?.join_rule === 'string' ? content.join_rule : 'invite';
  const spaceIds = [...(parents ?? [])];
  const choices = availableAccessChoices(room.getVersion(), spaceIds.length > 0, current);
  const known = choices.some((choice) => choice === current);
  const options: Choice<string>[] = choices.map((choice) => ({
    value: choice as string,
    label: t(`sharedUi.joinRulesSwitcher.${ACCESS_LABEL[choice]}` as never),
  }));
  if (!known) options.push({ value: current, label: t('sharedUi.joinRulesSwitcher.unsupported') });

  const choose = (choice: string) => {
    if (choice === current || !choices.includes(choice as AccessChoice)) return;
    write(StateEvent.RoomJoinRules, joinRulesContent(choice as AccessChoice, content, spaceIds));
  };

  const kind = space ? 'space' : 'room';
  return (
    <SettingTile
      title={t(`${GENERAL}.roomJoinRules.${kind}Access` as never)}
      description={t(`${GENERAL}.roomJoinRules.${kind}Description` as never)}
      after={
        <Box alignItems="Center" gap="200">
          {busy && <Spinner size="100" variant="Secondary" />}
          <ChoiceButton
            label={t(`${GENERAL}.roomJoinRules.${kind}Access` as never)}
            value={current}
            choices={options}
            disabled={busy || !may.stateEvent(StateEvent.RoomJoinRules, me)}
            onChoose={choose}
          />
        </Box>
      }
    >
      <Refused shown={refused} />
    </SettingTile>
  );
}

/** Whether the room is listed in this server's public room directory. */
function PublishTile({ room, space }: OptionProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const me = client.getSafeUserId();
  const may = useRoomPermissions(useRoomCreators(room), usePowerLevels(room));
  const [listed, setListed] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    let current = true;
    client.getRoomDirectoryVisibility(room.roomId).then(
      ({ visibility }) => current && setListed(visibility === Visibility.Public),
      () => current && setListed(false)
    );
    return () => {
      current = false;
    };
  }, [client, room.roomId]);

  const toggle = (next: boolean) => {
    setBusy(true);
    setRefused(false);
    client
      .setRoomDirectoryVisibility(room.roomId, next ? Visibility.Public : Visibility.Private)
      .then(() => alive() && setListed(next))
      .catch(() => alive() && setRefused(true))
      .finally(() => alive() && setBusy(false));
  };

  // The directory belongs to the server, which lets room moderators change the listing; those
  // who may publish the room's addresses are the ones this page offers it to.
  const allowed = may.stateEvent(StateEvent.RoomCanonicalAlias, me);
  return (
    <SettingTile
      title={t(`${GENERAL}.roomPublish.publishToDirectory`)}
      description={t(`${GENERAL}.roomPublish.${space ? 'space' : 'room'}Description` as never)}
      after={
        listed === undefined ? (
          <Spinner size="100" variant="Secondary" />
        ) : (
          <Switch
            variant="Primary"
            aria-label={t(`${GENERAL}.roomPublish.publishToDirectory`)}
            value={listed}
            disabled={busy || !allowed}
            onChange={toggle}
          />
        )
      }
    >
      <Refused shown={refused} />
    </SettingTile>
  );
}

const MEGOLM = 'm.megolm.v1.aes-sha2';

/** Turns on end-to-end encryption after a warning; once on, it says so and stays on. */
function EncryptionTile({ room }: OptionProps) {
  const { t } = useTranslation();
  const me = useMatrixClient().getSafeUserId();
  const may = useRoomPermissions(useRoomCreators(room), usePowerLevels(room));
  const encryption = useStateEvent(room, StateEvent.RoomEncryption);
  const { busy, refused, write } = useStateWrite(room);
  const [confirming, setConfirming] = useState(false);
  const KEY = `${GENERAL}.roomEncryption`;
  const enabled = Boolean(encryption?.getContent().algorithm);

  if (enabled) {
    return (
      <SettingTile
        title={t(`${KEY}.roomEncryption`)}
        description={t(`${KEY}.enabledDescription`)}
        after={
          <Text size="T300" style={{ color: color.Success.Main }}>
            {t(`${KEY}.enabled`)}
          </Text>
        }
      />
    );
  }

  return (
    <SettingTile
      title={t(`${KEY}.roomEncryption`)}
      description={t(`${KEY}.disabledDescription`)}
      after={
        !confirming && (
          <Button
            size="300"
            radii="300"
            variant="Primary"
            fill="Soft"
            disabled={!may.stateEvent(StateEvent.RoomEncryption, me)}
            onClick={() => setConfirming(true)}
          >
            <Text size="B300">{t(`${KEY}.enable`)}</Text>
          </Button>
        )
      }
    >
      {confirming && (
        <Box direction="Column" gap="200">
          <Text size="T200" style={{ color: color.Critical.Main }}>
            {t(`${KEY}.areYouSureOnceEnabledEncryptionCannot`)}
          </Text>
          <Box gap="200">
            <Button
              size="300"
              radii="300"
              variant="Critical"
              disabled={busy}
              before={busy ? <Spinner size="50" variant="Critical" fill="Solid" /> : undefined}
              onClick={() => write(StateEvent.RoomEncryption, { algorithm: MEGOLM })}
            >
              <Text size="B300">{t(`${KEY}.enableE2eEncryption`)}</Text>
            </Button>
            <Button
              size="300"
              radii="300"
              variant="Secondary"
              fill="Soft"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              <Text size="B300">{t(`${GENERAL}.roomProfile.cancel`)}</Text>
            </Button>
          </Box>
        </Box>
      )}
      <Refused shown={refused} />
    </SettingTile>
  );
}

const HISTORY_LABEL: Record<HistoryVisibility, string> = {
  [HistoryVisibility.Invited]: 'afterInvite',
  [HistoryVisibility.Joined]: 'afterJoin',
  [HistoryVisibility.Shared]: 'allMessages',
  [HistoryVisibility.WorldReadable]: 'allMessagesGuests',
};

/** Which history a new member can read. */
function HistoryTile({ room }: OptionProps) {
  const { t } = useTranslation();
  const me = useMatrixClient().getSafeUserId();
  const may = useRoomPermissions(useRoomCreators(room), usePowerLevels(room));
  const visibility = useStateEvent(room, StateEvent.RoomHistoryVisibility);
  const { busy, refused, write } = useStateWrite(room);
  const KEY = `${GENERAL}.roomHistoryVisibility`;
  // Matrix spec, `m.room.history_visibility`: a room without the event is `shared`.
  const stored = visibility?.getContent().history_visibility;
  const current = typeof stored === 'string' ? stored : HistoryVisibility.Shared;
  const options: Choice<string>[] = Object.values(HistoryVisibility).map((value) => ({
    value: value as string,
    label: t(`${KEY}.${HISTORY_LABEL[value]}` as never),
  }));
  if (!options.some((option) => option.value === current)) {
    options.push({ value: current, label: current });
  }

  return (
    <SettingTile
      title={t(`${KEY}.messageHistoryVisibility`)}
      description={t(`${KEY}.changesToHistoryVisibilityWillOnlyApply`)}
      after={
        <Box alignItems="Center" gap="200">
          {busy && <Spinner size="100" variant="Secondary" />}
          <ChoiceButton
            label={t(`${KEY}.messageHistoryVisibility`)}
            value={current}
            choices={options}
            disabled={busy || !may.stateEvent(StateEvent.RoomHistoryVisibility, me)}
            onChoose={(next) =>
              next !== current &&
              write(StateEvent.RoomHistoryVisibility, { history_visibility: next })
            }
          />
        </Box>
      }
    >
      <Refused shown={refused} />
    </SettingTile>
  );
}

/**
 * The General page's options: who may join, the directory listing, and for a room its
 * encryption and history visibility. Each control is disabled for those whose power level does
 * not allow the change.
 */
export function RoomAccessOptions({ room, space }: OptionProps) {
  return (
    <>
      <AccessTile room={room} space={space} />
      <PublishTile room={room} space={space} />
      {!space && <EncryptionTile room={room} space={space} />}
      {!space && <HistoryTile room={room} space={space} />}
    </>
  );
}
