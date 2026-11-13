import { createClient, MatrixEvent, Room, RoomMember } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  getMemberDisplayName,
  getMemberEventName,
  getRoomMemberName,
  splitUserIdSuffix,
} from './room';

const ROOM_ID = '!room:example.org';
const AGENT = '@mindroom_helper:example.org';
const EVE = '@eve:example.org';
const SAM = '@sam:example.org';
const OTHER_SAM = '@sam.other:example.org';
const FOURTH = '@fourth:example.org';

let eventCount = 0;

const memberEvent = (userId: string, displayname?: string) => {
  eventCount += 1;
  return new MatrixEvent({
    type: 'm.room.member',
    state_key: userId,
    sender: userId,
    room_id: ROOM_ID,
    event_id: `$member${eventCount}`,
    origin_server_ts: eventCount,
    content: { membership: 'join', ...(displayname === undefined ? {} : { displayname }) },
  });
};

/** A real SDK room whose members joined with these names, in this order. */
const roomWith = (...members: Array<[userId: string, displayname?: string]>): Room => {
  const mx = createClient({ baseUrl: 'https://example.org', userId: '@me:example.org' });
  const room = new Room(ROOM_ID, mx, '@me:example.org');
  for (const [userId, displayname] of members) {
    room.currentState.setStateEvents([memberEvent(userId, displayname)]);
  }
  return room;
};

const rename = (room: Room, userId: string, displayname: string) =>
  room.currentState.setStateEvents([memberEvent(userId, displayname)]);

/**
 * Members the client learns about only when it loads the room's member list, as in a room whose
 * sync leaves out members who have not posted lately (lazy-loaded members).
 */
const loadLater = (room: Room, ...members: Array<[userId: string, displayname: string]>) => {
  room.currentState.markOutOfBandMembersStarted();
  room.currentState.setOutOfBandMembers(
    members.map(([userId, displayname]) => memberEvent(userId, displayname))
  );
};

/** A name with its user ID after it, the ID isolated so it reads left to right in any text. */
const withId = (name: string, userId: string) => `${name} (\u2066${userId}\u2069)`;

