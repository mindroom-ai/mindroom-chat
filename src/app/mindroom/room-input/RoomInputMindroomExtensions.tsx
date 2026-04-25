import React from 'react';
import { RelationType, Room } from 'matrix-js-sdk';
import { BaseRange, Editor } from 'slate';
import { Box, Text, config } from 'folds';
import type { AutocompleteQuery } from '../../components/editor/autocomplete/autocompleteQuery';
import type { IReplyDraft } from '../../state/room/roomInputDrafts';
import { MindroomCommandAutocomplete } from '../commands/MindroomCommandAutocomplete';
import {
  getMindroomCommandQuery,
  MINDROOM_COMMAND_PREFIX,
} from '../commands/mindroomCommandQuery';
import { getMessageRelation } from '../threads/composeMessageRelation';
import { ThreadIndicator } from '../threads/ThreadIndicator';
import { VoiceRecorderComposer } from '../voice/VoiceRecorderDialog';

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
): MindroomRoomInputAutocompleteQuery | undefined =>
  getMindroomCommandQuery(editor, prevWordRange);

export const isMindroomRoomInputAutocompleteQuery = (
  query: AutocompleteQuery<string> | undefined
): query is MindroomRoomInputAutocompleteQuery => query?.prefix === MINDROOM_COMMAND_PREFIX;

export const getMindroomRoomInputMessageRelation = (
  replyDraft: Pick<IReplyDraft, 'eventId' | 'relation'> | undefined,
  threadId: string | undefined
) => getMessageRelation(replyDraft?.eventId, replyDraft?.relation, threadId);

export function MindroomRoomInputAutocomplete({
  editor,
  query,
  requestClose,
}: MindroomRoomInputAutocompleteProps) {
  if (!isMindroomRoomInputAutocompleteQuery(query)) return null;

  return (
    <MindroomCommandAutocomplete editor={editor} query={query} requestClose={requestClose} />
  );
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
