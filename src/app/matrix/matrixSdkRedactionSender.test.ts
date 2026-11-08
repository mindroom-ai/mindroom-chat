import { createClient, MatrixEvent, Room, type IEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';

// Only a redaction its sender may make removes anything (Matrix specification, "Redactions"): the
// target's own sender, or a member with redaction power where the redaction is in the timeline.
// The server keeps a redaction by anyone else without applying it, and our SDK patch does the
// same: such a redaction loses its target, so no copy of the room's events takes it either.

const ROOM = '!room:example.org';
const AUTHOR = '@author:example.org';
const OTHER = '@other:elsewhere.org';
const MODERATOR = '@moderator:elsewhere.org';
const HELPER = '@helper:example.org';

const client = createClient({ baseUrl: 'https://example.org', userId: AUTHOR });

const event = (raw: Partial<IEvent>) => new MatrixEvent({ room_id: ROOM, ...raw });

const message = (id = '$message', sender = AUTHOR) =>
  event({
    event_id: id,
    sender,
    origin_server_ts: 1,
    type: 'm.room.message',
    content: { msgtype: 'm.text', body: 'The forklift is charged.' },
  });

const redaction = (redacts: string, sender: string, extra: Record<string, unknown> = {}) =>
  event({
    event_id: `$redaction-${sender}`,
    sender,
    origin_server_ts: 5,
    type: 'm.room.redaction',
    redacts,
    content: { redacts, ...extra },
  });

const POWER_LEVELS = { users: { [MODERATOR]: 50 }, redact: 50 };

const state = (
  type: string,
  stateKey: string,
  content: Record<string, unknown>,
  prevContent?: Record<string, unknown>
) =>
  event({
    type,
    state_key: stateKey,
    sender: MODERATOR,
    event_id: `$${type}-${stateKey}-${JSON.stringify(content)}`,
    origin_server_ts: 6,
    content,
    unsigned: prevContent ? { prev_content: prevContent } : {},
  });

/**
 * A room where the moderator alone may redact other members' events, with `initial` in it, and
 * how a sync batch reaches it: after the state that follows it (MSC4222 state_after).
 */
const moderatedRoom = async (initial = message()) => {
  const room = new Room(ROOM, client, AUTHOR, { timelineSupport: true });
  room.currentState.setStateEvents([
    state('m.room.create', '', { creator: AUTHOR, room_version: '10' }),
    ...[AUTHOR, OTHER, MODERATOR].map((userId) =>
      state('m.room.member', userId, { membership: 'join' })
    ),
    state('m.room.power_levels', '', POWER_LEVELS),
  ]);
  await room.addLiveEvents([initial], { addToState: false });
  const add = async (...batch: MatrixEvent[]) => {
    room.currentState.setStateEvents(batch.filter((e) => e.isState()));
    await room.addLiveEvents(batch, { addToState: false });
  };
  const shown = () => room.findEventById('$message')!;
  return { room, add, shown };
};

describe('SDK redactions by someone who may not redact the event', () => {
  it('keeps the message another member without the right redacts', async () => {
    const { add, shown } = await moderatedRoom();
    const rejected = redaction('$message', OTHER);

    await add(rejected);

    expect(shown().isRedacted()).toBe(false);
    expect(shown().getContent().body).toBe('The forklift is charged.');
    // Without its target, no copy of the room's events takes the redaction either.
    expect(rejected.getAssociatedId()).toBeUndefined();
    expect(rejected.event.redacts).toBeUndefined();
    expect(rejected.getContent().redacts).toBeUndefined();
  });

  it.each([
    ['the message’s sender', AUTHOR],
    ['a moderator', MODERATOR],
  ])('removes the message %s redacts', async (_, sender) => {
    const { add, shown } = await moderatedRoom();
    const accepted = redaction('$message', sender);

    await add(accepted);

    expect(shown().isRedacted()).toBe(true);
    expect(accepted.getAssociatedId()).toBe('$message');
  });

  it('removes the message a member on its sender’s server redacts', async () => {
    // The server applies a redaction from the original sender's own server too.
    const { room, add, shown } = await moderatedRoom();
    room.currentState.setStateEvents([state('m.room.member', HELPER, { membership: 'join' })]);

    await add(redaction('$message', HELPER));

    expect(shown().isRedacted()).toBe(true);
  });

  it('keeps the target of a second redaction of a removed message', async () => {
    const { add } = await moderatedRoom();
    await add(redaction('$message', AUTHOR));
    const second = redaction('$message', MODERATOR);

    await add(second);

    expect(second.getAssociatedId()).toBe('$message');
  });

  it('keeps the message a member redacts before being given the right', async () => {
    const promoted = { ...POWER_LEVELS, users: { ...POWER_LEVELS.users, [OTHER]: 50 } };
    const { add, shown } = await moderatedRoom();

    await add(
      redaction('$message', OTHER),
      state('m.room.power_levels', '', promoted, POWER_LEVELS)
    );

    expect(shown().isRedacted()).toBe(false);
  });

  it('removes the message a moderator redacts before leaving, in the same batch', async () => {
    const { add, shown } = await moderatedRoom();

    await add(
      redaction('$message', MODERATOR),
      state('m.room.member', MODERATOR, { membership: 'leave' }, { membership: 'join' })
    );

    expect(shown().isRedacted()).toBe(true);
  });

  it('takes a redaction from a page, which has no state of its own, as before', async () => {
    const { room, add, shown } = await moderatedRoom();
    await add(state('m.room.member', MODERATOR, { membership: 'leave' }, { membership: 'join' }));

    room.processThreadedEvents([redaction('$message', MODERATOR)], false);

    expect(shown().isRedacted()).toBe(true);
  });

  it('names as its target only the event it redacts, whatever relation its content claims', async () => {
    const { room, add, shown } = await moderatedRoom();
    await room.addLiveEvents([message('$own', OTHER)], { addToState: false });
    const ownRedaction = redaction('$own', OTHER, {
      'm.relates_to': { rel_type: 'm.reference', event_id: '$message' },
    });

    await add(ownRedaction);

    expect(room.findEventById('$own')!.isRedacted()).toBe(true);
    expect(ownRedaction.getAssociatedId()).toBe('$own');
    expect(shown().isRedacted()).toBe(false);
  });

  describe('of an edit known only from the message’s bundle', () => {
    const edited = () =>
      client.getEventMapper()({
        ...message().event,
        unsigned: {
          'm.relations': {
            'm.replace': {
              event_id: '$edit',
              room_id: ROOM,
              sender: AUTHOR,
              origin_server_ts: 2,
              type: 'm.room.message',
              content: {
                msgtype: 'm.text',
                body: '* The forklift is back.',
                'm.new_content': { msgtype: 'm.text', body: 'The forklift is back.' },
                'm.relates_to': { rel_type: 'm.replace', event_id: '$message' },
              },
            },
          },
        },
      });

    it('keeps the edit another member without the right redacts, and the redaction loses it', async () => {
      const { room, add, shown } = await moderatedRoom(edited());
      const rejected = redaction('$edit', OTHER);

      await add(rejected);

      expect(shown().getContent().body).toBe('The forklift is back.');
      expect(room.redactedBundledEdits.has('$edit')).toBe(false);
      expect(rejected.getAssociatedId()).toBeUndefined();
    });

    it('keeps the target of a redaction of the edit of a removed message', async () => {
      const { add } = await moderatedRoom(edited());
      await add(redaction('$message', AUTHOR));
      const ofEdit = redaction('$edit', MODERATOR);

      await add(ofEdit);

      expect(ofEdit.getAssociatedId()).toBe('$edit');
    });

    it('leaves a page’s redaction of the edit by a member without the right as it was', async () => {
      const { room, shown } = await moderatedRoom(edited());
      const rejected = redaction('$edit', OTHER);

      room.processThreadedEvents([rejected], false);

      expect(shown().getContent().body).toBe('The forklift is back.');
      expect(rejected.getAssociatedId()).toBe('$edit');
    });

    it('drops the edit a moderator redacts before leaving, in the same batch', async () => {
      const { room, add, shown } = await moderatedRoom(edited());

      await add(
        redaction('$edit', MODERATOR),
        state('m.room.member', MODERATOR, { membership: 'leave' }, { membership: 'join' })
      );

      expect(shown().getContent().body).toBe('The forklift is charged.');
      expect(room.redactedBundledEdits.has('$edit')).toBe(true);
    });
  });
});
