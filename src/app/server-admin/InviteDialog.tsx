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
  roomLabel,
  type InviteResult,
} from './invites';

type InviteDialogProps = {
  /** The names of the providers the homeserver signs people in with. */
  providers: readonly string[];
  /** The addresses that have a pending invite, as the server stores them: in lowercase. */
  pending: ReadonlySet<string>;
  onClose: () => void;
  /** Called once the server answered, so the list reads the invites again. */
  onInvited: () => void;
};

/** What became of one address, and whether its invite took the place of an earlier one. */
type Outcome = InviteResult & { replaces: boolean };

/**
 * Invites one or more pasted email addresses with the same rooms and external mark, then says
 * what became of each address and gives the invitation to send to it.
 */
export function InviteDialog({ providers, pending, onClose, onInvited }: InviteDialogProps) {
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
  const [outcomes, setOutcomes] = useState<Outcome[]>();
  const addresses = parseAddresses(pasted);
  const label = t('serverAccounts.invites.add');
  // The server puts the new rooms and external mark in the place of the invite an address had.
  const replaces = (
    <Text size="T200" style={{ color: color.Warning.Main }}>
      {t('serverAccounts.invites.replaces')}
    </Text>
  );

  const toggleRoom = (roomId: string) =>
    setChosen((previous) => {
      const next = new Set(previous);
      if (!next.delete(roomId)) next.add(roomId);
      return next;
    });

  const invite = () => {
    setBusy(true);
    const roomIds = rooms.map(({ roomId }) => roomId).filter((roomId) => chosen.has(roomId));
    // The invites from before this one: the list is about to read them again, with the new ones.
    const earlier = pending;
    // Each address has its own answer, so this never rejects.
    void inviteAddresses(mx, addresses, roomIds, external).then((answers) => {
      onInvited();
      if (!alive()) return;
      setOutcomes(
        answers.map((answer) => ({
          ...answer,
          replaces: answer.invite !== undefined && earlier.has(answer.invite.email),
        }))
      );
      setBusy(false);
    });
  };

  if (outcomes) {
    return (
      <ActionDialog label={label} onClose={onClose} busy={false}>
        {/* Many addresses scroll here, so the button below them stays in view. */}
        <Box
          direction="Column"
          gap="300"
          style={{ flexShrink: 1, minHeight: '5rem', overflowY: 'auto' }}
          data-invite-results=""
        >
          {outcomes.map(({ address, invite: stored, error, replaces: replaced }) => (
            <Box
              key={address}
              shrink="No"
              alignItems="Center"
              gap="200"
              wrap="Wrap"
              data-invite-result={address}
            >
              <Text size="T300">
                <bdi>{stored?.email ?? address}</bdi>
              </Text>
              {stored ? (
                <>
                  <Text size="T200" style={{ color: color.Success.Main }}>
                    {t('serverAccounts.invites.invited')}
                  </Text>
                  {replaced && replaces}
                  <CopyInvitation email={stored.email} providers={providers} showText />
                </>
              ) : (
                <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
                  {inviteErrorText(t, error)}
                </Text>
              )}
            </Box>
          ))}
        </Box>
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
        {addresses
          .filter((address) => pending.has(address.toLowerCase()))
          .map((address) => (
            <Box key={address} gap="200" wrap="Wrap" data-invite-replaces={address}>
              <Text size="T200">
                <bdi>{address}</bdi>
              </Text>
              {replaces}
            </Box>
          ))}
      </Box>
      {rooms.length > 0 && (
        <Box
          direction="Column"
          gap="100"
          role="group"
          aria-label={t('serverAccounts.invites.rooms')}
        >
          <Text size="L400">{t('serverAccounts.invites.rooms')}</Text>
          <Box
            gap="100"
            wrap="Wrap"
            style={{ maxHeight: '9rem', overflowX: 'hidden', overflowY: 'auto' }}
          >
            {rooms.map((room) => (
              <Chip
                key={room.roomId}
                type="button"
                variant={chosen.has(room.roomId) ? 'Primary' : 'SurfaceVariant'}
                radii="Pill"
                aria-pressed={chosen.has(room.roomId)}
                // The address tells a room from another of the same name, and from a look-alike.
                title={room.address}
                // A room ID is long: the chip ends with the row, and its text is cut there.
                style={{ maxWidth: '100%' }}
                data-invite-room={room.roomId}
                onClick={() => toggleRoom(room.roomId)}
              >
                <Text size="T200" truncate style={{ minWidth: 0 }}>
                  {roomLabel(room, rooms)}
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
