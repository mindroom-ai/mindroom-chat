import { type ReactNode, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EventType, type MatrixClient, type Room, type RoomMember } from 'matrix-js-sdk';
import type { Opts as LinkifyOpts } from 'linkifyjs';
import { Avatar, Icon, Icons, Text } from 'folds';
import { UserAvatar } from '../../avatars/UserAvatar';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useRoomMembers } from '../../matrix/hooks/useRoomMembers';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { getMemberAvatarMxc, getMemberDisplayName } from '../../matrix/room';
import { getMxIdLocalPart } from '../../matrix/matrix';
import {
  isMindroomAgentUserId,
  isMindroomAgentUserIdForViewer,
} from '../../matrix/protocol/agentIdentity';
import { mxcUrlToHttp } from '../../matrix/mediaUrl';
import {
  callTranscriptSpeakersTrusted,
  clipTurnText,
  groupCallTranscriptTurns,
  speakerMemberships,
  type CallTranscript,
  type CallTranscriptGroup,
} from '../../matrix/protocol/callTranscript';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import { formatCallDuration, formatCallOffset } from '../../lib/time';
import { nameInitials } from '../../lib/common';
import { ownDirectionLine, textDirection } from '../../ui/directional';
import { LoneTouchTarget } from '../../ui/styles/TouchTarget.css';
import { renderTextWithLatex } from '../html/react-custom-html-parser';
import * as css from './CallTranscriptCard.css';

type CallTranscriptCardProps = {
  transcript: CallTranscript;
  /** Who posted the message: the agent whose call it was. */
  sender: string | undefined;
  /** The room whose members name the speakers. */
  roomId?: string;
  /**
   * The message as it renders without the card, shown while the transcript names a speaker the
   * card may not (`callTranscriptSpeakersTrusted`). For a call between people it is the call's
   * notes, which the card shows as its text.
   */
  fallback: ReactNode;
  /** A search's matches: they are marked, and a transcript with one starts open. */
  highlightRegex?: RegExp;
  linkifyOpts: LinkifyOpts;
};

const NOBODY: ReadonlySet<string> = new Set();

/**
 * Speakers of a call between people whom the room's members leave out (lazy loading skips who
 * left), as the room's state on the server has them: those who were in the room, and joined, left
 * or were banned since. Asked only for a transcript MindRoom's agent posted.
 */
const useSpeakersFromServer = (
  client: MatrixClient,
  transcript: CallTranscript,
  sender: string | undefined,
  roomId: string | undefined,
  members: RoomMember[]
): ReadonlySet<string> => {
  const [found, setFound] = useState(NOBODY);
  const unlisted = useMemo(() => {
    const posted = isMindroomAgentUserIdForViewer(sender, client.getUserId() ?? undefined);
    if (transcript.callId === undefined || !posted) return '';
    const listed = new Set(members.map((member) => member.userId));
    const speakers = new Set(transcript.turns.map((turn) => turn.sender));
    return [...speakers]
      .filter((userId) => !listed.has(userId) && !isMindroomAgentUserId(userId))
      .join(' ');
  }, [client, members, sender, transcript]);
  useEffect(() => {
    if (!roomId || !unlisted) return undefined;
    let current = true;
    const counted = speakerMemberships(transcript);
    const asked = unlisted.split(' ').map((userId) =>
      client.getStateEvent(roomId, EventType.RoomMember, userId).then(
        (content) => (counted.has(String(content.membership)) ? [userId] : []),
        () => []
      )
    );
    void Promise.all(asked).then((answers) => {
      if (current) setFound(new Set(answers.flat()));
    });
    return () => {
      current = false;
    };
  }, [client, roomId, transcript, unlisted]);
  return found;
};

const matchesAny = (regex: RegExp, texts: readonly string[]): boolean => {
  const once = new RegExp(regex.source, regex.flags.replace('g', ''));
  return texts.some((text) => once.test(text));
};

type TurnTextProps = {
  text: string;
  highlightRegex?: RegExp;
  linkifyOpts: LinkifyOpts;
};

