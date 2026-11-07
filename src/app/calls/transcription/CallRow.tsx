import { useCallback, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'jotai';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { Button, Icon, Icons, Text } from 'folds';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import {
  getIntersectionObserverEntry,
  useIntersectionObserver,
} from '../../lib/hooks/useIntersectionObserver';
import type { CallRowContent } from '../../matrix/protocol/callRow';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import { formatCallDuration } from '../../lib/time';
import { useRoomNavigate } from '../../navigation/useRoomNavigate';
import { useSelectedRoom } from '../../navigation/useSelectedRoom';
import { callPanelRoomAtom, isActiveCallShownIn, useActiveCall } from '../callStore';
import { CallMemberAvatar } from '../CallTile';
import { nameInCall } from './transcriptionState';
import { openTranscriptPanel } from './transcriptPanel';
import { useLiveTranscript } from './useLiveTranscript';
import { useTranscriptionServer } from './useTranscriptionServer';
import * as css from './CallRow.css';

type RowProps = { room: Room; rowEvent: MatrixEvent; row: CallRowContent };

/** A live call's row reads who is in the call this often while it is in view. */
const READ_MS = 5_000;

/** The row of a call that has ended: how long it lasted, and the way to its transcript message. */
function EndedCallRow({ room, rowEvent, row }: RowProps) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const headerId = useId();
  const { navigateRoomThread } = useRoomNavigate();
  const durationSeconds = row.ended?.durationSeconds;
  const transcriptEventId = row.ended?.transcriptEventId;
  return (
    <div className={css.Row} role="group" aria-labelledby={headerId} data-call-row="">
      <div id={headerId} className={css.Header}>
        <Icon size="100" src={Icons.Phone} aria-hidden />
        <Text as="span" size="T300" className={css.Title}>
          {t('featureUi.calls.row.ended')}
        </Text>
        {durationSeconds !== undefined && (
          <Text as="span" size="T300" priority="300">
            {formatCallDuration(durationSeconds, language)}
          </Text>
        )}
      </div>
      {transcriptEventId && (
        <button
          type="button"
          className={css.Link}
          onClick={() => navigateRoomThread(room.roomId, rowEvent.getId() ?? '', transcriptEventId)}
        >
          <Text as="span" size="T300">
            {t('featureUi.calls.row.notes')}
          </Text>
        </button>
      )}
    </div>
  );
}

/**
 * The row of a call that is on: who is in it, as MindRoom has it, Join and Transcript. The router
 * never edits the row of a call MindRoom no longer has (transcripts turned off, MindRoom down for
 * more than a day, the router gone): a read that says the room is not transcribed, or names no
 * live call or another one, shows the row as ended, without how long it lasted. A device that knows
 * no MindRoom server for the room reads nothing, and the row stays as posted.
 */
function LiveCallRow({ room, row }: RowProps) {
  const { t } = useTranslation();
  const headerId = useId();
  const store = useStore();
  const selectedRoomId = useSelectedRoom();
  const navigation = useRoomNavigate();

  const rowRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useIntersectionObserver(
    (entries) => {
      const entry = getIntersectionObserverEntry(rowRef.current, entries);
      if (entry) setInView(entry.isIntersecting);
    },
    undefined,
    useCallback(() => rowRef.current, [])
  );
  const { state, live } = useLiveTranscript(room, READ_MS, inView);
  const shownCall = isActiveCallShownIn(useActiveCall(), room.roomId);
  const people = live?.call?.id === row.callId ? live.call.members : [];
  const serverKnown = !!useTranscriptionServer(useMatrixClient(), room).apiUrl;
  const ended =
    (state === 'not-transcribed' && serverKnown) || (!!live && live.call?.id !== row.callId);

  const showRoom = () => {
    if (selectedRoomId !== room.roomId) navigation.navigateRoom(room.roomId);
  };

  return (
    <div ref={rowRef} className={css.Row} role="group" aria-labelledby={headerId} data-call-row="">
      <div id={headerId} className={css.Header}>
        <Icon size="100" src={Icons.Phone} aria-hidden />
        <Text as="span" size="T300" className={css.Title}>
          {t(ended ? 'featureUi.calls.row.ended' : 'featureUi.calls.row.live')}
        </Text>
      </div>
      {people.length > 0 && (
        <div className={css.People}>
          <ul className={css.Faces} aria-label={t('featureUi.calls.panel.participants')}>
            {people.map((userId) => {
              const name = nameInCall(room, live, userId);
              return (
                <li key={userId} aria-label={name} title={name} data-call-row-member="">
                  <CallMemberAvatar room={room} userId={userId} size="200" />
                </li>
              );
            })}
          </ul>
          <Text as="span" size="T200" priority="300">
            {t('featureUi.calls.panel.inCall', { count: people.length })}
          </Text>
        </div>
      )}
      {!ended && (
        <div className={css.Actions}>
          {!shownCall && (
            <Button
              size="300"
              radii="Pill"
              variant="Success"
              fill="Solid"
              before={<Icon size="100" src={Icons.Phone} />}
              onClick={() => {
                showRoom();
                store.set(callPanelRoomAtom, room.roomId);
              }}
            >
              <Text size="B300">{t('featureUi.call.prescreenControls.join')}</Text>
            </Button>
          )}
          <Button
            size="300"
            radii="Pill"
            variant="Secondary"
            fill="Soft"
            onClick={() => {
              showRoom();
              openTranscriptPanel(store, room.roomId);
            }}
          >
            <Text size="B300">{t('featureUi.calls.transcript.transcript')}</Text>
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The row MindRoom's router posts when a call between people starts (`io.mindroom.call`), as its
 * latest edit has it. Unedited, the call is on: who is in it, Join and Transcript, until a read
 * says MindRoom no longer has it. Edited for the end: how long it lasted and, once the router
 * names it, the way to the transcript message in the row's thread.
 */
export function CallRow({ mEvent, row }: { mEvent: MatrixEvent; row: CallRowContent }) {
  const room = useMatrixClient().getRoom(mEvent.getRoomId());
  if (!room) return null;
  return row.ended ? (
    <EndedCallRow room={room} rowEvent={mEvent} row={row} />
  ) : (
    <LiveCallRow room={room} rowEvent={mEvent} row={row} />
  );
}
