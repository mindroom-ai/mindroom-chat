import { forwardRef, useMemo, useRef, useState, useId, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { Avatar, Box, Chip, Icon, IconButton, Icons, Scroll, Spinner, Text, config } from 'folds';
import { Menu } from '../../ui/glass/GlassPrimitives';
import { RenderMessageContent } from '../content/RenderMessageContent';
import {
  MessageBadEncryptedContent,
  MessageDeletedContent,
  MessageNotDecryptedContent,
} from '../content/FallbackContent';
import { useThreadPinning } from '../../event-store/threads/useThreadPinning';
import { useSetting } from '../../preferences/useSetting';
import { settingsAtom } from '../../preferences/settings';
import { getEditedEvent, getMemberAvatarMxc, getMemberDisplayName } from '../../matrix/room';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../matrix/matrix';
import { getReactCustomHtmlParser, LINKIFY_OPTS } from '../html/react-custom-html-parser';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { useRoomEvent } from '../../event-store/cache/useRoomEvent';
import { useRoomNavigate } from '../../navigation/useRoomNavigate';
import { UserAvatar } from '../../avatars/UserAvatar';
import { Time } from '../Time';
import { isPinnedToolApprovalEvent, renderPinnedToolApprovalEvent } from './pinnedToolApproval';
import { getLoadedDecryptedEvent, getPinContent } from './pinContent';
import { isRecord } from '../../lib/isRecord';
import * as css from './RoomPinMenu.css';

export type RoomPinMenuProps = {
  room: Room;
  requestClose: () => void;
};

/** Controls inside an entry that do something of their own, so a click on them opens nothing. */
const ENTRY_CONTROLS =
  'a, button, input, select, textarea, summary, video, audio, [role="button"], [role="link"]';

/** A click on an entry that should not open the message: on a control, or ending a selection. */
const isClickForSomethingElse = (evt: MouseEvent<HTMLElement>): boolean => {
  const target = evt.target instanceof Element ? evt.target : null;
  if (target?.closest(ENTRY_CONTROLS)) return true;
  const selection = window.getSelection();
  return !!selection && !selection.isCollapsed && evt.currentTarget.contains(selection.anchorNode);
};

/** A pin's content, rendered as the timeline renders it. */
function PinnedContent({
  room,
  eventId,
  event,
}: {
  room: Room;
  eventId: string;
  event: MatrixEvent;
}) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  // Encrypted rooms have a URL preview setting of their own.
  const previewSetting = room.hasEncryptionStateEvent() ? 'encUrlPreview' : 'urlPreview';
  const [mediaAutoLoad] = useSetting(settingsAtom, 'mediaAutoLoad');
  const htmlReactParserOptions = useMemo(
    () =>
      getReactCustomHtmlParser(mx, room.roomId, { linkifyOpts: LINKIFY_OPTS, useAuthentication }),
    [mx, room.roomId, useAuthentication]
  );
  const [showUrlPreview] = useSetting(settingsAtom, previewSetting);

  if (event.isRedacted()) return <MessageDeletedContent />;

  const displayName =
    getMemberDisplayName(room, event.getSender() ?? '') ?? event.getSender() ?? '';
  const options = {
    roomId: room.roomId,
    mediaAutoLoad: !!mediaAutoLoad,
    urlPreview: !!showUrlPreview,
    htmlReactParserOptions,
    linkifyOpts: LINKIFY_OPTS,
    outlineAttachment: true,
  };

  if (event.getType() === 'm.room.encrypted') {
    const loaded = getLoadedDecryptedEvent(room, event);
    if (loaded) {
      const edited = getEditedEvent(eventId, loaded.event, loaded.timelineSet);
      if (isPinnedToolApprovalEvent(loaded.event.getType())) {
        return (
          <>
            {renderPinnedToolApprovalEvent(loaded.event, {
              ...options,
              displayName,
              eventId,
              editedEvent: edited,
            })}
          </>
        );
      }
      // An edit found by relation shows its new content; else what the copy says.
      const editedContent: unknown = edited?.getContent()['m.new_content'];
      const shown = isRecord(editedContent)
        ? { content: editedContent, edited: true }
        : getPinContent(loaded.event);
      return (
        <RenderMessageContent
          displayName={displayName}
          msgType={typeof shown.content.msgtype === 'string' ? shown.content.msgtype : ''}
          ts={loaded.event.getTs()}
          edited={shown.edited}
          getContent={(() => shown.content) as <T>() => T}
          {...options}
          mEvent={loaded.event}
        />
      );
    }
    // Neither the timeline nor the loaded copy could be decrypted (yet).
    return event.isDecryptionFailure() ? (
      <MessageBadEncryptedContent />
    ) : (
      <MessageNotDecryptedContent />
    );
  }

  if (isPinnedToolApprovalEvent(event.getType())) {
    return <>{renderPinnedToolApprovalEvent(event, { ...options, displayName })}</>;
  }

  const { content, edited } = getPinContent(event);
  return (
    <RenderMessageContent
      displayName={displayName}
      msgType={typeof content.msgtype === 'string' ? content.msgtype : ''}
      ts={event.getTs()}
      edited={edited}
      getContent={(() => content) as <T>() => T}
      {...options}
      mEvent={event}
    />
  );
}

