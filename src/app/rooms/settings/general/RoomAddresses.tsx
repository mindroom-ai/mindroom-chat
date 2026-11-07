import React, { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Badge, Box, Button, Input, Spinner, Text, color } from 'folds';
import { Trans, useTranslation } from 'react-i18next';
import { MatrixError, type Room } from 'matrix-js-sdk';
import { SettingTile } from '../../../ui/SettingTile';
import { useMatrixClient } from '../../../matrix/hooks/useMatrixClient';
import { useAlive } from '../../../lib/hooks/useAlive';
import { usePowerLevels } from '../../../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../../../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../../../matrix/hooks/useRoomPermissions';
import { useStateEvent } from '../../../matrix/hooks/useStateEvent';
import { StateEvent } from '../../../matrix/types/room';
import { SettingsCard } from '../../../ui/settings/SettingsCard';
import {
  type PublishedAliases,
  publishAlias,
  readMain,
  readPublished,
  setMainAlias,
  unpublishAlias,
  unsetMainAlias,
} from './roomAliases';

const KEY = 'featureUi.commonSettings.general.roomAddress';
const FAILED =
  'featureUi.commonSettings.permissions.permissionGroups.failedToApplyChangesPleaseTryAgain';

function Problem({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
      {text}
    </Text>
  );
}

function SmallButton({
  label,
  onClick,
  disabled,
  critical,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  critical?: boolean;
}) {
  return (
    <Button
      size="300"
      radii="300"
      fill="Soft"
      variant={critical ? 'Critical' : 'Secondary'}
      disabled={disabled}
      onClick={onClick}
    >
      <Text size="B300">{label}</Text>
    </Button>
  );
}

/** One address on a line, with its badge and actions on the right. */
function AddressRow({ alias, children }: { alias: string; children: React.ReactNode }) {
  return (
    <Box alignItems="Center" gap="200" wrap="Wrap" data-room-address={alias}>
      <Box grow="Yes" style={{ minWidth: 0 }}>
        <Text size="T300" truncate>
          {alias}
        </Text>
      </Box>
      <Box gap="200" alignItems="Center" shrink="No">
        {children}
      </Box>
    </Box>
  );
}

type AddressProps = { room: Room };

/**
 * The room's published addresses (`m.room.canonical_alias`): the main one and the others, each
 * with the actions of those who may change them.
 */
function PublishedAddresses({ room, onChange }: AddressProps & { onChange: Publish }) {
  const { t } = useTranslation();
  const me = useMatrixClient().getSafeUserId();
  const may = useRoomPermissions(useRoomCreators(room), usePowerLevels(room));
  const content = useStateEvent(room, StateEvent.RoomCanonicalAlias)?.getContent();
  const published = readPublished(content);
  const main = readMain(content);
  const allowed = may.stateEvent(StateEvent.RoomCanonicalAlias, me);

  return (
    <SettingsCard>
      <SettingTile
        title={t(`${KEY}.publishedAddresses`)}
        description={
          <Trans i18nKey={`${KEY}.publishedAddressesDescription`} components={{ public: <b /> }} />
        }
      />
      {published.length === 0 && (
        <Text size="T300" priority="300">
          {t(`${KEY}.noAddresses`)}
        </Text>
      )}
      {published.map((alias) => (
        <AddressRow key={alias} alias={alias}>
          {alias === main && (
            <Badge variant="Success" fill="Soft" radii="Pill">
              <Text size="L400">{t(`${KEY}.main`)}</Text>
            </Badge>
          )}
          {allowed && (
            <>
              <SmallButton
                label={t(`${KEY}.${alias === main ? 'unsetMain' : 'setMain'}`)}
                onClick={() =>
                  onChange(alias === main ? unsetMainAlias(content) : setMainAlias(content, alias))
                }
              />
              <SmallButton
                critical
                label={t(`${KEY}.unpublish`)}
                onClick={() => onChange(unpublishAlias(content, alias))}
              />
            </>
          )}
        </AddressRow>
      ))}
    </SettingsCard>
  );
}

type Publish = (next: PublishedAliases) => void;

/**
 * This server's addresses for the room. They load when the list opens; those allowed may add
 * one, delete one, or publish one.
 */
