// @vitest-environment jsdom
// The example plugin's test, written as a plugin outside this repository writes one: it imports the
// app only through the client SDK, `/testing` included, and runs in the app's vitest.
import { createRef } from 'react';
import { fireEvent } from '@testing-library/react';
import { createClient, KnownMembership, MatrixEvent, Room } from 'matrix-js-sdk';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePluginStorage, type PluginEvent } from '@mindroom/client-sdk/core';
import { renderPluginComponent } from '@mindroom/client-sdk/testing';
import plugin from './index';

/**
 * A drag event as the browser fires it, carrying `data` (format to text), which a drag start fills
 * and only a drop can read.
 */
const dragEvent = (type: string, data: Map<string, string>): Event => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      types: [...data.keys()],
      getData: (format: string) => (type === 'drop' ? data.get(format) ?? '' : ''),
      setData: (format: string, text: string) => data.set(format, text),
    },
  });
  return event;
};

const greeting: PluginEvent = {
  sender: '@mindroom_helper:example.org',
  content: { body: 'Hello', 'com.example.greeting': { text: 'Hello' } },
};

describe('example plugin', () => {
  // Its panel asks the client's homeserver whether it binds sign-in tokens to the room's MindRoom
  // server; these rooms have none, so the answer is no.
  beforeEach(() => {
    vi.stubGlobal('fetch', async () => new Response('{}'));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it('shows the greeting a card asked its panel to show; outside a room a card offers none', async () => {
    const [panel] = plugin.sidePanels ?? [];
    if (!panel) throw new Error('the example plugin has no side panel');
    // The panel reads the room's members through the account's client.
    const client = createClient({ baseUrl: 'https://example.org', userId: '@ada:example.org' });
    const view = await renderPluginComponent(
      <panel.Component roomId="!lobby:example.org" request="Hello" />,
      { id: 'example', plugin, client }
    );
    expect(view.getByText('Greeting: Hello')).toBeTruthy();
    expect((await renderGreeting()).queryByRole('button', { name: 'Show in panel' })).toBeNull();
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
    const view = await renderPluginComponent(<Banner room={room} headerRef={{ current: null }} />, {
      id: 'example',
      plugin,
    });
    expect(view.getByText('Example banner in Lobby')).toBeTruthy();
  });

  it("shows in its banner its panel's item dropped on the room's name, and lets a file drag pass", async () => {
    const [panel] = plugin.sidePanels ?? [];
    if (!Banner || !panel) throw new Error('the example plugin has no banner or no side panel');
    const room = { roomId: '!lobby:example.org', name: 'Lobby' } as Room;
    const client = createClient({ baseUrl: 'https://example.org', userId: '@ada:example.org' });
    const headerRef = createRef<HTMLDivElement>();
    // The room's page as the app draws it: the header's row and its slot, and the side panel.
    const view = await renderPluginComponent(
      <>
        <div ref={headerRef}>
          <h1>Lobby</h1>
          <Banner room={room} headerRef={headerRef} />
        </div>
        <panel.Component roomId={room.roomId} />
      </>,
      { id: 'example', plugin, client }
    );
    const name = view.getByRole('heading', { name: 'Lobby' });

    // A drag of files passes untouched, for the composer.
    const files = new Map([['Files', '']]);
    expect(fireEvent(name, dragEvent('dragover', files))).toBe(true);
    expect(fireEvent(name, dragEvent('drop', files))).toBe(true);
    expect(view.queryByText(/^Dropped:/)).toBeNull();
    const carried = new Map<string, string>();
    fireEvent(view.getByText('Example item'), dragEvent('dragstart', carried));
    expect(fireEvent(name, dragEvent('dragenter', carried))).toBe(false);
    expect(fireEvent(name, dragEvent('dragover', carried))).toBe(false);
    expect(fireEvent(name, dragEvent('drop', carried))).toBe(false);
    expect(view.getByText('Dropped: Example item')).toBeTruthy();
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
    // Neither room has a MindRoom server: none published, and none in config.json.
    expect(view.getAllByText('No MindRoom server')).toHaveLength(2);
  });

  it('greets the room or the thread with the text typed after /greet, and asks for some without it', async () => {
    const [greet] = plugin.slashCommands ?? [];
    if (!greet) throw new Error('the example plugin has no slash command');
    const client = createClient({ baseUrl: 'https://example.org', userId: '@ada:example.org' });
    const sent = vi.spyOn(client, 'sendNotice').mockResolvedValue({ event_id: '$greeting' });
    const room = new Room('!lobby:example.org', client, '@ada:example.org');

    await greet.run({ room, args: 'Hello there' });
    expect(sent).toHaveBeenLastCalledWith(
      '!lobby:example.org',
      null,
      'Example greeting: Hello there'
    );
    await greet.run({ room, args: 'Hello thread', threadId: '$root:example.org' });
    expect(sent).toHaveBeenLastCalledWith(
      '!lobby:example.org',
      '$root:example.org',
      'Example greeting: Hello thread'
    );
    await expect(async () => greet.run({ room, args: '  ' })).rejects.toThrow(
      'Type a greeting after /greet.'
    );
    expect(sent).toHaveBeenCalledTimes(2);
  });
});
