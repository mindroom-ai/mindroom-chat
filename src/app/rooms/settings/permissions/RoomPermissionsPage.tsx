import { type MouseEvent, useState } from 'react';
import FocusTrap from 'focus-trap-react';
import type { Options as FocusTrapOptions } from 'focus-trap';
import { Box, Button, Chip, Icon, Icons, Text, color, config } from 'folds';
import { PopOut } from '../../../ui/directional';
import type { RectCords } from 'folds';
import { useTranslation } from 'react-i18next';
import { EventTimeline, type Room } from 'matrix-js-sdk';
import { Menu, MenuItem } from '../../../ui/glass/GlassPrimitives';
import { SettingTile } from '../../../ui/SettingTile';
import { useMatrixClient } from '../../../matrix/hooks/useMatrixClient';
import { RoomProvider } from '../../../matrix/hooks/useRoom';
import { readPowerLevel, usePowerLevels } from '../../../matrix/hooks/usePowerLevels';
import { usePowerLevelTags } from '../../../members/usePowerLevelTags';
import { useRoomCreators } from '../../../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../../../matrix/hooks/useRoomPermissions';
import { stopPropagation } from '../../../lib/keyboard';
import { StateEvent } from '../../../matrix/types/room';
import { PowersEditor } from './PowersEditor';
import { SettingsCard } from '../../../ui/settings/SettingsCard';
import { SettingsPageFrame } from '../../../ui/settings/SettingsPageFrame';
import { type LevelSlot, levelIn, withLevel } from '../../../matrix/permissionLevels';

const PERMISSIONS = 'featureUi.roomSettings.permissions';
const POWERS = 'featureUi.commonSettings.permissions.powers';
const GROUPS = 'featureUi.commonSettings.permissions.permissionGroups';

/** A permission: the translation key of its name and where its level lives. */
type Permission = { labelKey: string; slot: LevelSlot };

const event = (type: string): LevelSlot => ({ kind: 'event', type });
const state = (type: string): LevelSlot => ({ kind: 'state', type });

const named = (name: string, slot: LevelSlot): Permission => ({
  labelKey: `${PERMISSIONS}.${name}`,
  slot,
});

/** The permissions the page lists, by group. */
const PERMISSION_GROUPS: Array<{ group: string; items: Permission[] }> = [
  {
    group: 'messages',
    items: [
      named('sendMessages', event('m.room.message')),
      named('sendStickers', event('m.sticker')),
      named('sendReactions', event('m.reaction')),
      named('pingRoom', { kind: 'notification', key: 'room' }),
      named('pinMessages', state('m.room.pinned_events')),
      named('deleteSelfMessages', event('m.room.redaction')),
      named('deleteOthersMessages', { kind: 'action', action: 'redact' }),
    ],
  },
  {
    // MatrixRTC call membership: who may start the room's call or join it.
    group: 'calls',
    items: [named('startOrJoinCall', state(StateEvent.GroupCallMemberPrefix))],
  },
  {
    group: 'moderation',
    items: [
      named('invite', { kind: 'action', action: 'invite' }),
      named('kick', { kind: 'action', action: 'kick' }),
      named('ban', { kind: 'action', action: 'ban' }),
    ],
  },
  {
    group: 'roomOverview',
    items: [
      named('roomAvatar', state('m.room.avatar')),
      named('roomName', state('m.room.name')),
      named('roomTopic', state('m.room.topic')),
    ],
  },
  {
    group: 'settings',
    items: [
      named('changeRoomAccess', state('m.room.join_rules')),
      named('publishAddress', state('m.room.canonical_alias')),
      named('historyVisibility', state('m.room.history_visibility')),
      named('enableEncryption', state('m.room.encryption')),
      named('editPowerLevels', state('m.room.power_levels')),
      named('manageEmojisStickers', state('im.ponies.room_emotes')),
      named('changeServerAcls', state('m.room.server_acl')),
      named('upgradeRoom', state('m.room.tombstone')),
    ],
  },
  {
    group: 'other',
    items: [
      named('otherMessageEvents', { kind: 'field', field: 'events_default' }),
      named('otherSettings', { kind: 'field', field: 'state_default' }),
    ],
  },
];

const SPACE_PERMISSIONS = 'featureUi.spaceSettings.permissions';
const inSpace = (name: string, slot: LevelSlot): Permission => ({
  labelKey: `${SPACE_PERMISSIONS}.${name}`,
  slot,
});

