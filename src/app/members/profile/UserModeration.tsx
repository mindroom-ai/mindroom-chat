import { type FormEvent, useState } from 'react';
import { Box, Button, Icon, Icons, Input, Spinner, Text, color } from 'folds';
import { Trans, useTranslation } from 'react-i18next';
import type { Room, RoomMember } from 'matrix-js-sdk';
import { useAlive } from '../../lib/hooks/useAlive';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { Membership } from '../../matrix/types/room';
import { getMemberDisplayName } from '../../matrix/room';
import { revealDirectionControls } from '../../ui/directional';
import type { ModerationAbilities } from './profileModeration';
import * as css from './UserRoomProfile.css';
import { describeError } from '../../lib/describeError';
import { ErrorDetail } from '../../ui/ErrorDetail';

const KEY = 'sharedUi.userModeration';

type Action = 'kick' | 'ban' | 'unban' | 'invite';

const BOLD = { b: <b /> };
// Escaped, a revealed `<U+202E>` and a name's `<` stay text instead of reading as tags.
const ESCAPED = { interpolation: { escapeValue: true } };

type NoteKind = 'ban' | 'invite' | 'kick';
type Note = { kind: NoteKind; senderName: string; reason?: string };

/** The membership a moderator acted on: who did it and why, read from the member event. */
const membershipNote = (room: Room, member: RoomMember | null): Note | undefined => {
  const event = member?.events.member;
  if (!member || !event) return undefined;
  const sender = event.getSender();
  const senderName = (sender && getMemberDisplayName(room, sender)) || sender || '';
  const reason = event.getContent().reason;
  const text = typeof reason === 'string' && reason.trim() ? reason : undefined;
  if (member.membership === Membership.Ban) return { kind: 'ban', senderName, reason: text };
  if (member.membership === Membership.Invite) return { kind: 'invite', senderName, reason: text };
  // Someone else ending a membership kicks only a member: lifting a ban, withdrawing an invite
  // or turning down a request to join is not a kick.
  const previous: unknown = event.getPrevContent().membership;
  const removedMember =
    previous !== Membership.Ban && previous !== Membership.Invite && previous !== Membership.Knock;
  if (member.membership === Membership.Leave && sender !== member.userId && removedMember) {
    return { kind: 'kick', senderName, reason: text };
  }
  return undefined;
};

const NOTE_TITLE = { ban: 'bannedUser', invite: 'invitedUser', kick: 'kickedUser' } as const;
const NOTE_BY = { ban: 'bannedBy', invite: 'invitedBy', kick: 'kickedBy' } as const;

type UserModerationProps = {
  room: Room;
  userId: string;
  abilities: ModerationAbilities;
};

/**
 * Moderation in the profile card: a note when the member was banned, invited or removed (by whom
 * and why), and the actions the user's power level allows. Removing and banning ask for an
 * optional reason first.
 */
export function UserModeration({ room, userId, abilities }: UserModerationProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const member = room.getMember(userId);
  const note = membershipNote(room, member);
  const [asking, setAsking] = useState<'kick' | 'ban'>();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<Action>();
  const [failed, setFailed] = useState<{ error: unknown }>();

  const run = (action: Action) => {
    const why = reason.trim() || undefined;
    const request = {
      kick: () => client.kick(room.roomId, userId, why),
      ban: () => client.ban(room.roomId, userId, why),
      unban: () => client.unban(room.roomId, userId),
      invite: () => client.invite(room.roomId, userId),
    }[action];
    setBusy(action);
    setFailed(undefined);
    request()
      .then(() => {
        if (!alive()) return;
        setAsking(undefined);
        setReason('');
      })
      .catch((error: unknown) => {
        if (!alive()) return;
        setFailed({ error });
      })
      .finally(() => alive() && setBusy(undefined));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (asking) run(asking);
  };

  const button = (action: Action, label: string, critical: boolean, onClick: () => void) => (
    <Button
      key={action}
      size="300"
      radii="300"
      variant={critical ? 'Critical' : 'Secondary'}
      fill="Soft"
      disabled={busy !== undefined}
      before={busy === action ? <Spinner size="50" variant="Secondary" /> : undefined}
      onClick={onClick}
    >
      <Text size="B300">{label}</Text>
    </Button>
  );

  const noteAction = (() => {
    if (note?.kind === 'ban' && abilities.unban) {
      return button('unban', t(`${KEY}.unban`), false, () => run('unban'));
    }
    if (note?.kind === 'invite' && abilities.kick) {
      return button('kick', t(`${KEY}.cancelInvite`), true, () => run('kick'));
    }
    return undefined;
  })();

  const actions = [
    abilities.invite && button('invite', t(`${KEY}.invite`), false, () => run('invite')),
    abilities.kick &&
      member?.membership === Membership.Join &&
      button('kick', t(`${KEY}.kick`), true, () => setAsking('kick')),
    abilities.ban && button('ban', t(`${KEY}.ban`), true, () => setAsking('ban')),
  ].filter(Boolean);

  if (!note && actions.length === 0) return null;

  return (
    <Box direction="Column" gap="200" data-user-moderation="">
      {note && (
        <Box className={css.ProfileNoteTone.quiet} direction="Column" gap="100">
          <Box alignItems="Center" gap="200">
            <Icon size="100" src={note.kind === 'invite' ? Icons.Mail : Icons.Warning} />
            <Text size="L400">{t(`${KEY}.${NOTE_TITLE[note.kind]}` as never)}</Text>
          </Box>
          <Text size="T200">
            <Trans
              i18nKey={`${KEY}.${NOTE_BY[note.kind]}` as const}
              values={{ name: note.senderName }}
              components={BOLD}
              tOptions={ESCAPED}
              shouldUnescape
            />
          </Text>
          <Text size="T200">
            {note.reason ? (
              <Trans
                i18nKey={`${KEY}.reason`}
                values={{ reason: revealDirectionControls(note.reason) }}
                components={BOLD}
                tOptions={ESCAPED}
                shouldUnescape
              />
            ) : (
              t(`${KEY}.noReasonProvided`)
            )}
          </Text>
          {noteAction && <Box>{noteAction}</Box>}
        </Box>
      )}
      {actions.length > 0 && !asking && (
        <Box direction="Column" gap="100">
          <Text size="L400">{t(`${KEY}.moderation`)}</Text>
          <Box gap="200" wrap="Wrap">
            {actions}
          </Box>
        </Box>
      )}
      {asking && (
        <Box as="form" direction="Column" gap="200" onSubmit={submit}>
          <Text size="L400">{t(`${KEY}.${asking}`)}</Text>
          <Input
            autoFocus
            aria-label={t('sharedUi.inviteUserPrompt.reasonOptional')}
            placeholder={t('sharedUi.inviteUserPrompt.reasonOptional')}
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value)}
            variant="Background"
            size="300"
            radii="300"
            disabled={busy !== undefined}
          />
          <Box gap="200">
            <Button
              type="submit"
              size="300"
              radii="300"
              variant="Critical"
              disabled={busy !== undefined}
              before={busy ? <Spinner size="50" variant="Critical" fill="Solid" /> : undefined}
            >
              <Text size="B300">{t(`${KEY}.${asking}`)}</Text>
            </Button>
            <Button
              type="button"
              size="300"
              radii="300"
              variant="Secondary"
              fill="Soft"
              disabled={busy !== undefined}
              onClick={() => setAsking(undefined)}
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
    </Box>
  );
}
