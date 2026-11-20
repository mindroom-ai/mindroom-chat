import { IEventWithRoomId, RelationType } from 'matrix-js-sdk';
import { isThreadSummaryContent } from '../matrix/protocol/threadSummary';

export type SearchResultOpenTarget = {
  mainEventId: string;
  threadRootId?: string;
  /** A thread's title notice: it opens its thread, which it stands for, not the notice. */
  threadTitle?: true;
};

export const getSearchResultOpenTarget = (
  event: Pick<IEventWithRoomId, 'content' | 'event_id'>
): SearchResultOpenTarget => {
  const relation = event.content['m.relates_to'];
  const threadRootId =
    relation?.rel_type === RelationType.Thread && relation.event_id ? relation.event_id : undefined;

  return {
    mainEventId:
      relation?.rel_type === RelationType.Replace && relation.event_id
        ? relation.event_id
        : event.event_id,
    threadRootId,
    ...(threadRootId && isThreadSummaryContent(event.content) ? { threadTitle: true } : {}),
  };
};
