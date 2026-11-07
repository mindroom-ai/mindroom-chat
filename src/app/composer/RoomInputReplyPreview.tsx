import { useEffect, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { MatrixEventEvent, RoomEvent, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { Box, Icon, Icons, Text } from 'folds';
import { IconButton } from '../ui/glass/GlassPrimitives';
import { ReplyLayout } from '../messages/layout/layout';
import type { IReplyDraft } from './roomInputDrafts';
import { getMemberDisplayName } from '../matrix/room';
import { getMxIdLocalPart } from '../matrix/matrix';
import {
  getReplyPreviewText,
  replaceMatrixUserIdsWithDisplayNames,
} from '../event-store/threads/threadMessagePreview';
import { RoomInputReplyContext } from './RoomInputExtensions';
import { buildRoomTimelineReplyDraft } from '../timeline/roomTimelineReplyDraft';
import { isUnreadableYet } from '../matrix/decryptionWaits';

/**
 * The reply target with its text. A target kept on disk for an encrypted room names its message
 * only (`replyDraftAtRest`), so after a reload the text comes from the message, once the room has
 * it and it decrypts; until then the bar says the message is encrypted.
 */
const useReplyTargetText = (room: Room, replyDraft: IReplyDraft): IReplyDraft | undefined => {
  const kept = !!replyDraft.body || replyDraft.previewText !== undefined;
  const { eventId } = replyDraft;
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (kept) return undefined;
    // The message, or an edit of it, arrives or decrypts.
    const onEvent = (event: MatrixEvent) => {
      if (event.getId() === eventId || event.getRelation()?.event_id === eventId) refresh();
    };
    room.on(RoomEvent.Timeline, onEvent);
    room.client.on(MatrixEventEvent.Decrypted, onEvent);
    return () => {
      room.removeListener(RoomEvent.Timeline, onEvent);
      room.client.removeListener(MatrixEventEvent.Decrypted, onEvent);
    };
  }, [eventId, kept, room]);
  if (kept) return replyDraft;
  const message = room.findEventById(eventId);
  if (!message || isUnreadableYet(message)) return undefined;
  return buildRoomTimelineReplyDraft(room, eventId, false)?.draft;
};

type RoomInputReplyPreviewProps = {
  room: Room;
  replyDraft: IReplyDraft;
  /** The reply is being sent; the bar says so until the server has it. */
  submitPending: boolean;
  onCancel: () => void;
};

/**
 * The bar above the composer naming the message being replied to, with a one-line preview of
 * it. A preview text the draft brings (a canvas title) shows as written; a body shows without
 * its Markdown. Mentions read as the members' names.
 */
export function RoomInputReplyPreview({
  room,
  replyDraft,
  submitPending,
  onCancel,
}: RoomInputReplyPreviewProps) {
  const { t } = useTranslation();
  const sender =
    getMemberDisplayName(room, replyDraft.userId) ??
    getMxIdLocalPart(replyDraft.userId) ??
    replyDraft.userId;
  const quoted = useReplyTargetText(room, replyDraft);
  const preview = quoted?.previewText
    ? replaceMatrixUserIdsWithDisplayNames(room, quoted.previewText, '@')
    : getReplyPreviewText(
        room,
        quoted
          ? { body: quoted.body, formatted_body: quoted.formattedBody }
          : { msgtype: 'm.bad.encrypted' },
        t
      );

  return (
    <RoomInputReplyContext room={room} relation={replyDraft.relation} pendingSend={submitPending}>
      <Box grow="Yes" alignItems="Center" gap="200" style={{ minWidth: 0 }}>
        <IconButton
          size="300"
          radii="300"
          variant="SurfaceVariant"
          aria-label={t('composer.cancelReply')}
          onClick={onCancel}
        >
          <Icon size="50" src={Icons.Cross} />
        </IconButton>
        <Box grow="Yes" style={{ minWidth: 0 }}>
          <ReplyLayout
            username={
              <Text size="T300">
                <b>{sender}</b>
              </Text>
            }
          >
            <Text size="T300" priority="300" truncate>
              {preview}
            </Text>
          </ReplyLayout>
        </Box>
      </Box>
    </RoomInputReplyContext>
  );
}
