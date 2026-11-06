import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { getMemberDisplayName } from './room';

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

  it('gives no name for a member without one, or with one that shows nothing', () => {
    const room = roomWith([EVE], [SAM, '\u3164'], [OTHER_SAM, OTHER_SAM], [FOURTH, '\u00AD']);
    expect(getMemberDisplayName(room, EVE)).toBeUndefined();
    expect(getMemberDisplayName(room, SAM)).toBeUndefined();
    expect(getMemberDisplayName(room, OTHER_SAM)).toBeUndefined();
    expect(getMemberDisplayName(room, FOURTH)).toBeUndefined();
    expect(getMemberDisplayName(room, '@nobody:example.org')).toBeUndefined();
  });
});
