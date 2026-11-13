import { useId, useMemo, useState } from 'react';
import {
  Avatar,
  Badge,
  Box,
  Button,
  Icon,
  Icons,
  Spinner,
  Text,
  color,
  config,
  toRem,
} from 'folds';
import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import { Link, useNavigate } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { SequenceCard } from '../../ui/SequenceCard';
import { ownDirectionLine, revealDirectionControls } from '../../ui/directional';
import { RoomAvatar } from '../../avatars/RoomAvatar';
import { Page, PageContent, PageContentCenter, PageHeader } from '../../ui/page/Page';
import { PageScroll } from '../../ui/page/PageScroll';
import { PhoneBackButton } from '../../ui/page/PhoneBackButton';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { useRoomNavigate } from '../../navigation/useRoomNavigate';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { allInvitesAtom } from '../../matrix/state/inviteList';
import { useSetting } from '../../preferences/useSetting';
import { settingsAtom } from '../../preferences/settings';
import { useHour24Clock } from '../../preferences/useHour24Clock';
import { localDigits } from '../../lib/localDigits';
import { timeHourMinute } from '../../lib/time';
import { glassOutline, glassSurface } from '../../ui/styles/Glass.css';
import { getRoomAvatarUrl } from '../../matrix/room';
import { mxcUrlToHttp } from '../../matrix/mediaUrl';
import { nameInitials } from '../../lib/common';
import { acceptInvite, acceptInvites } from './acceptInvite';
import { declineInvite } from './declineInvite';
import {
  INVITE_CATEGORIES,
  INVITE_CATEGORY_LABEL_KEYS,
  InviteFilterChips,
  categorizeInvite,
  type InviteCategory,
} from './inviteFilter';
import { ACTIVITY_PATH } from '../../routes/paths';
import { getActivityPath, getDirectRoomPath } from '../../routes/pathUtils';

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

/** The invited room itself. */
type InvitedRoom = { room: Room; roomId: string; isSpace: boolean };

/**
 * How the room presents itself in the stripped state that came with the invite: its name (else
 * its alias, else its ID), the `mxc://` avatar URL, and its topic.
 */
type InvitedRoomListing = { roomName: string; roomAvatar?: string; roomTopic?: string };

/** Who invited, and when. */
type InviteOrigin = {
  /** The inviter's user ID. */
  senderId?: string;
  /** The inviter's display name as they set it, for checks. */
  senderDisplayName?: string;
  /** What the card shows: the isolated, shortened name next to the real ID. */
  senderName?: string;
  inviteTs?: number;
};

/** What kind of room it is: a direct chat, encrypted, open to anyone. */
type InviteTraits = {
  /** The inviter marked the invite `is_direct`. */
  isDirect: boolean;
  isEncrypted: boolean;
  isPublic: boolean;
  /** The inviter's `mxc://` avatar, which a direct chat shows as its own. */
  senderAvatar?: string;
};

/** One pending invite, read from the stripped state the server sent with it. */
type InviteData = InvitedRoom & InvitedRoomListing & InviteOrigin & InviteTraits;

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
    ? senderMember?.events.member?.getContent().displayname
    : undefined;
  const topic = room.currentState.getStateEvents('m.room.topic', '')?.getContent().topic;
  const state = (type: string) => room.currentState.getStateEvents(type, '')?.getContent();
  const avatar = senderMember?.events.member?.getContent().avatar_url;

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
    isDirect: inviteEvent?.getContent().is_direct === true,
    isEncrypted: Boolean(state('m.room.encryption')?.algorithm),
    isPublic: state('m.room.join_rules')?.join_rule === 'public',
    senderAvatar: typeof avatar === 'string' && avatar ? avatar : undefined,
  };
};

/** Each label's quiet tint: the person and the lock stand out a little, the rest stays grey. */
type InviteLabel = { text: string; tint: 'Primary' | 'Secondary' | 'Success' };

/** The small chips over an invite's name: encrypted, direct chat or space, public. */
function InviteBadges({ invite }: { invite: InviteData }) {
  const { t } = useTranslation();
  const labels: InviteLabel[] = [];
  if (invite.isEncrypted) labels.push({ text: t('sharedUi.invites.encrypted'), tint: 'Success' });
  if (invite.isDirect) labels.push({ text: t('sharedUi.invites.directMessage'), tint: 'Primary' });
  if (invite.isSpace) labels.push({ text: t('sharedUi.invites.space'), tint: 'Secondary' });
  if (invite.isPublic) labels.push({ text: t('sharedUi.invites.public'), tint: 'Secondary' });
  if (labels.length === 0) return null;
  return (
    <Box gap="100" wrap="Wrap" data-invite-badges="">
      {labels.map(({ text, tint }) => (
        <Badge key={text} variant={tint} fill="Soft" radii="300" size="400">
          <Text as="span" size="L400">
            {text}
          </Text>
        </Badge>
      ))}
    </Box>
  );
}

