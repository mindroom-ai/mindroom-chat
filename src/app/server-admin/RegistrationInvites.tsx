import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Box, Button, Icon, IconButton, Icons, Spinner, Text, color } from 'folds';
import { useTranslation } from 'react-i18next';
import { describeError } from '../lib/describeError';
import { useAlive } from '../lib/hooks/useAlive';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { ActionDialog } from '../ui/ActionDialog';
import { ErrorDetail } from '../ui/ErrorDetail';
import { SettingTile } from '../ui/SettingTile';
import { SettingsCard } from '../ui/settings/SettingsCard';
import { CopyInvitation } from './CopyInvitation';
import { InviteDialog } from './InviteDialog';
import { deleteInvite, listInvites, ssoProviderNames, type RegistrationInvite } from './invites';

type ConfirmDeleteProps = {
  email: string;
  onClose: () => void;
  /** Called after the invite is gone. */
  onDone: () => void;
};

/** Asks before an invite is deleted, naming its address; it stays open with the error when the server refuses. */
function ConfirmDelete({ email, onClose, onDone }: ConfirmDeleteProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const alive = useAlive();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const label = t('serverAccounts.invites.delete');

  const run = () => {
    setBusy(true);
    setError(undefined);
    deleteInvite(mx, email).then(
      () => alive() && onDone(),
      (reason: unknown) => {
        if (!alive()) return;
        setError(reason ?? new Error('unknown'));
        setBusy(false);
      }
    );
  };

  return (
    <ActionDialog label={label} onClose={onClose} busy={busy}>
      <Text size="T300">{t('serverAccounts.invites.confirmDelete', { email })}</Text>
      {error !== undefined && (
        <Text role="alert" size="T200" style={{ color: color.Critical.Main }}>
          {describeError(t, error)}
          <ErrorDetail error={error} />
        </Text>
      )}
      <Box justifyContent="End" gap="200">
        <Button
          type="button"
          size="300"
          variant="Secondary"
          fill="Soft"
          radii="300"
          disabled={busy}
          onClick={onClose}
        >
          <Text size="B300">{t('threadActions.cancel')}</Text>
        </Button>
        <Button
          type="button"
          size="300"
          variant="Critical"
          radii="300"
          disabled={busy}
          data-confirm-delete=""
          onClick={run}
        >
          <Text size="B300">{label}</Text>
        </Button>
      </Box>
    </ActionDialog>
  );
}

/**
 * The homeserver's registration invites, on the Server accounts page of a server that has them:
 * the pending ones, each with its rooms, its invitation to copy and a way to delete it, and the
 * form that adds more.
 */
export function RegistrationInvites() {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const alive = useAlive();
  const [invites, setInvites] = useState<RegistrationInvite[]>();
  const [error, setError] = useState<unknown>();
  const [providers, setProviders] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<string>();

  const latestLoad = useRef(0);
  const load = useCallback(() => {
    latestLoad.current += 1;
    const request = latestLoad.current;
    // Only the latest load counts: an earlier one may answer last, with older invites.
    const current = () => alive() && request === latestLoad.current;
    setError(undefined);
    listInvites(mx).then(
      (loaded) => current() && setInvites(loaded),
      (reason: unknown) => current() && setError(reason ?? new Error('unknown'))
    );
  }, [mx, alive]);
  useEffect(load, [load]);

  useEffect(() => {
    void ssoProviderNames(mx).then((names) => alive() && setProviders(names));
  }, [mx, alive]);

  return (
    <Box direction="Column" gap="100">
      <Text size="L400" data-settings-heading="">
        {t('serverAccounts.invites.title')}
      </Text>
      <SettingsCard>
        <SettingTile
          description={`${t('serverAccounts.invites.description')} ${t(
            'serverAccounts.invites.sendYourself'
          )}`}
          after={
            <Button
              type="button"
              size="300"
              variant="Primary"
              radii="300"
              data-invite-add=""
              onClick={() => setAdding(true)}
            >
              <Text size="B300">{t('serverAccounts.invites.add')}</Text>
            </Button>
          }
        />
        {error !== undefined && (
          <SettingTile
            after={
              <Button size="300" variant="Secondary" fill="Soft" radii="300" onClick={load}>
                <Text size="B300">{t('sharedUi.roomCard.retry')}</Text>
              </Button>
            }
          >
            <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
              {t('serverAccounts.invites.loadFailed')} {describeError(t, error)}
            </Text>
          </SettingTile>
        )}
        {!invites && error === undefined && <Spinner size="200" />}
        {invites?.length === 0 && <SettingTile description={t('serverAccounts.invites.none')} />}
        {invites?.map(({ email, rooms, external }) => (
          <SettingTile
            key={email}
            title={<bdi>{email}</bdi>}
            description={rooms.map((room) => mx.getRoom(room)?.name ?? room).join(' · ')}
            after={
              <IconButton
                type="button"
                size="300"
                variant="Critical"
                fill="Soft"
                radii="300"
                aria-label={t('serverAccounts.invites.delete')}
                data-invite-delete={email}
                onClick={() => setDeleting(email)}
              >
                <Icon size="100" src={Icons.Delete} />
              </IconButton>
            }
          >
            {/* Below the address rather than beside it, where a phone has no room for them. */}
            <Box alignItems="Center" gap="200" wrap="Wrap">
              {external && (
                <Badge variant="Warning" fill="Soft" radii="Pill" size="500">
                  <Text as="span" size="L400">
                    {t('serverAccounts.filters.external')}
                  </Text>
                </Badge>
              )}
              <CopyInvitation email={email} providers={providers} />
            </Box>
          </SettingTile>
        ))}
      </SettingsCard>
      {adding && (
        <InviteDialog providers={providers} onClose={() => setAdding(false)} onInvited={load} />
      )}
      {deleting !== undefined && (
        <ConfirmDelete
          email={deleting}
          onClose={() => setDeleting(undefined)}
          onDone={() => {
            setDeleting(undefined);
            load();
          }}
        />
      )}
    </Box>
  );
}