/** A space holds rooms rather than messages, so its page leads with who may manage them. */
const SPACE_PERMISSION_GROUPS: Array<{ group: string; items: Permission[] }> = [
  { group: 'manage', items: [inSpace('manageSpaceRooms', state('m.space.child'))] },
  {
    group: 'moderation',
    items: [
      inSpace('invite', { kind: 'action', action: 'invite' }),
      inSpace('kick', { kind: 'action', action: 'kick' }),
      inSpace('ban', { kind: 'action', action: 'ban' }),
    ],
  },
  {
    group: 'spaceOverview',
    items: [
      inSpace('spaceAvatar', state('m.room.avatar')),
      inSpace('spaceName', state('m.room.name')),
      inSpace('spaceTopic', state('m.room.topic')),
    ],
  },
  {
    group: 'settings',
    items: [
      inSpace('changeSpaceAccess', state('m.room.join_rules')),
      inSpace('publishAddress', state('m.room.canonical_alias')),
      inSpace('editPowerLevels', state('m.room.power_levels')),
      inSpace('manageEmojisStickers', state('im.ponies.room_emotes')),
      inSpace('changeServerAcls', state('m.room.server_acl')),
      inSpace('upgradeSpace', state('m.room.tombstone')),
    ],
  },
  {
    group: 'other',
    items: [
      inSpace('messageEvents', { kind: 'field', field: 'events_default' }),
      inSpace('otherSettings', { kind: 'field', field: 'state_default' }),
    ],
  },
];

// The levels menu closes on Escape, which stays inside the dialog, or on a click beside it.
const LIGHT_DISMISS = { clickOutsideDeactivates: true, escapeDeactivates: stopPropagation };
const menuTrap = (close: () => void): FocusTrapOptions => ({
  ...LIGHT_DISMISS,
  initialFocus: false,
  onDeactivate: close,
});

/** A level chip that, for those allowed to change it, opens the levels the room names. */
function LevelPicker({
  label,
  level,
  choices,
  disabled,
  onPick,
}: {
  label: string;
  level: number;
  choices: Array<{ level: number; name: string }>;
  disabled: boolean;
  onPick: (level: number) => void;
}) {
  const [anchor, setAnchor] = useState<RectCords>();
  const current = choices.find((choice) => choice.level === level);
  const hide = () => setAnchor(undefined);
  const levelsMenu = (
    <FocusTrap focusTrapOptions={menuTrap(hide)}>
      <Menu aria-label={label}>
        <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
          {choices.map((choice) => (
            <MenuItem
              key={choice.level}
              size="300"
              radii="300"
              role="menuitemradio"
              aria-checked={choice.level === level}
              fill={choice.level === level ? 'Soft' : 'None'}
              onClick={() => {
                hide();
                if (choice.level !== level) onPick(choice.level);
              }}
            >
              <Box grow="Yes" gap="200" justifyContent="SpaceBetween">
                <Text size="T300">{choice.name}</Text>
                <Text size="T200" priority="300">
                  {choice.level}
                </Text>
              </Box>
            </MenuItem>
          ))}
        </Box>
      </Menu>
    </FocusTrap>
  );

  return (
    <PopOut anchor={anchor} offset={4} align="End" position="Bottom" content={levelsMenu}>
      <Chip
        variant="Secondary"
        radii="300"
        disabled={disabled}
        aria-label={`${label}: ${current?.name ?? level}`}
        after={disabled ? undefined : <Icon size="50" src={Icons.ChevronBottom} />}
        onClick={(evt: MouseEvent<HTMLButtonElement>) =>
          setAnchor(evt.currentTarget.getBoundingClientRect())
        }
      >
        <Text size="T200">{current?.name ?? String(level)}</Text>
      </Chip>
    </PopOut>
  );
}

type PermissionsPageProps = {
  room: Room;
  /** Lists the permissions a space has, in a space's words. */
  space?: boolean;
  requestClose: () => void;
};

/**
 * Who may do what in the room: the named power levels (edited in the levels editor), the level a
 * new member gets, and the level each permission needs. Changes apply at once; nobody can hand
 * out a level above their own.
 */