function LocalAddresses({ room, onPublish }: AddressProps & { onPublish: Publish }) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const me = client.getSafeUserId();
  const may = useRoomPermissions(useRoomCreators(room), usePowerLevels(room));
  const content = useStateEvent(room, StateEvent.RoomCanonicalAlias)?.getContent();
  const published = readPublished(content);
  const [open, setOpen] = useState(false);
  const [aliases, setAliases] = useState<string[]>();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const server = client.getDomain();

  const load = useCallback(() => {
    client.getLocalAliases(room.roomId).then(
      (result) => alive() && setAliases(result.aliases),
      () => alive() && setAliases([])
    );
  }, [client, room.roomId, alive]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const local = draft.trim().replace(/^#/, '').split(':')[0];
    if (!local) return;
    setBusy(true);
    setProblem(undefined);
    client
      .createAlias(`#${local}:${server}`, room.roomId)
      .then(() => {
        if (!alive()) return;
        setDraft('');
        load();
      })
      .catch((error: unknown) => {
        if (!alive()) return;
        const inUse = error instanceof MatrixError && error.errcode === 'M_ROOM_IN_USE';
        setProblem(inUse ? t(`${KEY}.addressAlreadyInUse`) : t(FAILED));
      })
      .finally(() => alive() && setBusy(false));
  };

  const remove = (alias: string) => {
    setBusy(true);
    setProblem(undefined);
    client
      .deleteAlias(alias)
      .then(() => alive() && load())
      .catch(() => alive() && setProblem(t(FAILED)))
      .finally(() => alive() && setBusy(false));
  };

  const canPublish = may.stateEvent(StateEvent.RoomCanonicalAlias, me);
  return (
    <SettingsCard>
      <SettingTile
        title={t(`${KEY}.localAddresses`)}
        description={t(`${KEY}.localAddressesDescription`)}
        after={
          <SmallButton
            label={t(`${KEY}.${open ? 'collapse' : 'expand'}`)}
            onClick={() => setOpen((shown) => !shown)}
          />
        }
      />
      {open && (
        <>
          {aliases === undefined && (
            <Box gap="200" alignItems="Center">
              <Spinner size="100" variant="Secondary" />
              <Text size="T300">{t(`${KEY}.loading`)}</Text>
            </Box>
          )}
          {aliases?.length === 0 && (
            <Text size="T300" priority="300">
              {t(`${KEY}.noAddresses`)}
            </Text>
          )}
          {aliases?.map((alias) => (
            <AddressRow key={alias} alias={alias}>
              {published.includes(alias) ? (
                <Badge variant="Secondary" fill="Soft" radii="Pill">
                  <Text size="L400">{t(`${KEY}.published`)}</Text>
                </Badge>
              ) : (
                canPublish && (
                  <SmallButton
                    label={t(`${KEY}.publish`)}
                    disabled={busy}
                    onClick={() => onPublish(publishAlias(content, alias))}
                  />
                )
              )}
              <SmallButton
                critical
                label={t(`${KEY}.delete`)}
                disabled={busy}
                onClick={() => remove(alias)}
              />
            </AddressRow>
          ))}
          <Box as="form" gap="200" alignItems="Center" onSubmit={add}>
            <Box grow="Yes" direction="Column">
              <Input
                aria-label={t(`${KEY}.localAddresses`)}
                value={draft}
                onChange={(event) => setDraft(event.currentTarget.value)}
                variant="Background"
                size="300"
                radii="300"
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
                before={<Text size="T300">#</Text>}
                after={
                  <Text size="T300" priority="300">
                    {`:${server}`}
                  </Text>
                }
              />
            </Box>
            <Button
              type="submit"
              size="300"
              radii="300"
              variant="Primary"
              disabled={busy || !draft.trim()}
            >
              <Text size="B300">{t(`${KEY}.save`)}</Text>
            </Button>
          </Box>
          <Text size="T200" priority="300">
            {t(`${KEY}.publishRequiresLocalAddress`)}
          </Text>
          <Problem text={problem} />
        </>
      )}
    </SettingsCard>
  );
}

/** The General page's Addresses section: published addresses over this server's local ones. */
export function RoomAddresses({ room }: AddressProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const [refused, setRefused] = useState(false);

  const publish: Publish = (next) => {
    setRefused(false);
    client
      .sendStateEvent(room.roomId, StateEvent.RoomCanonicalAlias as never, next as never, '')
      .catch(() => alive() && setRefused(true));
  };

  return (
    <Box direction="Column" gap="100">
      <Text size="L400" data-settings-heading="">
        {t('featureUi.roomSettings.general.addresses')}
      </Text>
      <Box direction="Column" gap="200">
        <PublishedAddresses room={room} onChange={publish} />
        <LocalAddresses room={room} onPublish={publish} />
        <Problem text={refused ? t(FAILED) : undefined} />
      </Box>
    </Box>
  );
}
