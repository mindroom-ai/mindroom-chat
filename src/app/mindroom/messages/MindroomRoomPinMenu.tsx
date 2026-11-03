import React, { forwardRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { Box, Icon, IconButton, Icons, Menu, Scroll, Spinner, Text, config } from 'folds';
import { RenderMessageContent } from '../../components/RenderMessageContent';
import { useRoomPinnedEvents } from '../../hooks/useRoomPinnedEvents';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { getEditedEvent, getMemberDisplayName } from '../../utils/room';
import { getReactCustomHtmlParser, LINKIFY_OPTS } from '../../plugins/react-custom-html-parser';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import {
  isMindroomPinnedToolApprovalEvent,
  renderMindroomPinnedEncryptedMessageEvent,
  renderMindroomPinnedToolApprovalEvent,
  useMindroomPinnedEvent,
} from './pinnedMessageExtensions';

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







  const htmlReactParserOptions = useMemo(
    () =>
      getReactCustomHtmlParser(mx, room.roomId, { linkifyOpts: LINKIFY_OPTS, useAuthentication }),
    [mx, room.roomId, useAuthentication]
  );
  const showUrlPreview = room.hasEncryptionStateEvent() ? encUrlPreview : urlPreview;

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
      const resolveEditedEvent = (candidate: MatrixEvent) =>
        getEditedEvent(eventId, candidate, loaded.timelineSet);
      const approval = renderMindroomPinnedEncryptedMessageEvent(loaded.event, {
        ...options,
        displayName,
        eventId,
        resolveEditedEvent,
      });
      if (approval !== undefined) return <>{approval}</>;
      const edited = resolveEditedEvent(loaded.event);
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

  if (isMindroomPinnedToolApprovalEvent(event.getType())) {
    return <>{renderMindroomPinnedToolApprovalEvent(event, { ...options, displayName })}</>;
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