export function RoomPermissionsPage({ room, space = false, requestClose }: PermissionsPageProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const levels = usePowerLevels(room);
  const tags = usePowerLevelTags(room);
  const creators = useRoomCreators(room);
  const may = useRoomPermissions(creators, levels);
  const me = client.getSafeUserId();
  const [editingPowers, setEditingPowers] = useState(false);
  const [failed, setFailed] = useState(false);

  const mine = creators.has(me) ? Infinity : readPowerLevel.user(levels, me);
  const canEdit = may.stateEvent(StateEvent.RoomPowerLevels, me);
  const choices = Object.entries(tags)
    .map(([level, tag]) => ({ level: Number(level), name: tag.name }))
    .sort((a, b) => b.level - a.level);
  // A level only shows among the choices when the room names it; others still show as numbers.
  const choicesFor = (level: number) =>
    choices.some((choice) => choice.level === level)
      ? choices
      : [...choices, { level, name: String(level) }].sort((a, b) => b.level - a.level);

  const change = (slot: LevelSlot, level: number) => {
    const stored = room
      .getLiveTimeline()
      .getState(EventTimeline.FORWARDS)
      ?.getStateEvents(StateEvent.RoomPowerLevels, '')
      ?.getContent();
    setFailed(false);
    client
      .sendStateEvent(
        room.roomId,
        StateEvent.RoomPowerLevels as never,
        withLevel(stored ?? {}, slot, level) as never,
        ''
      )
      .catch(() => setFailed(true));
  };

  if (editingPowers) {
    return (
      <RoomProvider value={room}>
        <PowersEditor powerLevels={levels} requestClose={() => setEditingPowers(false)} />
      </RoomProvider>
    );
  }

  const tile = (permission: Permission) => {
    const level = levelIn(levels, permission.slot);
    const label = t(permission.labelKey as never);
    // Above one's own level a permission is out of reach, and so are the levels above it.
    const reachable = canEdit && level <= mine;
    return (
      <SettingTile
        key={permission.labelKey}
        title={label}
        after={
          <LevelPicker
            label={label}
            level={level}
            choices={choicesFor(level).filter((choice) => choice.level <= mine)}
            disabled={!reachable}
            onPick={(next) => change(permission.slot, next)}
          />
        }
      />
    );
  };

  return (
    <SettingsPageFrame
      title={t(space ? `${SPACE_PERMISSIONS}.permissions` : `${PERMISSIONS}.permissions`)}
      requestClose={requestClose}
    >
      <Box direction="Column" gap="100">
        <Text size="L400" data-settings-heading="">
          {t(`${POWERS}.powerLevels`)}
        </Text>
        <SettingsCard>
          <SettingTile
            title={t(`${POWERS}.powerLevels`)}
            description={t(`${POWERS}.manageAndCustomizeIncrementalPowerLevelsFor`)}
            after={
              <Button
                size="300"
                radii="300"
                variant="Secondary"
                fill="Soft"
                disabled={!canEdit}
                onClick={() => setEditingPowers(true)}
              >
                <Text size="B300">{t(`${POWERS}.edit`)}</Text>
              </Button>
            }
          />
          <Box gap="200" wrap="Wrap">
            {creators.size > 0 && (
              <Chip variant="Success" radii="Pill" outlined aria-disabled>
                <Text size="T200">{t('sharedUi.powerLevels.founder')}</Text>
              </Chip>
            )}
            {choices.map((choice) => (
              <Chip key={choice.level} variant="SurfaceVariant" radii="Pill" outlined aria-disabled>
                <Text size="T200">{`${choice.name} · ${choice.level}`}</Text>
              </Chip>
            ))}
          </Box>
        </SettingsCard>
      </Box>
      {failed && (
        <Text size="T300" role="alert" style={{ color: color.Critical.Main }}>
          {t(`${GROUPS}.failedToApplyChangesPleaseTryAgain`)}
        </Text>
      )}
      <Box direction="Column" gap="100">
        <Text size="L400" data-settings-heading="">
          {t(`${GROUPS}.users`)}
        </Text>
        <SettingsCard>
          {tile({
            labelKey: `${GROUPS}.defaultPower`,
            slot: { kind: 'field', field: 'users_default' },
          })}
        </SettingsCard>
      </Box>
      {(space ? SPACE_PERMISSION_GROUPS : PERMISSION_GROUPS).map(({ group, items }) => (
        <Box key={group} direction="Column" gap="100">
          <Text size="L400" data-settings-heading="">
            {t(`${space ? SPACE_PERMISSIONS : PERMISSIONS}.groups.${group}` as never)}
          </Text>
          <SettingsCard>{items.map(tile)}</SettingsCard>
        </Box>
      ))}
    </SettingsPageFrame>
  );
}