describe('getMemberDisplayName', () => {
  it('keeps a name no other member has', () => {
    const room = roomWith([AGENT, 'Helper'], [SAM, 'Sam']);
    expect(getMemberDisplayName(room, AGENT)).toBe('Helper');
    expect(getMemberDisplayName(room, SAM)).toBe('Sam');
  });

  it('adds the user ID to both members who share a name', () => {
    const room = roomWith([SAM, 'Sam'], [OTHER_SAM, 'Sam']);
    expect(getMemberDisplayName(room, SAM)).toBe(withId('Sam', SAM));
    expect(getMemberDisplayName(room, OTHER_SAM)).toBe(withId('Sam', OTHER_SAM));
  });

  it("adds the user ID to a member who takes an agent's name, and to the agent until it is unique again", () => {
    const room = roomWith([AGENT, 'Helper'], [EVE, 'Eve']);
    rename(room, EVE, 'Helper');
    expect(getMemberDisplayName(room, EVE)).toBe(withId('Helper', EVE));
    expect(getMemberDisplayName(room, AGENT)).toBe(withId('Helper', AGENT));

    rename(room, EVE, 'Eve');
    expect(getMemberDisplayName(room, EVE)).toBe('Eve');
    expect(getMemberDisplayName(room, AGENT)).toBe('Helper');
  });

  it('adds the user ID to both members who share a name when one of them is loaded later', () => {
    // Sam posted long ago, so only the copy's member event came with the sync.
    const room = roomWith([AGENT, 'Helper'], [OTHER_SAM, 'Sam']);
    expect(getMemberDisplayName(room, OTHER_SAM)).toBe('Sam');
    loadLater(room, [SAM, 'Sam']);
    expect(getMemberDisplayName(room, OTHER_SAM)).toBe(withId('Sam', OTHER_SAM));
    expect(getMemberDisplayName(room, SAM)).toBe(withId('Sam', SAM));
    expect(getMemberDisplayName(room, AGENT)).toBe('Helper');
  });

  it('adds the user ID to both members who share a name when both are loaded later', () => {
    const room = roomWith([AGENT, 'Helper']);
    loadLater(room, [SAM, 'Sam'], [OTHER_SAM, 'Sam'], [EVE, 'Helper']);
    expect(getMemberDisplayName(room, SAM)).toBe(withId('Sam', SAM));
    expect(getMemberDisplayName(room, OTHER_SAM)).toBe(withId('Sam', OTHER_SAM));
    expect(getMemberDisplayName(room, EVE)).toBe(withId('Helper', EVE));
    expect(getMemberDisplayName(room, AGENT)).toBe(withId('Helper', AGENT));
  });

  it("adds the user ID to a timeline event's sender whose name another member shares now", () => {
    const room = roomWith([OTHER_SAM, 'Sam']);
    // The sender as the event recorded them, before anyone else in the room had their name.
    const sender = new RoomMember(ROOM_ID, OTHER_SAM);
    sender.setMembershipEvent(memberEvent(OTHER_SAM, 'Sam'));
    expect(getRoomMemberName(sender, room)).toBe('Sam');
    loadLater(room, [SAM, 'Sam']);
    expect(getRoomMemberName(sender, room)).toBe(withId('Sam', OTHER_SAM));
  });

  it('adds the user ID to a name shaped like a user ID', () => {
    const room = roomWith([EVE, '@sam:example.org']);
    expect(getMemberDisplayName(room, EVE)).toBe(withId('@sam:example.org', EVE));
  });

  it('adds the user ID to a name with invisible characters, and leaves them out', () => {
    const room = roomWith(
      [AGENT, 'Helper'],
      [EVE, 'Help\u200Ber'],
      [SAM, '\uFEFFHelper'],
      [OTHER_SAM, 'Hel\u00ADper'],
      [FOURTH, 'Help\u2060er']
    );
    expect(getMemberDisplayName(room, EVE)).toBe(withId('Helper', EVE));
    expect(getMemberDisplayName(room, SAM)).toBe(withId('Helper', SAM));
    expect(getMemberDisplayName(room, OTHER_SAM)).toBe(withId('Helper', OTHER_SAM));
    expect(getMemberDisplayName(room, FOURTH)).toBe(withId('Helper', FOURTH));
    // A zero-width space or a byte order mark is ignored when names are compared.
    expect(getMemberDisplayName(room, AGENT)).toBe(withId('Helper', AGENT));
  });

  it('adds the user ID to a name with invisible characters when nobody in the room has its look-alike', () => {
    const room = roomWith([EVE, 'Hel\u00ADper'], [SAM, 'Sam']);
    expect(getMemberDisplayName(room, EVE)).toBe(withId('Helper', EVE));
    expect(getMemberDisplayName(room, SAM)).toBe('Sam');
  });

  it('adds the user ID to a name with direction controls, and leaves the controls out', () => {
    const room = roomWith(
      [AGENT, 'Helper'],
      [EVE, '\u202Erepleh'],
      [SAM, 'Helper\u2067'],
      [OTHER_SAM, '\u200FSam']
    );
    expect(getMemberDisplayName(room, EVE)).toBe(withId('repleh', EVE));
    expect(getMemberDisplayName(room, SAM)).toBe(withId('Helper', SAM));
    expect(getMemberDisplayName(room, OTHER_SAM)).toBe(withId('Sam', OTHER_SAM));
  });

  it('keeps names whose joiners are part of the writing', () => {
    // Persian writes with zero-width non-joiners; emoji sequences hold zero-width joiners.
    const room = roomWith([EVE, 'می\u200Cخواهم'], [SAM, 'Sam 👩\u200D💻']);
    expect(getMemberDisplayName(room, EVE)).toBe('می\u200Cخواهم');
    expect(getMemberDisplayName(room, SAM)).toBe('Sam 👩\u200D💻');
  });

  it('adds the user ID to a name that is the user ID of a member without a name of their own', () => {
    // Without a display name Sam shows as "sam", the start of their user ID.
    const room = roomWith([SAM], [EVE, 'Eve']);
    rename(room, EVE, 'sam');
    expect(getMemberDisplayName(room, EVE)).toBe(withId('sam', EVE));
    expect(getMemberDisplayName(room, SAM)).toBeUndefined();

    // Once Sam has a name of their own, "sam" is Eve's alone.
    rename(room, SAM, 'Sam Writer');
    expect(getMemberDisplayName(room, EVE)).toBe('sam');
  });

  it('keeps a name that is the user ID of someone no longer in the room', () => {
    const room = roomWith([SAM], [EVE, 'sam']);
    room.currentState.setStateEvents([
      new MatrixEvent({
        type: 'm.room.member',
        state_key: SAM,
        sender: SAM,
        room_id: ROOM_ID,
        event_id: '$samLeft',
        origin_server_ts: 1_000,
        content: { membership: 'leave' },
      }),
    ]);
    expect(getMemberDisplayName(room, EVE)).toBe('sam');
  });

  it('gives no name for a member without one, or with one that shows nothing', () => {
    const room = roomWith([EVE], [SAM, '\u3164'], [OTHER_SAM, OTHER_SAM], [FOURTH, '\u00AD']);
    expect(getMemberDisplayName(room, EVE)).toBeUndefined();
    expect(getMemberDisplayName(room, SAM)).toBeUndefined();
    expect(getMemberDisplayName(room, OTHER_SAM)).toBeUndefined();
    expect(getMemberDisplayName(room, FOURTH)).toBeUndefined();
    expect(getMemberDisplayName(room, '@nobody:example.org')).toBeUndefined();
  });

  describe('a member who is gone without a name', () => {
    const DANA = '@dana:example.org';
    const membership = (
      sender: string,
      content: Record<string, unknown>,
      prevContent: Record<string, unknown>
    ) => {
      eventCount += 1;
      return new MatrixEvent({
        type: 'm.room.member',
        state_key: DANA,
        sender,
        room_id: ROOM_ID,
        event_id: `$membership${eventCount}`,
        origin_server_ts: eventCount,
        content,
        unsigned: { prev_content: prevContent },
      });
    };

    /** Dana joins as "Dana", then Sam kicks, bans and unbans her: none of those carry a name. */
    const removedRoom = async (displayname = 'Dana'): Promise<Room> => {
      const room = roomWith([SAM, 'Sam']);
      await room.addLiveEvents(
        [
          membership(DANA, { membership: 'join', displayname }, { membership: 'invite' }),
          membership(SAM, { membership: 'leave' }, { membership: 'join', displayname }),
          membership(SAM, { membership: 'ban' }, { membership: 'leave' }),
          membership(SAM, { membership: 'leave' }, { membership: 'ban' }),
        ],
        { addToState: true }
      );
      return room;
    };

    it('keeps the name she last had, after a kick, a ban and its lift', async () => {
      const room = await removedRoom();
      expect(room.getMember(DANA)?.membership).toBe('leave');
      expect(getMemberDisplayName(room, DANA)).toBe('Dana');
    });

    it('adds her user ID once a member of the room shows that name', async () => {
      const room = await removedRoom();
      rename(room, EVE, 'Dana');
      expect(getMemberDisplayName(room, DANA)).toBe(withId('Dana', DANA));
    });

    it('gives no name when the name she last had shows nothing', async () => {
      const room = await removedRoom('\u200B');
      expect(getMemberDisplayName(room, DANA)).toBeUndefined();
    });
  });
});

describe('getMemberEventName', () => {
  it('keeps a carried name that shows nothing as it is', () => {
    const room = roomWith([SAM, 'Sam']);
    expect(getMemberEventName(room, EVE, '\u200B')).toBe('\u200B');
  });
});

describe('splitUserIdSuffix', () => {
  it('splits a name before the user ID the room put after it, and leaves other names whole', () => {
    expect(splitUserIdSuffix(withId('Sam', SAM), SAM)).toEqual(['Sam', ` (\u2066${SAM}\u2069)`]);
    expect(splitUserIdSuffix('Sam', SAM)).toEqual(['Sam', '']);
    // Another member's user ID is not this sender's suffix.
    expect(splitUserIdSuffix(withId('Sam', OTHER_SAM), SAM)).toEqual([
      withId('Sam', OTHER_SAM),
      '',
    ]);
  });
});
