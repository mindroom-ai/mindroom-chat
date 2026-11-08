import { act, create } from 'react-test-renderer';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { useMemberEventParser } from './useMemberEventParser';

function MembershipMessage({ event, room }: { event: MatrixEvent; room?: Room }) {
  const parse = useMemberEventParser();
  return <div>{parse(event, room).body}</div>;
}

describe('membership rows name the member the client knows', () => {
  const member = (
    eventId: string,
    sender: string,
    content: Record<string, unknown>,
    prevContent: Record<string, unknown>
  ) =>
    new MatrixEvent({
      event_id: eventId,
      type: 'm.room.member',
      sender,
      state_key: '@guest:example.org',
      content,
      unsigned: { prev_content: prevContent },
    });

  it('names an unbanned member by the name they had before the ban', async () => {
    const language = createInstance();
    await language.init({
      lng: 'en',
      interpolation: { escapeValue: false },
      resources: {
        en: {
          translation: {
            sharedUi: {
              memberEvents: { unbanned: '<b>{{senderName}}</b> unbanned <b>{{userName}}</b>' },
            },
          },
        },
      },
    });
    const joined = member(
      '$join',
      '@guest:example.org',
      { membership: 'join', displayname: 'Guest Person' },
      { membership: 'invite' }
    );
    // A ban and the leave that lifts it carry no name.
    const banned = member(
      '$ban',
      '@mod:example.org',
      { membership: 'ban' },
      { membership: 'join', displayname: 'Guest Person' }
    );
    const unbanned = member(
      '$unban',
      '@mod:example.org',
      { membership: 'leave' },
      { membership: 'ban' }
    );
    const timeline = {
      getEvents: () => [joined, banned, unbanned],
      getNeighbouringTimeline: () => null,
    };
    const room = {
      getTimelineForEvent: (eventId: string) => (eventId === '$unban' ? timeline : null),
      getMember: () => null,
    } as unknown as Room;

    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <I18nextProvider i18n={language}>
          <MembershipMessage event={unbanned} room={room} />
        </I18nextProvider>
      );
    });
    expect(renderer!.root.findAllByType('b')[1]?.children).toEqual(['Guest Person']);
    act(() => renderer!.unmount());

    // Without the room the row can only fall back to the localpart.
    act(() => {
      renderer = create(
        <I18nextProvider i18n={language}>
          <MembershipMessage event={unbanned} />
        </I18nextProvider>
      );
    });
    expect(renderer!.root.findAllByType('b')[1]?.children).toEqual(['guest']);
    act(() => renderer!.unmount());
  });

  it('names a member who joined with a name another member has with their user ID', async () => {
    const language = createInstance();
    await language.init({
      lng: 'en',
      interpolation: { escapeValue: false },
      resources: {
        en: {
          translation: { sharedUi: { memberEvents: { joined: '<b>{{userName}}</b> joined' } } },
        },
      },
    });
    const roomId = '!room:example.org';
    const mx = createClient({ baseUrl: 'https://example.org', userId: '@me:example.org' });
    const room = new Room(roomId, mx, '@me:example.org');
    const joined = (userId: string, displayname: string) =>
      new MatrixEvent({
        event_id: `$join-${userId}`,
        type: 'm.room.member',
        room_id: roomId,
        sender: userId,
        state_key: userId,
        content: { membership: 'join', displayname },
      });
    const copyJoin = joined('@copy:example.org', 'Morgan Lee');
    room.currentState.setStateEvents([joined('@guest:example.org', 'Guest Person'), copyJoin]);
    // The real Morgan Lee is loaded later, as in a room with lazy-loaded members.
    room.currentState.markOutOfBandMembersStarted();
    room.currentState.setOutOfBandMembers([joined('@morgan:example.org', 'Morgan Lee')]);

    const rowName = (event: MatrixEvent) => {
      let renderer!: ReturnType<typeof create>;
      act(() => {
        renderer = create(
          <I18nextProvider i18n={language}>
            <MembershipMessage event={event} room={room} />
          </I18nextProvider>
        );
      });
      const name = renderer.root.findAllByType('b')[0]?.children;
      act(() => renderer.unmount());
      return name;
    };
    expect(rowName(copyJoin)).toEqual(['Morgan Lee (\u2066@copy:example.org\u2069)']);
    expect(rowName(joined('@guest:example.org', 'Guest Person'))).toEqual(['Guest Person']);
  });

  it("names a moderator who took an agent's name with their user ID", async () => {
    const language = createInstance();
    await language.init({
      lng: 'en',
      interpolation: { escapeValue: false },
      resources: {
        en: {
          translation: {
            sharedUi: {
              memberEvents: { kicked: '<b>{{senderName}}</b> removed <b>{{userName}}</b>' },
            },
          },
        },
      },
    });
    const roomId = '!room:example.org';
    const mx = createClient({ baseUrl: 'https://example.org', userId: '@me:example.org' });
    const room = new Room(roomId, mx, '@me:example.org');
    const joined = (userId: string, displayname: string) =>
      new MatrixEvent({
        event_id: `$join-${userId}`,
        type: 'm.room.member',
        room_id: roomId,
        sender: userId,
        state_key: userId,
        content: { membership: 'join', displayname },
      });
    room.currentState.setStateEvents([
      joined('@mindroom_helper:example.org', 'Helper'),
      joined('@mod:example.org', 'Helper'),
    ]);
    const kicked = member(
      '$kick',
      '@mod:example.org',
      { membership: 'leave' },
      { membership: 'join', displayname: 'Guest Person' }
    );
    kicked.sender = room.currentState.getSentinelMember('@mod:example.org');

    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <I18nextProvider i18n={language}>
          <MembershipMessage event={kicked} room={room} />
        </I18nextProvider>
      );
    });
    expect(renderer!.root.findAllByType('b')[0]?.children).toEqual([
      'Helper (\u2066@mod:example.org\u2069)',
    ]);
    act(() => renderer!.unmount());
  });

  it("shows the direction controls of a removal's reason as code points", () => {
    // Applied, the override would show the reason as `spam links`.
    const kicked = member(
      '$kick',
      '@mod:example.org',
      { membership: 'leave', reason: 'skn\u202eil maps\u202c' },
      { membership: 'join', displayname: 'Guest Person' }
    );
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<MembershipMessage event={kicked} />);
    });
    const text = JSON.stringify(renderer!.toJSON());
    expect(text).toContain('(skn<U+202E>il maps<U+202C>)');
    expect(text).not.toMatch(/[\u202a-\u202e]/);
  });
});
