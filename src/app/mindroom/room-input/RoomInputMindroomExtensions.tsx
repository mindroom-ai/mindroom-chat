import React from 'react';
import { RelationType, Room } from 'matrix-js-sdk';
import { BaseRange, Editor } from 'slate';
import { Box, Text, config } from 'folds';
import type { AutocompleteQuery } from '../../components/editor/autocomplete/autocompleteQuery';
import type { IReplyDraft } from '../../state/room/roomInputDrafts';
import { MindroomCommandAutocomplete } from '../commands/MindroomCommandAutocomplete';
import { getMindroomCommandQuery, MINDROOM_COMMAND_PREFIX } from '../commands/mindroomCommandQuery';
import { getMessageRelation } from '../threads/composeMessageRelation';
import { ThreadIndicator } from '../threads/ThreadIndicator';
import { VoiceRecorderComposer } from '../voice/VoiceRecorderDialog';
import { isSignalBridgeRoom } from '../bridges/bridgeDetection';
import type { RoomInputSendContext } from '../threads/useRoomInputSendSessionController';
import {
  createRoomInputSendSessionState,
  getUploadRelationForSendSession,
  hasMatchingReplyDraftContext,
} from '../threads/roomInputSendSession';
import type { TUploadContent } from '../../utils/matrix';

export { useRoomInputSendSessionController } from '../threads/useRoomInputSendSessionController';

export type MindroomRoomInputAutocompletePrefix = typeof MINDROOM_COMMAND_PREFIX;
export type MindroomRoomInputAutocompleteQuery =
  AutocompleteQuery<MindroomRoomInputAutocompletePrefix>;

type MindroomRoomInputAutocompleteProps = {
  editor: Editor;
  query: AutocompleteQuery<string> | undefined;
  requestClose: () => void;
};

type MindroomRoomInputThreadIndicatorProps = {
  room: Room;
  relation: IReplyDraft['relation'] | undefined;
};
export type MindroomVoiceSendContext = RoomInputSendContext;

type MindroomRoomInputReplyContextProps = {
  children?: React.ReactNode;
  leading?: React.ReactNode;
  relation: IReplyDraft['relation'] | undefined;
  room: Room;
  threadId?: string;
};

export const getMindroomRoomInputAutocompleteQuery = (
  editor: Editor,
  prevWordRange: BaseRange
): MindroomRoomInputAutocompleteQuery | undefined => getMindroomCommandQuery(editor, prevWordRange);

export const isMindroomRoomInputAutocompleteQuery = (
  query: AutocompleteQuery<string> | undefined
): query is MindroomRoomInputAutocompleteQuery => query?.prefix === MINDROOM_COMMAND_PREFIX;

export const getMindroomRoomInputMessageRelation = (
  replyDraft: Pick<IReplyDraft, 'eventId' | 'relation'> | undefined,
  threadId: string | undefined
) => getMessageRelation(replyDraft?.eventId, replyDraft?.relation, threadId);

export const getMindroomRoomInputVoiceSendContext = ({
  roomId,
  room,
  threadId,
  replyDraft,
}: {
  roomId: string;
  room: Room;
  threadId: string | undefined;
  replyDraft: IReplyDraft | undefined;
}): MindroomVoiceSendContext => ({
  roomId,
  room,
  threadId,
  replyDraft,
  signalBridgedRoom: isSignalBridgeRoom(room),
});

export const getMindroomRoomInputVoiceUploadRelation = (
  context: MindroomVoiceSendContext,
  file: TUploadContent
) => {
  const session = {
    threadId: context.threadId,
    replyDraft: context.replyDraft,
    ...createRoomInputSendSessionState({
      files: [file],
      hasText: false,
      threadId: context.threadId,
      replyDraft: context.replyDraft,
    }),
  };

  return getUploadRelationForSendSession(session, false);
};

export const hasMatchingMindroomRoomInputVoiceReplyContext = (
  context: MindroomVoiceSendContext,
  currentReplyDraft: IReplyDraft | undefined
): boolean =>
  hasMatchingReplyDraftContext(
    {
      roomId: context.roomId,
      threadId: context.threadId,
      replyDraft: context.replyDraft,
    },
    {
      roomId: context.roomId,
      threadId: context.threadId,
      replyDraft: currentReplyDraft,
    }
  );

export function MindroomRoomInputAutocomplete({
  editor,
  query,
  requestClose,
}: MindroomRoomInputAutocompleteProps) {
  if (!isMindroomRoomInputAutocompleteQuery(query)) return null;

  return <MindroomCommandAutocomplete editor={editor} query={query} requestClose={requestClose} />;
}

export function MindroomRoomInputThreadIndicator({
  room,
  relation,
}: MindroomRoomInputThreadIndicatorProps) {
  if (relation?.rel_type !== RelationType.Thread) return null;

  return <ThreadIndicator room={room} />;
}

export function MindroomRoomInputReplyContext({
  children,
  leading,
  relation,
  room,
  threadId,
}: MindroomRoomInputReplyContextProps) {
  if (!leading && !children && !threadId) return null;

  return (
    <Box
      alignItems="Center"
      gap="300"
      style={{ padding: `${config.space.S200} ${config.space.S300} 0` }}
    >
      {leading}
      <Box direction="Row" gap="200" alignItems="Center">
        <MindroomRoomInputThreadIndicator room={room} relation={relation} />
        {children ?? (
          <Text size="T300" priority="300">
            Sending to this thread
          </Text>
        )}
      </Box>
    </Box>
  );
}

export { VoiceRecorderComposer as MindroomVoiceRecorderComposer };
