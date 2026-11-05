import React, { type MouseEvent, useState } from 'react';
import { Box, Button, Chip, Icon, Icons, Spinner, Text, color, config, toRem } from 'folds';
import type { RectCords } from 'folds';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { MenuItem } from '../../ui/glass/GlassPrimitives';
import { useAlive } from '../../lib/hooks/useAlive';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import type { MemberPowerTag } from '../useMemberPowerTag';
import { usePowerLevelTags } from '../usePowerLevelTags';
import { type PowerChangeWarning, powerChangeWarning } from './profileModeration';
import { ProfilePopMenu } from './ProfilePopMenu';

const KEY = 'sharedUi.powerChip';

const WARNING_TEXT: Record<Exclude<PowerChangeWarning, undefined>, [string, string, string]> = {
  selfDemotion: ['selfDemotion', 'youAreAboutToDemoteYourselfYouWillNotBeAbleTo', 'demote'],
  sharedPower: ['sharedPower', 'youArePromotingTheUserToHaveTheSamePowerAsYourself', 'promote'],
};

type PowerChipProps = {
  room: Room;
  userId: string;
  tag: MemberPowerTag;
  /** The acting user's level, Infinity for a room creator. */
  mine: number;
  /** Whether the acting user may change this member's level. */
  editable: boolean;
  /** Opens the room's permission settings. */
  onManagePowers?: () => void;
};

/**
 * The member's power tag. For those allowed to change it, the chip opens the room's named levels
 * up to their own; demoting oneself and granting one's own level ask first.
 */
export function PowerChip({ room, userId, tag, mine, editable, onManagePowers }: PowerChipProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const tags = usePowerLevelTags(room);
  const [anchor, setAnchor] = useState<RectCords>();
  const [pending, setPending] = useState<{ level: number; warning: PowerChangeWarning }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const isSelf = userId === client.getUserId();

  const close = () => {
    setAnchor(undefined);
    setPending(undefined);
  };

  const apply = (level: number) => {
    setBusy(true);
    setError(undefined);
    client
      .setPowerLevel(room.roomId, userId, level)
      .then(() => alive() && close())
      .catch((reason: unknown) => {
        if (!alive()) return;
        setError(reason instanceof Error ? reason.name : String(reason));
      })
      .finally(() => alive() && setBusy(false));
  };

  const pick = (level: number) => {
    if (level === tag.level) {
      close();
      return;
    }
    const warning = powerChangeWarning(isSelf, mine, level);
    if (warning) setPending({ level, warning });
    else apply(level);
  };

  const levels = Object.entries(tags)
    .map(([level, entry]) => ({ level: Number(level), name: entry.name }))
    .filter((entry) => entry.level <= mine)
    .sort((a, b) => b.level - a.level);

  const failure = error && (
    <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
      {t(`${KEY}.errorName`, { name: error })}
    </Text>
  );

  let body: React.ReactNode;
  if (pending?.warning) {
    const [title, text, action] = WARNING_TEXT[pending.warning];
    body = (
      <Box
        direction="Column"
        gap="300"
        style={{ padding: config.space.S300, maxWidth: toRem(260) }}
      >
        <Text size="H6">{t(`${KEY}.${title}` as never)}</Text>
        <Text size="T200">{t(`${KEY}.${text}` as never)}</Text>
        {failure}
        <Button
          size="300"
          radii="300"
          variant="Critical"
          disabled={busy}
          before={busy ? <Spinner size="50" variant="Critical" fill="Solid" /> : undefined}
          onClick={() => apply(pending.level)}
        >
          <Text size="B300">{t(`${KEY}.${action}` as never)}</Text>
        </Button>
      </Box>
    );
  } else {
    body = (
      <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
        {levels.map((entry) => (
          <MenuItem
            key={entry.level}
            size="300"
            radii="300"
            role="menuitemradio"
            aria-checked={entry.level === tag.level}
            fill={entry.level === tag.level ? 'Soft' : 'None'}
            disabled={busy}
            onClick={() => pick(entry.level)}
          >
            <Box grow="Yes" gap="300" justifyContent="SpaceBetween">
              <Text size="T300">{entry.name}</Text>
              <Text size="T200" priority="300">
                {entry.level}
              </Text>
            </Box>
          </MenuItem>
        ))}
        {onManagePowers && (
          <MenuItem
            size="300"
            radii="300"
            role="menuitem"
            before={<Icon size="100" src={Icons.Setting} />}
            onClick={() => {
              close();
              onManagePowers();
            }}
          >
            <Text size="T300">{t(`${KEY}.managePowers`)}</Text>
          </MenuItem>
        )}
        {failure}
      </Box>
    );
  }

  const tint = tag.color ? { color: tag.color } : undefined;
  const chip = (
    <Chip
      variant="SurfaceVariant"
      radii="Pill"
      before={<Icon size="50" src={Icons.Shield} />}
      after={editable ? <Icon size="50" src={Icons.ChevronBottom} /> : undefined}
      aria-haspopup={editable ? 'menu' : undefined}
      aria-expanded={editable ? Boolean(anchor) : undefined}
      onClick={(event: MouseEvent<HTMLButtonElement>) =>
        editable && setAnchor(event.currentTarget.getBoundingClientRect())
      }
      {...(editable ? {} : { as: 'span' as const })}
    >
      <Text size="B300" style={tint}>
        {tag.name}
      </Text>
    </Chip>
  );

  if (!editable) return chip;
  return (
    <ProfilePopMenu at={anchor} onClose={close} label={tag.name} trigger={chip}>
      {body}
    </ProfilePopMenu>
  );
}
