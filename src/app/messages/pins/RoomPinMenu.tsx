import { forwardRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { Box, Icon, IconButton, Icons, Scroll, Spinner, Text, config } from 'folds';
import { Menu } from '../../ui/glass/GlassPrimitives';
import { RenderMessageContent } from '../content/RenderMessageContent';
import { usePinnedEventIds as useRoomPinnedEvents } from '../../event-store/threads/useThreadPinning';
import { useSetting } from '../../preferences/useSetting';
import { settingsAtom } from '../../preferences/settings';
import { getEditedEvent, getMemberDisplayName } from '../../matrix/room';
import { getReactCustomHtmlParser, LINKIFY_OPTS } from '../html/react-custom-html-parser';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { useRoomEvent } from '../../event-store/cache/useRoomEvent';
import { isPinnedToolApprovalEvent, renderPinnedToolApprovalEvent } from './pinnedToolApproval';

export type RoomPinMenuProps = {
  room: Room;
  requestClose: () => void;
};

/** The decrypted copy of an encrypted pin when the room timeline already holds it. */
const getLoadedDecryptedEvent = (room: Room, event: MatrixEvent) => {
  const eventId = event.getId();
  if (!eventId) return undefined;
  const timeline = room.getTimelineForEvent(eventId);
  const loaded = timeline?.getEvents().find((candidate) => candidate.getId() === eventId);
  return loaded && timeline ? { event: loaded, timelineSet: timeline.getTimelineSet() } : undefined;
};

function PinnedEvent({ room, eventId }: { room: Room; eventId: string }) {
  // Undefined while the pin loads, null when it could not be loaded.
  const event = useRoomEvent(room, eventId);
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  // Encrypted rooms have a URL preview setting of their own.
  const previewSetting = room.hasEncryptionStateEvent() ? 'encUrlPreview' : 'urlPreview';
  const [mediaAutoLoad] = useSetting(settingsAtom, 'mediaAutoLoad');
  const { t } = useTranslation();
  const htmlReactParserOptions = useMemo(
    () =>
      getReactCustomHtmlParser(mx, room.roomId, { linkifyOpts: LINKIFY_OPTS, useAuthentication }),
    [mx, room.roomId, useAuthentication]
  );
  const [showUrlPreview] = useSetting(settingsAtom, previewSetting);

  if (event === undefined) {
    return (
      <Box justifyContent="Center" style={{ padding: config.space.S300 }}>
        <Spinner size="200" variant="Secondary" />
      </Box>
    );
  }
  if (event === null) {
    return (
      <Text size="T300" priority="300" style={{ padding: config.space.S300 }}>
        {t('mindroomUi.messages.mindroomRoomPinMenu.failedToLoadMessage')}
      </Text>
    );
  }

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
      return (
        <RenderMessageContent
          displayName={displayName}
          msgType={(loaded.event.getContent().msgtype as string) ?? ''}
          ts={loaded.event.getTs()}
          edited={!!edited}
          getContent={
            (() => edited?.getContent()['m.new_content'] ?? loaded.event.getContent()) as <T>() => T
          }
          {...options}
          mEvent={loaded.event}
        />
      );
    }
  }

  if (isPinnedToolApprovalEvent(event.getType())) {
    return <>{renderPinnedToolApprovalEvent(event, { ...options, displayName })}</>;
  }

  return (
    <RenderMessageContent
      displayName={displayName}
      msgType={(event.getContent().msgtype as string) ?? ''}
      ts={event.getTs()}
      edited={!!event.replacingEvent()}
      getContent={(() => event.getContent()) as <T>() => T}
      {...options}
      mEvent={event}
    />
  );
}

/** The room's pinned messages, newest first. */
export const RoomPinMenu = forwardRef<HTMLDivElement, RoomPinMenuProps>(
  ({ requestClose, room }, ref) => {
    const pinnedEvents = useRoomPinnedEvents(room);
    const { t } = useTranslation();
    const eventIds = useMemo(() => [...pinnedEvents].reverse(), [pinnedEvents]);

    return (
      <Menu ref={ref} style={{ width: 'min(24rem, calc(100vw - 2rem))' }}>
        <Box direction="Column">
          <Box alignItems="Center" gap="200" style={{ padding: config.space.S300 }}>
            <Box grow="Yes">
              <Text size="H5">{t('mindroomUi.messages.mindroomRoomPinMenu.pinnedMessages')}</Text>
            </Box>
            <IconButton
              size="300"
              radii="300"
              aria-label={t('mindroomUi.messages.mindroomMessageControls.close')}
              onClick={requestClose}
            >
              <Icon size="100" src={Icons.Cross} />
            </IconButton>
          </Box>
          <Scroll size="300" hideTrack visibility="Hover" style={{ maxHeight: '60vh' }}>
            <Box direction="Column" gap="200" style={{ padding: config.space.S200 }}>
              {eventIds.length === 0 ? (
                <Text size="T300" priority="300">
                  {t('mindroomUi.messages.mindroomRoomPinMenu.noPinnedMessages')}
                </Text>
              ) : (
                eventIds.map((eventId) => (
                  <PinnedEvent key={eventId} room={room} eventId={eventId} />
                ))
              )}
            </Box>
          </Scroll>
        </Box>
      </Menu>
    );
  }
);