/**
 * One turn's words, in their own direction. A long turn (a speaker's words merge into one) shows
 * its start, then a button for the rest; it starts whole when a search matched it.
 */
function TurnText({ text, highlightRegex, linkifyOpts }: TurnTextProps) {
  const { t } = useTranslation();
  const textId = useId();
  const preview = useMemo(() => clipTurnText(text), [text]);
  const [whole, setWhole] = useState(
    () => !!highlightRegex && preview.clipped && matchesAny(highlightRegex, [text])
  );
  const shown = whole || !preview.clipped ? text : preview.text;
  return (
    <>
      <Text
        id={textId}
        as="p"
        size="T300"
        className={css.Text}
        data-call-transcript-text=""
        dir={textDirection(text) ?? 'auto'}
      >
        {renderTextWithLatex(shown, { linkify: true, linkifyOpts, highlightRegex })}
      </Text>
      {preview.clipped && (
        <button
          type="button"
          className={`${css.More} ${LoneTouchTarget}`}
          aria-expanded={whole}
          aria-controls={textId}
          data-call-transcript-more=""
          onClick={() => setWhole((open) => !open)}
        >
          {whole ? t('mindroomUi.notices.showLess') : t('mindroomUi.notices.showMore')}
        </button>
      )}
    </>
  );
}

type GroupProps = {
  group: CallTranscriptGroup;
  room: Room | null;
  highlightRegex?: RegExp;
  linkifyOpts: LinkifyOpts;
};

/**
 * One speaker's run of turns: their avatar and name as the room knows them, beside it when they
 * began to speak in the call (when the transcript says), then the text.
 */
function TranscriptGroup({ group, room, highlightRegex, linkifyOpts }: GroupProps) {
  const client = useMatrixClient();
  const authenticatedMedia = useMediaAuthentication();
  const { sender, texts, offsetSeconds } = group;
  const name = (room && getMemberDisplayName(room, sender)) ?? getMxIdLocalPart(sender) ?? sender;
  const avatarMxc = room ? getMemberAvatarMxc(room, sender) : undefined;
  const avatarSrc = avatarMxc
    ? mxcUrlToHttp(client, avatarMxc, authenticatedMedia, 48, 48, 'crop') ?? undefined
    : undefined;

  return (
    <li className={css.Group} data-call-transcript-group="" data-user-id={sender}>
      {/* The name follows; the avatar only decorates the group. */}
      <Avatar
        className={css.Avatar}
        size="200"
        radii="Pill"
        aria-hidden
        data-call-transcript-avatar=""
      >
        <UserAvatar
          alt=""
          userId={sender}
          src={avatarSrc}
          renderFallback={() => (
            <Text as="span" size="L400">
              {nameInitials(name)}
            </Text>
          )}
        />
      </Avatar>
      <div className={css.GroupBody}>
        <div className={css.NameLine}>
          <Text
            as="span"
            size="T300"
            truncate
            className={css.Name}
            data-call-transcript-name=""
            {...ownDirectionLine}
          >
            {name}
          </Text>
          {offsetSeconds !== undefined && (
            <Text
              as="span"
              size="T200"
              priority="300"
              className={css.Time}
              data-call-transcript-time=""
            >
              <time dateTime={`PT${offsetSeconds}S`}>{formatCallOffset(offsetSeconds)}</time>
            </Text>
          )}
        </div>
        {texts.map((text, index) => (
          <TurnText
            // Turns never move within a group, so their place is their identity.
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            text={text}
            highlightRegex={highlightRegex}
            linkifyOpts={linkifyOpts}
          />
        ))}
      </div>
    </li>
  );
}

/**
 * A finished voice call (`io.mindroom.call_transcript`) on one row: the phone icon, "Voice call"
 * and how long it lasted, then at the row's end the transcript's button, which says how many
 * turns it holds. Open, the transcript reads like a chat below the row: each run of turns by one
 * speaker under their avatar and name. A call between people says "Call", with its notes (the
 * message's body) between the row and the transcript, and past the card's limits a line under its
 * first turns says how many more there are.
 */
