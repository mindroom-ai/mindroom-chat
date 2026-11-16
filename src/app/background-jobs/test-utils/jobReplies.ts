import { MatrixEvent } from 'matrix-js-sdk';

/** An agent's reply that says it streams, in a thread or (`null`) in the main timeline. */
export const streamingReply = (
  roomId: string,
  id: string,
  sender: string,
  threadId: string | null
): MatrixEvent =>
  new MatrixEvent({
    event_id: id,
    room_id: roomId,
    sender,
    type: 'm.room.message',
    origin_server_ts: Date.now(),
    content: {
      msgtype: 'm.text',
      body: 'Working on it',
      'io.mindroom.stream_status': 'streaming',
      ...(threadId ? { 'm.relates_to': { rel_type: 'm.thread', event_id: threadId } } : {}),
    },
  });

/** The edit that finishes a streaming reply. */
export const finishingEdit = (reply: MatrixEvent): MatrixEvent =>
  new MatrixEvent({
    event_id: `${reply.getId()}-done`,
    room_id: reply.getRoomId(),
    sender: reply.getSender(),
    type: 'm.room.message',
    origin_server_ts: Date.now(),
    content: {
      msgtype: 'm.text',
      body: '* Done',
      'm.new_content': {
        msgtype: 'm.text',
        body: 'Done',
        'io.mindroom.stream_status': 'completed',
      },
      'm.relates_to': { rel_type: 'm.replace', event_id: reply.getId() },
    },
  });
