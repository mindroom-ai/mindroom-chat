import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
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
  const preview = replyDraft.previewText
    ? replaceMatrixUserIdsWithDisplayNames(room, replyDraft.previewText, '@')
    : getReplyPreviewText(
        room,
        { body: replyDraft.body, formatted_body: replyDraft.formattedBody },
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