/** Whether the invite's room or inviter uses words of spam invites (whole words, full names). */
export const hasBadWords = (invite: InviteData): boolean =>
  [invite.roomName, invite.roomTopic, invite.senderDisplayName].some(
    (text) => !!text && BAD_WORDS_REGEX.test(text)
  );

/** The user's time and date format settings, for when the invite arrived. */
type InviteTimeFormat = { hour24Clock: boolean; dateFormatString: string };

const useInviteTimeFormat = (): InviteTimeFormat => {
  const [dateFormatString] = useSetting(settingsAtom, 'dateFormatString');
  const [hour24Clock] = useHour24Clock();
  return { dateFormatString, hour24Clock };
};

// Decline and Accept All: quiet glass controls with a hairline, so Accept is the one tinted button.
const QUIET_BUTTON = classNames(
  glassSurface({ level: 'control', variant: 'Surface' }),
  glassOutline
);
const CARD_STYLE = { padding: config.space.S400 } as const;
// The picture and name keep at least 16rem; narrower than that and the buttons, the card's
// trailing column, wrap onto a line of their own at its end.
const IDENTITY_STYLE = { flex: `1 1 ${toRem(256)}`, minWidth: 0 } as const;
const ACTIONS_STYLE = { marginInlineStart: 'auto' } as const;
const NAME_STYLE = { fontWeight: config.fontWeight.W500 } as const;
const SENDER_STYLE = { fontWeight: config.fontWeight.W500 } as const;
// Escaped, the inviter's `<` stays text instead of reading as a tag, such as one that adds
// attributes to the bold name it fills.
const ESCAPED = { interpolation: { escapeValue: true } };

type InviteCardProps = InviteTimeFormat & {
  invite: InviteData;
  onNavigate: (roomId: string, isSpace: boolean, isDirect?: boolean) => void;
  hideAvatar: boolean;
  /** Whether media needs an access token (authenticated media). */
  useAuthentication?: boolean;
};

