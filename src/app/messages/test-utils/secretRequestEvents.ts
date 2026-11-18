import { MatrixEvent } from 'matrix-js-sdk';
import { MINDROOM_SECRET_REQUEST_KEY } from '../../matrix/protocol/secretRequest';

export const AGENT = '@mindroom_dev:example.org';

/** A body with `count` tool markers, as an agent writes them. */
export const markers = (count: number) =>
  Array.from({ length: count }, (_value, index) => `🔧 \`shell\` [${index + 1}]`).join('\n\n');

/** A tool trace entry of each of `callIds`, as replies and live frames carry them. */
export const traceEvents = (callIds: string[]) =>
  callIds.map((callId) => ({
    type: 'tool_call_completed',
    tool_name: 'shell',
    tool_call_id: callId,
  }));

/** An agent reply whose trace names `callIds`; `status` its stream status, if any. */
export const replyEvent = (
  id = '$reply',
  {
    sender = AGENT,
    callIds = ['call_1', 'call_2'],
    body = markers(2),
    roomId = undefined as string | undefined,
    status = undefined as string | undefined,
  } = {}
) =>
  new MatrixEvent({
    event_id: id,
    type: 'm.room.message',
    sender,
    room_id: roomId,
    content: {
      msgtype: 'm.text',
      body,
      'io.mindroom.tool_trace': { version: 2, events: traceEvents(callIds) },
      ...(status ? { 'io.mindroom.stream_status': status } : {}),
    },
  });

/** The agent's temporary-secret card, done by default, naming the reply and the call that asked. */
export const cardEvent = (
  id = '$card',
  {
    sender = AGENT,
    status = 'saved',
    anchor = { response_event_id: '$reply', tool_call_id: 'call_2' } as object,
  } = {}
) =>
  new MatrixEvent({
    event_id: id,
    type: 'm.room.message',
    sender,
    content: {
      msgtype: 'm.notice',
      body: 'Secret needed',
      [MINDROOM_SECRET_REQUEST_KEY]: {
        request_id: 'req-1',
        requester_id: '@bas:example.org',
        env: 'SUDO_PASSWORD',
        keep: { memory: 900, disk: 86_400 },
        reason: 'To restart',
        status,
        expires_at: Date.now() + 60_000,
        ...anchor,
      },
    },
  });
