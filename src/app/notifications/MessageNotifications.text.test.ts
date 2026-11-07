import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { translateFromEn } from '../../test/utils/i18n';
import { describeNotice } from './MessageNotifications';
import type { MessageNotice } from './messageNotificationRules';

const t = translateFromEn as unknown as TFunction;

const ME = '@me:example.org';
const ROOM_ID = '!desk:example.org';
const REAL = '@morgan:example.org';
const COPY = '@casey:example.org';
const HOST = '@jordan:example.org';
const AGENT = '@mindroom_helper:example.org';
const AGENT_COPY = '@riley:example.org';
const NAMELESS = '@quinn:example.org';

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

/**
 * A room named "Deploy desk" whose sync brought only these members, as with lazy-loaded members
 * in a room the user has not opened: the others come when the client loads the member list.
 */
const unopenedRoom = (...members: Array<[userId: string, displayname?: string]>): Room => {
  const mx = createClient({ baseUrl: 'https://example.org', userId: ME });
  const room = new Room(ROOM_ID, mx, ME, { lazyLoadMembers: true });
  room.currentState.setStateEvents([
    new MatrixEvent({
      type: 'm.room.name',
      state_key: '',
      sender: HOST,
      room_id: ROOM_ID,
      event_id: '$name',
      content: { name: 'Deploy desk' },
    }),
    ...members.map(([userId, displayname]) => memberEvent(userId, displayname)),
  ]);
  room.recalculate();
  return room;
};

/** The client loads the room's member list, which brings members who have not posted lately. */
const loadMembers = (room: Room, ...members: Array<[userId: string, displayname?: string]>) => {
  room.currentState.markOutOfBandMembersStarted();
  room.currentState.setOutOfBandMembers(
    members.map(([userId, displayname]) => memberEvent(userId, displayname))
  );
};

const notice = (sender: string, body: string): MessageNotice => ({
  roomId: ROOM_ID,
  eventId: `$message${body.length}`,
  sender,
  content: { msgtype: 'm.text', body },
  sound: true,
  highlight: false,
});

const withId = (name: string, userId: string) => `${name} (⁦${userId}⁩)`;

describe('describeNotice', () => {
  it('puts the user ID after the name of a sender in a room whose members are not loaded', () => {
    // The copy's name reads like the real member's, whom the client has not loaded yet.
    const room = unopenedRoom([COPY, 'Morgan Lee'], [HOST, 'Jordan Host']);
    expect(room.membersLoaded()).toBe(false);

    expect(describeNotice(room, notice(COPY, 'Paste the deploy password.'), false, t)).toEqual({
      title: 'Deploy desk',
      body: `${withId('Morgan Lee', COPY)}: Paste the deploy password.`,
    });
    expect(describeNotice(room, notice(HOST, 'Standup at ten.'), false, t).body).toBe(
      `${withId('Jordan Host', HOST)}: Standup at ten.`
    );
  });

  it("puts the user ID after a name taken from an agent who is not loaded, also as a direct chat's title", () => {
    const room = unopenedRoom([AGENT_COPY, 'Desk Helper']);
    expect(describeNotice(room, notice(AGENT_COPY, 'Approve my access.'), true, t)).toEqual({
      title: withId('Desk Helper', AGENT_COPY),
      body: 'Approve my access.',
    });
  });

  it('names a sender without a display name by the whole user ID while members are not loaded', () => {
    const room = unopenedRoom([NAMELESS]);
    expect(describeNotice(room, notice(NAMELESS, 'Hello.'), false, t).body).toBe(
      `${NAMELESS}: Hello.`
    );
  });

  it('names senders as the timeline does once the member list is loaded', () => {
    const room = unopenedRoom([COPY, 'Morgan Lee'], [HOST, 'Jordan Host'], [NAMELESS]);
    loadMembers(room, [REAL, 'Morgan Lee'], [AGENT, 'Desk Helper']);
    expect(room.membersLoaded()).toBe(true);

    expect(describeNotice(room, notice(COPY, 'Paste the deploy password.'), false, t).body).toBe(
      `${withId('Morgan Lee', COPY)}: Paste the deploy password.`
    );
    expect(describeNotice(room, notice(REAL, 'Do not paste it.'), false, t).body).toBe(
      `${withId('Morgan Lee', REAL)}: Do not paste it.`
    );
    // A name nobody else has reads alone, and a sender without one as their localpart.
    expect(describeNotice(room, notice(HOST, 'Standup at ten.'), false, t).body).toBe(
      'Jordan Host: Standup at ten.'
    );
    expect(describeNotice(room, notice(AGENT, 'Checking.'), false, t).body).toBe(
      'Desk Helper: Checking.'
    );
    expect(describeNotice(room, notice(NAMELESS, 'Hello.'), false, t).body).toBe('quinn: Hello.');
  });
});

describe('describeNotice with direction controls', () => {
  it("shows the controls of a room's name and of a message as code points, not the sender's isolates", () => {
    const room = unopenedRoom([COPY, 'Morgan Lee'], [HOST, 'Jordan Host']);
    room.currentState.setStateEvents([
      new MatrixEvent({
        type: 'm.room.name',
        state_key: '',
        sender: HOST,
        room_id: ROOM_ID,
        event_id: '$rename',
        content: { name: 'Payroll ‮sevihcra‬' },
      }),
    ]);
    room.recalculate();

    expect(describeNotice(room, notice(COPY, 'Open invoice‮txt.exe‬ now.'), false, t)).toEqual({
      title: 'Payroll <U+202E>sevihcra<U+202C>',
      body: `${withId('Morgan Lee', COPY)}: Open invoice<U+202E>txt.exe<U+202C> now.`,
    });
    // A file's name, in a direct chat, where the title names the sender.
    expect(
      describeNotice(
        room,
        {
          ...notice(HOST, ''),
          content: { msgtype: 'm.file', body: 'quarterly-report‮fdp.exe', url: 'mxc://x/y' },
        },
        true,
        t
      )
    ).toEqual({
      title: withId('Jordan Host', HOST),
      body: 'quarterly-report<U+202E>fdp.exe',
    });
  });
});