export function CallTranscriptCard({
  transcript,
  sender,
  roomId,
  fallback,
  highlightRegex,
  linkifyOpts,
}: CallTranscriptCardProps) {
  const { t, i18n } = useTranslation();
  const language = useAppLanguageCode();
  const client = useMatrixClient();
  const headerId = useId();
  const turnsId = useId();
  const toggleLabelId = useId();
  const toggleCountId = useId();
  const { durationSeconds, turns, callId, summaryOnly, moreTurns } = transcript;
  // A call between people: the message's body is its notes, not the transcript again; without a
  // notes model it is only the summary the row already gives.
  const peopleCall = callId !== undefined;
  const withNotes = peopleCall && !summaryOnly;
  const [open, setOpen] = useState(
    () =>
      !!highlightRegex &&
      matchesAny(
        highlightRegex,
        turns.map((turn) => turn.text)
      )
  );
  const groups = useMemo(() => groupCallTranscriptTurns(turns), [turns]);
  const room = roomId ? client.getRoom(roomId) : null;
  // The room's members load in the background; a speaker who joins them later is trusted then.
  const members = useRoomMembers(client, roomId ?? '');
  const fromServer = useSpeakersFromServer(client, transcript, sender, roomId, members);
  const trusted = useMemo(() => {
    const counted = speakerMemberships(transcript);
    const speakers = new Set(
      members
        .filter(({ membership }) => membership !== undefined && counted.has(membership))
        .map((member) => member.userId)
    );
    return callTranscriptSpeakersTrusted(
      transcript,
      sender,
      client.getUserId() ?? undefined,
      (userId) => speakers.has(userId) || fromServer.has(userId)
    );
  }, [client, fromServer, members, sender, transcript]);
  if (!trusted) return <>{fallback}</>;

  return (
    // The card is the interface's, so it keeps the interface's direction inside a message body
    // that reads the other way (a long transcript renders inside its preview's text).
    <div
      className={css.CallCard}
      role="group"
      aria-labelledby={headerId}
      dir={i18n.dir()}
      data-call-transcript=""
    >
      <div className={css.Row}>
        <div id={headerId} className={css.Header} data-call-transcript-header="">
          <span className={css.IconSlot}>
            <Icon size="100" src={Icons.Phone} aria-hidden />
          </span>
          <Text as="span" size="T300" className={`${css.Label} ${css.Title}`}>
            {peopleCall
              ? t('featureUi.calls.transcript.callTitle')
              : t('featureUi.calls.transcript.title')}
          </Text>
          <Text as="span" size="T300" priority="300" className={css.Label}>
            {formatCallDuration(durationSeconds, language)}
          </Text>
        </div>
        {/* Named "Transcript, N turns"; only the count shows, beside the call it belongs to. */}
        <button
          type="button"
          className={`${css.Toggle} ${LoneTouchTarget}`}
          aria-expanded={open}
          aria-controls={turnsId}
          aria-labelledby={`${toggleLabelId} ${toggleCountId}`}
          onClick={() => setOpen((shown) => !shown)}
        >
          <span id={toggleLabelId} hidden>
            {t('featureUi.calls.transcript.transcript')}
          </span>
          <Text as="span" size="T300" id={toggleCountId} className={css.Label}>
            {t('featureUi.calls.transcript.turns', { count: turns.length + (moreTurns ?? 0) })}
          </Text>
          <span className={css.IconSlot}>
            <Icon size="50" src={open ? Icons.ChevronTop : Icons.ChevronBottom} aria-hidden />
          </span>
        </button>
      </div>
      {withNotes && (
        <div className={css.Notes} data-call-transcript-notes="">
          {fallback}
        </div>
      )}
      {open && (
        <ol id={turnsId} className={css.Turns}>
          {groups.map((group) => (
            <TranscriptGroup
              key={group.index}
              group={group}
              room={room}
              highlightRegex={highlightRegex}
              linkifyOpts={linkifyOpts}
            />
          ))}
        </ol>
      )}
      {open && moreTurns !== undefined && (
        <Text as="p" size="T200" priority="300" data-call-transcript-more-turns="">
          {t('featureUi.calls.transcript.moreTurns', { count: moreTurns })}
        </Text>
      )}
    </div>
  );
}
