import React, { useMemo, useState } from 'react';
import { Avatar, Box, Button, Icon, Icons, Spinner, Text, color, config } from 'folds';
import { useAtomValue } from 'jotai';
import { Trans, useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { SequenceCard } from '../../../components/sequence-card';
import { RoomAvatar } from '../../../components/room-avatar';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { useRoomNavigate } from '../../../hooks/useRoomNavigate';
import { allInvitesAtom } from '../../../state/room-list/inviteList';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import { getRoomAvatarUrl } from '../../../utils/room';
import { acceptInvite, acceptInvites } from './acceptInvite';

const FSI = '\u2068';
const LRI = '\u2066';
const PDI = '\u2069';
const MAX_SENDER_NAME_LENGTH = 64;

/** Bidi embeddings, overrides and isolates in a name would reorder the real ID beside it. */
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/g;
/** Line and paragraph separators would end the isolates around the name. */
// eslint-disable-next-line no-control-regex
const LINE_SEPARATORS = /[\n\r\u000B\u000C\u0085\u2028\u2029]/g;

/** Words a spam invite uses; matched as whole words so that "Andersson" stays clean. */
const BAD_WORDS = [
  'fuck',
  'shit',
  'cunt',
  'nigger',
  'faggot',
  'porn',
  'nsfw',
  'xxx',
  'whore',
  'slut',
];
const BAD_WORDS_REGEX = new RegExp(
  `(^|[^\\p{L}\\p{N}])(${BAD_WORDS.join('|')})(?=$|[^\\p{L}\\p{N}])`,
  'iu'
);








  senderId?: string;
  /** The inviter's display name as they set it, for checks. */
  senderDisplayName?: string;
  /** What the card shows: the isolated, shortened name next to the real ID. */
  senderName?: string;
  inviteTs?: number;
};

const cleanName = (name: string): string =>
  name.replace(BIDI_CONTROLS, '').replace(LINE_SEPARATORS, '');

const shortenName = (name: string): string =>
  name.length > MAX_SENDER_NAME_LENGTH ? `${name.slice(0, MAX_SENDER_NAME_LENGTH)}…` : name;

const senderLabel = (senderId: string, displayName: string | undefined): string => {
  if (!displayName || displayName === senderId) return senderId;
  return `${FSI}${shortenName(cleanName(displayName))}${PDI} (${LRI}${senderId}${PDI})`;
};

/** Builds what an invite card shows from the stripped state of the invited room. */
export const makeInviteData = (mx: MatrixClient, room: Room, isSpace: boolean): InviteData => {
  const myUserId = mx.getUserId() ?? '';
  const inviteEvent = room.getMember(myUserId)?.events.member;
  const senderId = inviteEvent?.getSender();
  const senderMember = senderId ? room.currentState.getMember(senderId) : undefined;
  const rawDisplayName = senderId
    ? (senderMember?.events.member?.getContent().displayname as string | undefined)
    : undefined;
  const topic = room.currentState.getStateEvents('m.room.topic', '')?.getContent().topic;

  return {
    room,
    roomId: room.roomId,
    roomName: room.name || room.getCanonicalAlias() || room.roomId,
    roomAvatar: room.getMxcAvatarUrl() ?? undefined,
    roomTopic: typeof topic === 'string' ? topic : undefined,
    isSpace,
    senderId,
    senderDisplayName: typeof rawDisplayName === 'string' ? rawDisplayName : undefined,
    senderName: senderId ? senderLabel(senderId, rawDisplayName) : undefined,
    inviteTs: inviteEvent?.getTs(),
  };
};

/** Whether the invite's room or inviter uses words of spam invites (whole words, full names). */
export const hasBadWords = (invite: InviteData): boolean =>
  [invite.roomName, invite.roomTopic, invite.senderDisplayName].some(
    (text) => !!text && BAD_WORDS_REGEX.test(text)
  );





  onNavigate: (roomId: string, isSpace: boolean) => void;
  hideAvatar: boolean;
  /** Whether media needs an access token (authenticated media). */
  useAuthentication?: boolean;
};

