import {
  createClient,
  EventType,
  MatrixEvent,
  RelationType,
  Room,
  type IEvent,
  type MatrixClient,
} from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { keepNewerEditsOnMappedCopies } from './mappedCopyEdits';

const ROOM_ID = '!room:example';
const USER_ID = '@reader:example';
const AGENT_ID = '@agent:example';

const reply: IEvent = {
  event_id: '$reply',
  room_id: ROOM_ID,
  sender: AGENT_ID,
  origin_server_ts: 1,
  type: EventType.RoomMessage,
  content: { msgtype: 'm.text', body: 'Thinking...' },
  unsigned: {},
} as IEvent;

const editOf = (body: string, ts: number): IEvent =>
  ({
    event_id: `$edit-${ts}`,
    room_id: ROOM_ID,
    sender: AGENT_ID,
    origin_server_ts: ts,
    type: EventType.RoomMessage,
    content: {
      msgtype: 'm.text',
      body: `* ${body}`,
      'm.new_content': { msgtype: 'm.text', body },
      'm.relates_to': { rel_type: RelationType.Replace, event_id: '$reply' },
    },
    unsigned: {},
  } as IEvent);

/** A copy of the reply as a thread's root bundles it: with the edit the copy was made with. */
const copyWith = (edit: IEvent): Partial<IEvent> => ({
  ...reply,
  unsigned: { 'm.relations': { [RelationType.Replace]: edit } },
});

/** A client holding the reply, which shows its edit of `ts` 5. */
const holdReply = async (guard: boolean) => {
  const mx: MatrixClient = createClient({ baseUrl: 'https://matrix.example', userId: USER_ID });
  const room = new Room(ROOM_ID, mx, USER_ID);
  mx.getRoom = (roomId) => (roomId === ROOM_ID ? room : null);
  await room.addLiveEvents([new MatrixEvent(reply)], { addToState: false });
  const held = room.findEventById('$reply')!;
  held.makeReplaced(new MatrixEvent(editOf('word1 word2 word3', 5)));
  if (guard) keepNewerEditsOnMappedCopies(mx);
  return { mx, held };
};

describe('mapping a copy of an event the client holds', () => {
  it('puts the older edit of a copy on the event without the guard (the defect)', async () => {
    const { mx, held } = await holdReply(false);

    mx.getEventMapper()(copyWith(editOf('word1', 3)));

    expect(held.getContent().body).toBe('word1');
  });

  it('keeps the newer edit the event shows when a copy brings an older one', async () => {
    const { mx, held } = await holdReply(true);

    const mapped = mx.getEventMapper()(copyWith(editOf('word1', 3)));

    expect(mapped).toBe(held);
    expect(held.getContent().body).toBe('word1 word2 word3');
  });

  it('takes the newer edit of a copy', async () => {
    const { mx, held } = await holdReply(true);

    mx.getEventMapper()(copyWith(editOf('word1 word2 word3 word4', 9)));

    expect(held.getContent().body).toBe('word1 word2 word3 word4');
  });
});
