import { MatrixEvent, Room } from 'matrix-js-sdk';
import { DEFAULT_THREAD_TAIL_EVENT_COUNT, getThreadTailEvents } from '../../matrix/thread';
import { isVisibleThreadReplyEvent, isVisibleThreadReplyEventType } from './threadUtils';
import { isAiRunStreaming } from '../../matrix/protocol/aiRun';
import { getSameSenderBundledEdit } from '../../matrix/editEvent';
import { isRecord } from '../../lib/isRecord';

const getEventActivityTs = (mEvent: MatrixEvent | null | undefined): number | undefined => {
  if (!mEvent) return undefined;

  const replacingEvent = mEvent.replacingEvent();
  // An agent's reply streams in as edits, several a second. Until the stream ends the reply counts
  // from when it was sent, so the cards of streaming threads do not trade places at every edit.
  const replacingTs =
    replacingEvent &&
    replacingEvent.getSender() === mEvent.getSender() &&
    !isAiRunStreaming(replacingEvent.getContent())
      ? replacingEvent.getTs()
      : undefined;

  return Math.max(mEvent.getTs(), replacingTs ?? 0);
};

const getPositiveTs = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

const getBundledThreadLatestEventTs = (rootEvent: MatrixEvent | undefined): number | undefined => {
  const latestEvent: unknown =
    rootEvent?.getUnsigned()?.['m.relations']?.['m.thread']?.latest_event;

  if (!isRecord(latestEvent)) return undefined;
  if (
    !isVisibleThreadReplyEventType(
      typeof latestEvent.type === 'string' ? latestEvent.type : undefined
    )
  ) {
    return undefined;
  }

  const latestEventTs = getPositiveTs(latestEvent.origin_server_ts);
  const latestEdit = getSameSenderBundledEdit(latestEvent);
  // As for an edit put on a loaded reply (`getEventActivityTs`): one that still streams moves no
  // card. The stream status stays outside an encrypted edit's payload.
  const latestEditTs =
    latestEdit && !isAiRunStreaming(latestEdit.content ?? {})
      ? getPositiveTs(latestEdit.origin_server_ts)
      : undefined;

  if (latestEventTs === undefined) return latestEditTs;
  if (latestEditTs === undefined) return latestEventTs;
  return Math.max(latestEventTs, latestEditTs);
};

export const getThreadLastActivityTs = (
  room: Room | undefined,
  threadRootId: string | undefined
): number | undefined => {
  if (!room || !threadRootId) return undefined;
  const thread = room.getThread(threadRootId);
  const rootEvent = thread?.rootEvent ?? room.findEventById(threadRootId);
  // The replies of the loaded tail, the newest one the thread knows and the one its summary names.
  const replies = [
    ...getThreadTailEvents(thread, DEFAULT_THREAD_TAIL_EVENT_COUNT),
    thread?.lastReply?.(),
    thread?.replyToEvent,
  ].filter((mEvent): mEvent is MatrixEvent => !!mEvent && isVisibleThreadReplyEvent(mEvent));
  const trackedEvents = [...replies, rootEvent];
  const liveActivityTs = trackedEvents
    .map((mEvent) => getEventActivityTs(mEvent))
    .reduce<number | undefined>((latestTs, candidateTs) => {
      if (candidateTs === undefined) return latestTs;
      if (latestTs === undefined) return candidateTs;
      return candidateTs > latestTs ? candidateTs : latestTs;
    }, undefined);
  const bundledActivityTs = getBundledThreadLatestEventTs(rootEvent);
  if (liveActivityTs === undefined) return bundledActivityTs;
  if (bundledActivityTs === undefined) return liveActivityTs;
  return Math.max(liveActivityTs, bundledActivityTs);
};
