import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import type { Opts as LinkifyOpts } from 'linkifyjs';
import { Avatar, Icon, Icons, Text } from 'folds';
import { UserAvatar } from '../../avatars/UserAvatar';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { getMemberAvatarMxc, getMemberDisplayName } from '../../matrix/room';
import { getMxIdLocalPart } from '../../matrix/matrix';
import { mxcUrlToHttp } from '../../matrix/mediaUrl';
import {
  groupCallTranscriptTurns,
  type CallTranscript,
  type CallTranscriptGroup,
} from '../../matrix/protocol/callTranscript';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import { formatCallDuration } from '../../lib/time';
import { nameInitials } from '../../lib/common';
import { ownDirectionLine, textDirection } from '../../ui/directional';
import { LoneTouchTarget } from '../../ui/styles/TouchTarget.css';
import { renderTextWithLatex } from '../html/react-custom-html-parser';
import * as css from './CallTranscriptCard.css';

type CallTranscriptCardProps = {
  transcript: CallTranscript;
  /** The room whose members name the speakers. */
  roomId?: string;
  /** A search's matches: they are marked, and a transcript with one starts open. */
  highlightRegex?: RegExp;
  linkifyOpts: LinkifyOpts;
};

type GroupProps = {
  group: CallTranscriptGroup;
  room: Room | null;
  highlightRegex?: RegExp;
  linkifyOpts: LinkifyOpts;
};

/** One speaker's run of turns: their avatar and name as the room knows them, then the text. */
function TranscriptGroup({ group, room, highlightRegex, linkifyOpts }: GroupProps) {
  const client = useMatrixClient();
  const authenticatedMedia = useMediaAuthentication();
  const { sender, texts } = group;
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
        {texts.map((text, index) => (
          <Text
            // Turns never move within a group, so their place is their identity.
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            as="p"
            size="T300"
            className={css.Text}
            data-call-transcript-text=""
            dir={textDirection(text) ?? 'auto'}
          >
            {renderTextWithLatex(text, { linkify: true, linkifyOpts, highlightRegex })}
          </Text>
        ))}
      </div>
    </li>
  );
}

const matchesAny = (regex: RegExp, texts: readonly string[]): boolean => {
  const once = new RegExp(regex.source, regex.flags.replace('g', ''));
  return texts.some((text) => once.test(text));
};

/**
 * A finished voice call (`io.mindroom.call_transcript`): the phone icon, "Voice call" and how
 * long it lasted, then the transcript behind a button that says how many turns it holds. Open,
 * it reads like a chat: each run of turns by one speaker under their avatar and name.
 */
export function CallTranscriptCard({
  transcript,
  roomId,
  highlightRegex,
  linkifyOpts,
}: CallTranscriptCardProps) {
  const { t, i18n } = useTranslation();
  const language = useAppLanguageCode();
  const client = useMatrixClient();
  const headerId = useId();
  const turnsId = useId();
  const { durationSeconds, turns } = transcript;
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
      <div id={headerId} className={css.Header} data-call-transcript-header="">
        <Icon size="100" src={Icons.Phone} aria-hidden />
        <Text as="span" size="T300" className={css.Title}>
          {t('featureUi.calls.transcript.title')}
        </Text>
        <Text as="span" size="T300" priority="300">
          {formatCallDuration(durationSeconds, language)}
        </Text>
      </div>
      <button
        type="button"
        className={`${css.Toggle} ${LoneTouchTarget}`}
        aria-expanded={open}
        aria-controls={turnsId}
        onClick={() => setOpen((shown) => !shown)}
      >
        <Icon
          size="50"
          src={open ? Icons.ChevronBottom : Icons.ChevronRight}
          data-directional={open ? undefined : true}
          aria-hidden
        />
        <Text as="span" size="T300">
          {t('featureUi.calls.transcript.transcript')}
        </Text>
        <Text as="span" size="T200" priority="300">
          {t('featureUi.calls.transcript.turns', { count: turns.length })}
        </Text>
      </button>
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
    </div>
  );
}
