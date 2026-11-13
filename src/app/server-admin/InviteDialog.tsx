import { useId, useMemo, useState } from 'react';
import { Box, Button, Chip, Switch, Text, TextArea, color } from 'folds';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { useAlive } from '../lib/hooks/useAlive';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { mDirectAtom } from '../matrix/state/mDirectList';
import { ActionDialog } from '../ui/ActionDialog';
import { SettingTile } from '../ui/SettingTile';
import { CopyInvitation } from './CopyInvitation';
import {
  invitableRooms,
  inviteAddresses,
  inviteErrorText,
  parseAddresses,
  type InviteResult,
} from './invites';

type InviteDialogProps = {
  /** The names of the providers the homeserver signs people in with. */
  providers: readonly string[];
  onClose: () => void;
  /** Called once the server answered, so the list reads the invites again. */
  onInvited: () => void;
};

/**
 * Invites one or more pasted email addresses with the same rooms and external mark, then says
 * what became of each address and gives the invitation to send to it.
 */
export function InviteDialog({ providers, onClose, onInvited }: InviteDialogProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const alive = useAlive();
  const directs = useAtomValue(mDirectAtom);
  const rooms = useMemo(() => invitableRooms(mx, directs), [mx, directs]);
  const addressesId = useId();
  const [pasted, setPasted] = useState('');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [external, setExternal] = useState(true);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<InviteResult[]>();
  const addresses = parseAddresses(pasted);
  const label = t('serverAccounts.invites.add');

  const toggleRoom = (roomId: string) =>
    setChosen((previous) => {
      const next = new Set(previous);
      if (!next.delete(roomId)) next.add(roomId);
      return next;
    });

  const invite = () => {
    setBusy(true);
    const roomIds = rooms.map(({ roomId }) => roomId).filter((roomId) => chosen.has(roomId));
    // Each address has its own answer, so this never rejects.
    void inviteAddresses(mx, addresses, roomIds, external).then((answers) => {
      onInvited();
      if (!alive()) return;
      setResults(answers);
      setBusy(false);
    });
  };

  if (results) {
    return (
      <ActionDialog label={label} onClose={onClose} busy={false}>
        {results.map(({ address, invite: stored, error }) => (
          <Box key={address} alignItems="Center" gap="200" wrap="Wrap" data-invite-result={address}>
            <Text size="T300">
              <bdi>{stored?.email ?? address}</bdi>
            </Text>
            {stored ? (
              <>
                <Text size="T200" style={{ color: color.Success.Main }}>
                  {t('serverAccounts.invites.invited')}
                </Text>
                <CopyInvitation email={stored.email} providers={providers} showText />
              </>
            ) : (
              <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
                {inviteErrorText(t, error)}
              </Text>
            )}
          </Box>
        ))}
        <Text size="T200" priority="300">
          {t('serverAccounts.invites.sendYourself')}
        </Text>
        <Box justifyContent="End">
          <Button type="button" size="300" variant="Primary" radii="300" onClick={onClose}>
            <Text size="B300">{t('threadActions.done')}</Text>
          </Button>
        </Box>
      </ActionDialog>
    );
  }

  return (
    <ActionDialog label={label} onClose={onClose} busy={busy}>
      <Box direction="Column" gap="100">
        <Text as="label" htmlFor={addressesId} size="L400">
          {t('serverAccounts.invites.addresses')}
        </Text>
        <TextArea
          id={addressesId}
          value={pasted}
          onChange={(event) => setPasted(event.currentTarget.value)}
          variant="Background"
          size="300"
          radii="300"
          rows={3}
          autoComplete="off"
          spellCheck={false}
        />
        <Text size="T200" priority="300">
          {t('serverAccounts.invites.addressesHint')}
        </Text>
      </Box>
      {rooms.length > 0 && (
        <Box
          direction="Column"
          gap="100"
          role="group"
          aria-label={t('serverAccounts.invites.rooms')}
        >
          <Text size="L400">{t('serverAccounts.invites.rooms')}</Text>
          <Box gap="100" wrap="Wrap" style={{ maxHeight: '9rem', overflowY: 'auto' }}>
            {rooms.map(({ roomId, name }) => (
              <Chip
                key={roomId}
                type="button"
                variant={chosen.has(roomId) ? 'Primary' : 'SurfaceVariant'}
                radii="Pill"
                aria-pressed={chosen.has(roomId)}
                data-invite-room={roomId}
                onClick={() => toggleRoom(roomId)}
              >
                <Text size="T200" truncate>
                  {name}
                </Text>
              </Chip>
            ))}
          </Box>
        </Box>
      )}
      <SettingTile
        title={t('serverAccounts.invites.external')}
        description={t('serverAccounts.externalNote')}
        after={
          <Switch
            variant="Primary"
            aria-label={t('serverAccounts.invites.external')}
            value={external}
            onChange={setExternal}
          />
        }
      />
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
          variant="Primary"
          radii="300"
          disabled={busy || addresses.length === 0}
          data-invite-send=""
          onClick={invite}
        >
          <Text size="B300">{t('sharedUi.inviteUserPrompt.invite')}</Text>
        </Button>
      </Box>
    </ActionDialog>
  );
}
