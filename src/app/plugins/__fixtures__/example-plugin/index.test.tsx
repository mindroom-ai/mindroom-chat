// @vitest-environment jsdom
// The example plugin's test, written as a plugin outside this repository writes one: it imports the
// app only through the client SDK, `/testing` included, and runs in the app's vitest.
import { createClient, KnownMembership, MatrixEvent, Room } from 'matrix-js-sdk';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { usePluginStorage, type PluginEvent } from '@mindroom/client-sdk/core';
import { renderPluginComponent } from '@mindroom/client-sdk/testing';
import plugin from './index';

const greeting: PluginEvent = {
  sender: '@mindroom_helper:example.org',
  content: { body: 'Hello', 'com.example.greeting': { text: 'Hello' } },
};

describe('example plugin', () => {
  const [renderer] = plugin.messageRenderers ?? [];
  const [Banner] = plugin.roomHeaderSlot ?? [];

  /** The greeting as the plugin renders it, with this config.json section, in this language. */
  const renderGreeting = (options: { config?: unknown; language?: string } = {}) => {
    if (!renderer) throw new Error('the example plugin has no message renderer');
    return renderPluginComponent(<renderer.Component event={greeting} />, {
      id: 'example',
      plugin,
      ...options,
    });
  };

  it('renders the messages that carry a greeting', () => {
    expect(renderer?.match(greeting)).toBe(true);
    expect(renderer?.match({ sender: greeting.sender, content: { body: 'Hello' } })).toBe(false);
  });

  it('labels a greeting with its English strings', async () => {
    expect((await renderGreeting()).getByText('Example plugin: Hello')).toBeTruthy();
  });

  it("labels a greeting in the app's language", async () => {
    expect(
      (await renderGreeting({ language: 'de' })).getByText('Beispiel-Plugin: Hello')
    ).toBeTruthy();
  });

  it('labels a greeting in English again in the next test, which names no language', async () => {
    // Also only one greeting shows: the earlier tests' renders are gone.
    expect((await renderGreeting()).getByText('Example plugin: Hello')).toBeTruthy();
  });

  it('labels a greeting with the label its config.json section sets', async () => {
    const view = await renderGreeting({ config: { label: 'From config' }, language: 'de' });
    expect(view.getByText('From config: Hello')).toBeTruthy();
  });

  it.each([
    ['the account signed in', undefined],
    [
      "the client's account, when the test gives a client",
      createClient({ baseUrl: 'https://example.org', userId: '@ada:example.org' }),
    ],
  ])('keeps values in its storage for %s', async (_, client) => {
    function Stored() {
      const storage = usePluginStorage('example');
      const kept = storage.setItem('note', 'kept');
      return <p>{`${String(kept)}: ${storage.getItem('note') ?? 'nothing'}`}</p>;
    }
    const view = await renderPluginComponent(<Stored />, { id: 'example', plugin, client });
    expect(view.getByText('true: kept')).toBeTruthy();
  });

  it("links its page to its window page under a router, which the test's ui gives", async () => {
    const [page] = plugin.pages ?? [];
    if (!page) throw new Error('the example plugin has no page');
    const view = await renderPluginComponent(
      <MemoryRouter>
        <page.Component params={{}} />
      </MemoryRouter>,
      { id: 'example', plugin }
    );
    expect(view.getByText('Fill the window').getAttribute('href')).toBe('/p/example/window');
  });

  it('links its room page to the room and to its thread, also at a space address', async () => {
    const page = plugin.pages?.find(({ path }) => path === 'rooms/:roomId/:threadId');
    if (!page) throw new Error('the example plugin has no room page');
    // A space's address by its alias, as a room's own components see, of a space the client lacks.
    const view = await renderPluginComponent(
      <MemoryRouter initialEntries={['/%23team%3Aexample.org/']}>
        <page.Component params={{ roomId: '!lobby:example.org', threadId: '$root:example.org' }} />
      </MemoryRouter>,
      { id: 'example', plugin }
    );
    const href = (name: string) => view.getByRole('link', { name }).getAttribute('href');
    expect(href('Link to the room')).toBe('/home/!lobby%3Aexample.org');
    expect(href('Link to the thread')).toBe(
      '/home/!lobby%3Aexample.org?threadId=%24root%3Aexample.org'
    );
  });

  it('names the open room under the header', async () => {
    if (!Banner) throw new Error('the example plugin has nothing under the room header');
    const room = { roomId: '!lobby:example.org', name: 'Lobby' } as Room;
    const view = await renderPluginComponent(<Banner room={room} />, { id: 'example', plugin });
    expect(view.getByText('Example banner in Lobby')).toBeTruthy();
  });

  it("counts its panel's room members and tells whether a MindRoom agent is one", async () => {
    const [panel] = plugin.sidePanels ?? [];
    if (!panel) throw new Error('the example plugin has no side panel');
    // A client of the account that knows two rooms: one it shares with an agent, and one with two
    // people, which an agent has left.
    const userId = '@ada:example.org';
    const client = createClient({ baseUrl: 'https://example.org', userId });
    const addRoom = (roomId: string, members: [string, KnownMembership][]) => {
      const room = new Room(roomId, client, userId);
      room.currentState.setStateEvents(
        members.map(
          ([member, membership]) =>
            new MatrixEvent({
              type: 'm.room.member',
              room_id: roomId,
              sender: member,
              state_key: member,
              content: { membership },
            })
        )
      );
      client.store.storeRoom(room);
    };
    const { Join, Leave } = KnownMembership;
    addRoom('!agent:example.org', [
      [userId, Join],
      ['@mindroom_helper:example.org', Join],
    ]);
    addRoom('!people:example.org', [
      [userId, Join],
      ['@bob:example.org', Join],
      ['@carol:example.org', Join],
      ['@mindroom_helper:example.org', Leave],
    ]);
    const view = await renderPluginComponent(
      <>
        <panel.Component roomId="!agent:example.org" />
        <panel.Component roomId="!people:example.org" />
      </>,
      { id: 'example', plugin, client }
    );
    expect(view.getByText('Members: 2, with a MindRoom agent')).toBeTruthy();
    expect(view.getByText('Members: 3, without a MindRoom agent')).toBeTruthy();
  });

  it('greets the room with the text typed after /greet, and asks for some without it', async () => {
    const [greet] = plugin.slashCommands ?? [];
    if (!greet) throw new Error('the example plugin has no slash command');
    const client = createClient({ baseUrl: 'https://example.org', userId: '@ada:example.org' });
    const sent = vi.spyOn(client, 'sendNotice').mockResolvedValue({ event_id: '$greeting' });
    const room = new Room('!lobby:example.org', client, '@ada:example.org');

    await greet.run({ room, args: 'Hello there' });
    expect(sent).toHaveBeenCalledWith('!lobby:example.org', 'Example greeting: Hello there');
    await expect(async () => greet.run({ room, args: '  ' })).rejects.toThrow(
      'Type a greeting after /greet.'
    );
    expect(sent).toHaveBeenCalledTimes(1);
  });
});
