import React from 'react';
import { act, create } from 'react-test-renderer';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MatrixEvent, type Room } from 'matrix-js-sdk';
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
    expect(renderer!.root.findAllByType('b')[1].children).toEqual(['Guest Person']);
    act(() => renderer!.unmount());

    // Without the room the row can only fall back to the localpart.
    act(() => {
      renderer = create(
        <I18nextProvider i18n={language}>
          <MembershipMessage event={unbanned} />
        </I18nextProvider>
      );
    });
    expect(renderer!.root.findAllByType('b')[1].children).toEqual(['guest']);
    act(() => renderer!.unmount());
  });
});