export function InviteCard({
  invite,
  onNavigate,
  dateFormatString,
  hour24Clock,
  hideAvatar,
  useAuthentication = false,
}: InviteCardProps) {
  const { t, i18n } = useTranslation();
  const client = useMatrixClient();
  const { room, roomId, roomName, roomTopic, isSpace } = invite;
  const [state, setState] = useState<'idle' | 'joining' | 'leaving' | 'error'>('idle');
  const nameId = useId();
  // A direct chat has no picture of its own; it shows the person who started it.
  const directAvatar =
    invite.isDirect && invite.senderAvatar
      ? mxcUrlToHttp(client, invite.senderAvatar, useAuthentication, 96, 96, 'crop') ?? undefined
      : undefined;
  const avatar = hideAvatar
    ? undefined
    : directAvatar ?? getRoomAvatarUrl(client, room, 96, useAuthentication);

  const handleAccept = async () => {
    setState('joining');
    try {
      await acceptInvite(client, room);
      onNavigate(roomId, isSpace, invite.isDirect);
    } catch {
      setState('error');
    }
  };

  const handleDecline = async () => {
    setState('leaving');
    try {
      await declineInvite(client, roomId);
    } catch {
      setState('error');
    }
  };

  const busy = state === 'joining' || state === 'leaving';
  // The date in the user's format, the time and its day period as the language writes them.
  const time = invite.inviteTs
    ? [
        localDigits(dayjs(invite.inviteTs).format(dateFormatString), i18n.language),
        timeHourMinute(invite.inviteTs, hour24Clock, i18n.language),
      ].join(' ')
    : undefined;

  return (
    <SequenceCard
      direction="Column"
      gap="300"
      variant="SurfaceVariant"
      role="group"
      aria-labelledby={nameId}
      data-invite-room-id={roomId}
      style={CARD_STYLE}
    >
      <Box alignItems="Center" gap="300" wrap="Wrap">
        <Box alignItems="Center" gap="300" style={IDENTITY_STYLE}>
          <Avatar size="300" radii={isSpace ? '300' : 'Pill'}>
            <RoomAvatar
              src={avatar}
              roomId={roomId}
              fallbackId={invite.isDirect ? invite.senderId : undefined}
              alt={roomName}
              renderFallback={() => <Text size="H6">{nameInitials(roomName)}</Text>}
            />
          </Avatar>
          <Box grow="Yes" direction="Column" gap="100" style={{ minWidth: 0 }}>
            <InviteBadges invite={invite} />
            <Box direction="Column">
              <Text
                as="h3"
                id={nameId}
                size="T400"
                truncate
                style={NAME_STYLE}
                {...ownDirectionLine}
              >
                {revealDirectionControls(roomName)}
              </Text>
              {roomTopic ? (
                <Text size="T200" priority="300" truncate {...ownDirectionLine}>
                  {revealDirectionControls(roomTopic)}
                </Text>
              ) : null}
            </Box>
          </Box>
        </Box>
        <Box gap="200" shrink="No" style={ACTIONS_STYLE}>
          <Button
            size="300"
            variant="Secondary"
            fill="Soft"
            className={QUIET_BUTTON}
            radii="300"
            disabled={busy}
            aria-describedby={nameId}
            onClick={() => void handleDecline()}
            before={state === 'leaving' ? <Spinner size="100" variant="Secondary" /> : undefined}
          >
            <Text size="B300">{t('sharedUi.invites.decline')}</Text>
          </Button>
          <Button
            size="300"
            variant="Success"
            fill="Soft"
            outlined
            radii="300"
            disabled={busy}
            aria-describedby={nameId}
            onClick={() => void handleAccept()}
            before={state === 'joining' ? <Spinner size="100" variant="Success" /> : undefined}
          >
            <Text size="B300">{t('sharedUi.invites.accept')}</Text>
          </Button>
        </Box>
      </Box>
      {(invite.senderName || time) && (
        <Box alignItems="Baseline" justifyContent="SpaceBetween" gap="200" wrap="Wrap">
          {invite.senderName ? (
            <Text size="T200" priority="300" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
              <Trans
                i18nKey="sharedUi.invites.from"
                values={{ sender: invite.senderName }}
                components={{ b: <b title={invite.senderId} style={SENDER_STYLE} /> }}
                tOptions={ESCAPED}
                shouldUnescape
              />
            </Text>
          ) : null}
          {time && (
            <Text size="T200" priority="300" style={{ flexShrink: 0 }}>
              {time}
            </Text>
          )}
        </Box>
      )}
      {state === 'error' && (
        <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
          {t('sharedUi.invites.actionFailed')}
        </Text>
      )}
    </SequenceCard>
  );
}

// The heading keeps the height of the Accept All button beside it, so the cards stay put when the
// button comes and goes.
const SECTION_HEADER_STYLE = { minHeight: toRem(32) } as const;

// With no invite waiting the empty page leads on to Activity: a button as wide as its label,
// under the hint. It is a link, drawn without the underline links get.
const EMPTY_LINK_STYLE = {
  alignSelf: 'flex-start',
  marginBlockStart: config.space.S200,
  textDecoration: 'none',
} as const;

/** What an empty list holds once invites arrive. */
const EMPTY_HINT_KEYS = {
  primary: 'sharedUi.invites.whenSomeoneYouShareARoomWithSendsYouAnInviteIt',
  public: 'sharedUi.invites.invitesFromPeopleOutsideYourRoomsWillAppearHere',
  spam: 'sharedUi.invites.invitesDetectedAsSpamAppearHere',
} as const;

/**
 * Pending invites, in three lists: from people the user knows, from anyone else, and spam. A spam
 * invite shows no avatar and is never in Accept All.
 */
