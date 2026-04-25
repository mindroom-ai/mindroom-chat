import React from 'react';
import { RelationType, Room } from 'matrix-js-sdk';
import { BaseRange, Editor } from 'slate';
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

export { VoiceRecorderComposer as MindroomVoiceRecorderComposer };