/** The 48 px thumbnail of a member's picture, when they have one. */
const usePinnedSenderPicture = (room: Room, senderId: string): string | undefined => {
  const client = useMatrixClient();
  const authenticated = useMediaAuthentication();
  const mxc = getMemberAvatarMxc(room, senderId);
  return (mxc && mxcUrlToHttp(client, mxc, authenticated, 48, 48, 'crop')) || undefined;
};

/** How times read: the reader's clock and date format. */
type TimeFormat = { hour24Clock: boolean; dateFormatString?: string };

type PinnedSenderProps = {
  room: Room;
  event: MatrixEvent;
  timeFormat: TimeFormat;
  timeId: string;
  contentId: string;
  onOpen: () => void;
};

/** The row that opens the message: the sender's avatar and name, then the send time. */
function PinnedSender({ room, event, timeFormat, timeId, contentId, onOpen }: PinnedSenderProps) {
  const { t } = useTranslation();
  const senderId = event.getSender() ?? '';
  const name = getMemberDisplayName(room, senderId) ?? getMxIdLocalPart(senderId) ?? senderId;
  const pictureUrl = usePinnedSenderPicture(room, senderId);
  return (
    <button
      type="button"
      className={css.PinnedJump}
      data-pin-jump
      aria-label={t('mindroomUi.messages.mindroomRoomPinMenu.jumpToMessageFrom', { name })}
      aria-describedby={`${timeId} ${contentId}`}
      onClick={onOpen}
    >
      <Avatar size="200" radii="400" aria-hidden>
        <UserAvatar
          alt=""
          userId={senderId}
          src={pictureUrl}
          renderFallback={() => <Icon filled size="50" src={Icons.User} />}
        />
      </Avatar>
      <Box grow="Yes" style={{ minWidth: 0 }}>
        <Text as="span" size="T300" truncate style={{ fontWeight: 600 }}>
          {name}
        </Text>
      </Box>
      <Time id={timeId} ts={event.getTs()} {...timeFormat} style={{ flexShrink: 0 }} />
    </button>
  );
}

type PinnedEntryProps = {
  room: Room;
  eventId: string;
  timeFormat: TimeFormat;
  /** Opens the message; a thread reply opens in its thread. */
  onOpen: (eventId: string, threadRootId?: string) => void;
  /** Present when the reader may unpin. */
  unpin?: { busy: boolean; failed: boolean; onUnpin: (eventId: string, from: HTMLElement) => void };
};

/**
 * One pin: a row with the sender's avatar and name and the send time, then the message. The row
 * is the button that opens the message in the timeline (it reads out the message and its time);
 * a click elsewhere on the entry does the same, except on the message's own controls.
 */
function PinnedEntry({ room, eventId, timeFormat, onOpen, unpin }: PinnedEntryProps) {
  // Undefined while the pin loads, null when it could not be loaded.
  const event = useRoomEvent(room, eventId);
  const timeId = useId();
  const contentId = useId();
  const { t } = useTranslation();
  const open = () => onOpen(eventId, event?.threadRootId);

  let row;
  let content;
  if (event === undefined) {
    content = (
      <Box justifyContent="Center" style={{ padding: config.space.S200 }}>
        <Spinner size="200" variant="Secondary" />
      </Box>
    );
  } else if (event === null) {
    content = (
      <Text size="T300" priority="300">
        {t('mindroomUi.messages.mindroomRoomPinMenu.failedToLoadMessage')}
      </Text>
    );
    // The message may still load in the timeline.
    row = (
      <Box grow="Yes">
        <Chip variant="Secondary" radii="Pill" data-pin-jump onClick={open}>
          <Text size="B300">{t('mindroomUi.messages.mindroomRoomPinMenu.open')}</Text>
        </Chip>
      </Box>
    );
  } else {
    row = (
      <PinnedSender
        room={room}
        event={event}
        timeFormat={timeFormat}
        timeId={timeId}
        contentId={contentId}
        onOpen={open}
      />
    );
    content = <PinnedContent room={room} eventId={eventId} event={event} />;
  }

  const unpinLabel = unpin?.failed
    ? t('threadActions.failed')
    : t('mindroomUi.messages.messageModerationActions.unpinMessage');

  return (
    // The row button is the keyboard path; a click on the rest of the entry is a pointer shortcut.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events
    <div
      className={css.PinnedEntry}
      data-pinned-event-id={eventId}
      onClick={(evt) => {
        if (!isClickForSomethingElse(evt)) open();
      }}
    >
      {(row || unpin) && (
        <Box alignItems="Center" gap="100">
          {row ?? <Box grow="Yes" />}
          {unpin && (
            <IconButton
              size="300"
              radii="300"
              variant={unpin.failed ? 'Critical' : 'Surface'}
              aria-label={unpinLabel}
              title={unpinLabel}
              disabled={unpin.busy}
              onClick={(evt: MouseEvent<HTMLButtonElement>) =>
                unpin.onUnpin(eventId, evt.currentTarget)
              }
            >
              <Icon
                size="100"
                src={unpin.failed ? Icons.Warning : Icons.Pin}
                filled={!unpin.failed}
              />
            </IconButton>
          )}
        </Box>
      )}
      <div id={contentId}>{content}</div>
    </div>
  );
}