export function Invites() {
  const client = useMatrixClient();
  const { t } = useTranslation();
  const useAuthentication = useMediaAuthentication();
  const timeFormat = useInviteTimeFormat();
  const pendingRoomIds = useAtomValue(allInvitesAtom);
  const { navigateSpace, navigateRoom } = useRoomNavigate();
  const navigate = useNavigate();
  const [acceptingAll, setAcceptingAll] = useState(false);
  const headingId = useId();
  // Phones lead with the way back to Activity, so the title starts beside it.
  const phone = useScreenSizeContext() === ScreenSize.Mobile;

  const invites = useMemo(
    () =>
      pendingRoomIds
        .map((roomId) => client.getRoom(roomId))
        .filter((room): room is Room => !!room)
        .map((room) => makeInviteData(client, room, room.isSpaceRoom())),
    [client, pendingRoomIds]
  );

  const [pickedCategory, setPickedCategory] = useState<InviteCategory>();
  const categories = useMemo(
    () => invites.map((invite) => categorizeInvite(client, invite, hasBadWords(invite))),
    [client, invites]
  );
  const counts = useMemo(() => {
    const tally: Record<InviteCategory, number> = { primary: 0, public: 0, spam: 0 };
    categories.forEach((category) => {
      tally[category] += 1;
    });
    return tally;
  }, [categories]);
  // Until the user picks a list, the first one holding invites is shown.
  const category =
    pickedCategory ?? INVITE_CATEGORIES.find((candidate) => counts[candidate] > 0) ?? 'primary';
  const shownInvites = invites.filter((_, index) => categories[index] === category);

  // A direct chat opens under Direct Messages before sync reports the m.direct entry for it.
  const handleNavigate = (roomId: string, isSpace: boolean, isDirect?: boolean) => {
    if (isSpace) navigateSpace(roomId);
    else if (isDirect) navigate(getDirectRoomPath(roomId));
    else navigateRoom(roomId);
  };

  const handleAcceptAll = async () => {
    setAcceptingAll(true);
    try {
      await acceptInvites(
        client,
        shownInvites.filter((invite) => !hasBadWords(invite)).map((invite) => invite.room)
      );
    } finally {
      setAcceptingAll(false);
    }
  };

  const acceptAllShown = category !== 'spam' && shownInvites.length > 1;
  const header = (
    <PageHeader balance>
      <PhoneBackButton to={ACTIVITY_PATH} />
      <Box grow="Yes" justifyContent={phone ? 'Start' : 'Center'} alignItems="Center" gap="200">
        <Icon size="400" src={Icons.Mail} />
        <Text as="h1" size="H4" truncate>
          {t('sharedUi.invites.invites')}
        </Text>
      </Box>
    </PageHeader>
  );

  return (
    <Page>
      <PageScroll header={header}>
        <PageContent>
          <PageContentCenter>
            <Box direction="Column" gap="500">
              <InviteFilterChips counts={counts} selected={category} onSelect={setPickedCategory} />
              <Box as="section" direction="Column" gap="300" aria-labelledby={headingId}>
                <Box alignItems="Center" gap="200" style={SECTION_HEADER_STYLE}>
                  <Text as="h2" id={headingId} size="H5" truncate style={{ flexGrow: 1 }}>
                    {t(INVITE_CATEGORY_LABEL_KEYS[category])}
                  </Text>
                  {acceptAllShown && (
                    <Button
                      size="300"
                      radii="300"
                      variant="Secondary"
                      fill="Soft"
                      className={QUIET_BUTTON}
                      disabled={acceptingAll}
                      onClick={() => void handleAcceptAll()}
                      before={acceptingAll ? <Spinner size="100" variant="Secondary" /> : undefined}
                    >
                      <Text size="B300">{t('sharedUi.invites.acceptAll')}</Text>
                    </Button>
                  )}
                </Box>
                {shownInvites.length === 0 ? (
                  <Box direction="Column" gap="100">
                    <Text size="T400">
                      {category === 'spam'
                        ? t('sharedUi.invites.noSpamInvites')
                        : t('sharedUi.invites.noInvites')}
                    </Text>
                    <Text size="T300" priority="300">
                      {t(EMPTY_HINT_KEYS[category])}
                    </Text>
                    {invites.length === 0 && (
                      <Button
                        as={Link}
                        to={getActivityPath()}
                        size="300"
                        radii="300"
                        variant="Secondary"
                        fill="Soft"
                        className={QUIET_BUTTON}
                        before={<Icon size="100" src={Icons.Bell} />}
                        style={EMPTY_LINK_STYLE}
                      >
                        <Text size="B300">{t('activity.openActivity')}</Text>
                      </Button>
                    )}
                  </Box>
                ) : (
                  <Box direction="Column">
                    {shownInvites.map((invite) => (
                      <InviteCard
                        {...timeFormat}
                        key={invite.roomId}
                        invite={invite}
                        onNavigate={handleNavigate}
                        hideAvatar={hasBadWords(invite)}
                        useAuthentication={useAuthentication}
                      />
                    ))}
                  </Box>
                )}
              </Box>
            </Box>
          </PageContentCenter>
        </PageContent>
      </PageScroll>
    </Page>
  );
}