export function InviteCard({
  invite,




  useAuthentication = false,



  const [state, setState] = useState<'idle' | 'joining' | 'leaving' | 'error'>('idle');
  const avatarUrl = hideAvatar
    ? undefined
    : getRoomAvatarUrl(mx, invite.room, 96, useAuthentication);

  const handleAccept = async () => {
    setState('joining');
    try {
      await acceptInvite(mx, invite.room);
      onNavigate(invite.roomId, invite.isSpace);
    } catch {
      setState('error');
    }
  };

  const handleDecline = async () => {
    setState('leaving');
    try {
      await mx.leave(invite.roomId);
    } catch {
      setState('error');
    }
  };

  const busy = state === 'joining' || state === 'leaving';
  const time = invite.inviteTs
    ? dayjs(invite.inviteTs).format(`${dateFormatString} ${hour24Clock ? 'HH:mm' : 'hh:mm A'}`)
















              <Icon size="200" src={invite.isSpace ? Icons.Space : Icons.Hash} />
            )}
          />
        </Avatar>
        <Box grow="Yes" direction="Column" style={{ minWidth: 0 }}>
          <Text size="T400" truncate>
            {invite.roomName}
          </Text>
          {invite.roomTopic && (
            <Text size="T200" priority="300" truncate>
              {invite.roomTopic}
            </Text>
          )}
        </Box>
        {time && (
          <Text size="T200" priority="300">
            {time}
          </Text>
        )}
      </Box>
      {invite.senderName && (
        <Text size="T200">
          <Trans
            i18nKey="sharedUi.invites.from"
            values={{ sender: invite.senderName }}
            components={{ b: <b title={invite.senderId} /> }}
          />
        </Text>
      )}
      {state === 'error' && (
        <Text size="T200" style={{ color: color.Critical.Main }}>
          {t('sharedUi.invites.actionFailed')}
        </Text>
      )}
      <Box gap="200">
        <Button
          size="300"
          variant="Success"
          fill="Soft"
          radii="300"
          disabled={busy}
          onClick={handleAccept}
          before={state === 'joining' ? <Spinner size="100" variant="Success" /> : undefined}
        >
          <Text size="B300">{t('sharedUi.invites.accept')}</Text>
        </Button>
        <Button
          size="300"
          variant="Critical"
          fill="None"
          radii="300"
          disabled={busy}
          onClick={handleDecline}
          before={state === 'leaving' ? <Spinner size="100" variant="Critical" /> : undefined}
        >
          <Text size="B300">{t('sharedUi.invites.decline')}</Text>
        </Button>
      </Box>
    </SequenceCard>
  );
}

/** Pending invites; suspicious ones collapse behind their own heading. */




  const inviteIds = useAtomValue(allInvitesAtom);



  const [acceptingAll, setAcceptingAll] = useState(false);

  const invites = useMemo(
    () =>
      inviteIds
        .map((roomId) => mx.getRoom(roomId))
        .filter((room): room is Room => !!room)
        .map((room) => makeInviteData(mx, room, room.isSpaceRoom())),
    [mx, inviteIds]
  );

  const handleNavigate = (roomId: string, isSpace: boolean) =>
    isSpace ? navigateSpace(roomId) : navigateRoom(roomId);

  const handleAcceptAll = async () => {
    setAcceptingAll(true);
    try {
      await acceptInvites(
        mx,
        invites.filter((invite) => !hasBadWords(invite)).map((invite) => invite.room)
      );
    } finally {
      setAcceptingAll(false);
    }
  };

  return (
    <Box direction="Column" gap="400" style={{ padding: config.space.S400 }}>
      <Box alignItems="Center" justifyContent="SpaceBetween" gap="200">
        <Text size="H4">{t('sharedUi.invites.invites')}</Text>
        {invites.length > 1 && (
          <Button
            size="300"
            radii="300"
            variant="Success"
            fill="Soft"
            disabled={acceptingAll}
            onClick={handleAcceptAll}
          >
            <Text size="B300">{t('sharedUi.invites.acceptAll')}</Text>
          </Button>
        )}
      </Box>
      {invites.length === 0 && <Text size="T300">{t('sharedUi.invites.noInvites')}</Text>}







          hideAvatar={hasBadWords(invite)}
          useAuthentication={useAuthentication}
        />
      ))}
    </Box>
  );
}