/** The room's pinned messages, newest first; an entry opens its message in the timeline. */
export const RoomPinMenu = forwardRef<HTMLDivElement, RoomPinMenuProps>(
  ({ requestClose, room }, ref) => {
    const { pinnedEventIds, canPin, setPinned, updating } = useThreadPinning(room);
    const [clock24] = useSetting(settingsAtom, 'hour24Clock');
    const { navigateRoom, navigateRoomFocusEvent, navigateRoomThread } = useRoomNavigate();
    const { eventId: routedEventId } = useParams();
    const [datePattern] = useSetting(settingsAtom, 'dateFormatString');
    const { t } = useTranslation();
    const timeFormat = useMemo(
      () => ({ hour24Clock: !!clock24, dateFormatString: datePattern || undefined }),
      [clock24, datePattern]
    );
    const eventIds = useMemo(() => [...pinnedEventIds].reverse(), [pinnedEventIds]);
    const closeRef = useRef<HTMLButtonElement>(null);
    const [failedUnpin, setFailedUnpin] = useState<string>();

    const title = t('mindroomUi.messages.mindroomRoomPinMenu.pinnedMessages');

    // A permalink route, which loads the history around the message when needed and highlights
    // it. A message of the room is focused in the room, also in the thread views (as leaving a
    // thread focuses its root); a thread reply opens in its thread, as a search hit does.
    const openMessage = (eventId: string, threadRootId?: string) => {
      requestClose();
      const open = () => {
        if (threadRootId && threadRootId !== eventId) {
          navigateRoomThread(room.roomId, threadRootId, eventId);
        } else {
          navigateRoomFocusEvent(room.roomId, eventId);
        }
      };
      if (routedEventId !== eventId) {
        open();
        return;
      }
      // The address already names this message (the reader opened it before and scrolled away),
      // and the timeline acts only on a change of it: drop the permalink first, as Jump to
      // Latest does, and open the message on the next frame.
      navigateRoom(room.roomId, undefined, { replace: true });
      requestAnimationFrame(open);
    };

    const unpinMessage = (eventId: string, from: HTMLElement) => {
      // The entry leaves as soon as the change starts, so focus moves to its neighbour first.
      const entry = from.closest('[data-pinned-event-id]');
      const neighbour =
        entry?.nextElementSibling?.querySelector<HTMLElement>('[data-pin-jump]') ??
        entry?.previousElementSibling?.querySelector<HTMLElement>('[data-pin-jump]') ??
        closeRef.current;
      neighbour?.focus();
      setFailedUnpin(undefined);
      void setPinned(eventId, false).then((saved) => {
        if (!saved) setFailedUnpin(eventId);
      });
    };

    return (
      // The header's Pinned Messages button announces a dialog (aria-haspopup), so this is one.
      <Menu
        ref={ref}
        role="dialog"
        aria-label={title}
        style={{ width: 'min(24rem, calc(100vw - 2rem))' }}
      >
        <Box direction="Column">
          <Box alignItems="Center" gap="200" style={{ padding: config.space.S300 }}>
            <Box grow="Yes">
              <Text size="H5">{title}</Text>
            </Box>
            <IconButton
              ref={closeRef}
              size="300"
              radii="300"
              aria-label={t('mindroomUi.messages.mindroomMessageControls.close')}
              onClick={requestClose}
            >
              <Icon size="100" src={Icons.Cross} />
            </IconButton>
          </Box>
          <Scroll size="300" hideTrack visibility="Hover" style={{ maxHeight: '60vh' }}>
            <Box direction="Column" gap="100" style={{ padding: config.space.S200 }}>
              {eventIds.length === 0 ? (
                <Text size="T300" priority="300">
                  {t('mindroomUi.messages.mindroomRoomPinMenu.noPinnedMessages')}
                </Text>
              ) : (
                eventIds.map((eventId) => (
                  <PinnedEntry
                    key={eventId}
                    room={room}
                    eventId={eventId}
                    timeFormat={timeFormat}
                    onOpen={openMessage}
                    unpin={
                      canPin
                        ? {
                            busy: updating,
                            failed: failedUnpin === eventId,
                            onUnpin: unpinMessage,
                          }
                        : undefined
                    }
                  />
                ))
              )}
            </Box>
          </Scroll>
        </Box>
      </Menu>
    );
  }
);
