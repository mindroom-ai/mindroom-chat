// @vitest-environment jsdom
// The example plugin's test, written as a plugin outside this repository writes one: it imports the
// app only through the client SDK, `/testing` included, and runs in the app's vitest.
import { createRef, type ReactNode } from 'react';
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { createClient, KnownMembership, MatrixEvent, Room } from 'matrix-js-sdk';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commandUsage,
  usePluginStorage,
  type PanelFrame,
  type PluginEvent,
} from '@mindroom/client-sdk/core';
import { renderPluginComponent } from '@mindroom/client-sdk/testing';
import type { PanelPresence, SurfacePinch } from '@mindroom/client-sdk/ui';
import plugin from './index';

// jsdom lays nothing out, so a focus trap finds nothing it could focus and throws; its menu's trap
// runs in the browser (e2e/plugins/ui.spec.ts).
vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));

// The room's panel place around the card and the screen size, which the app provides; outside it
// there is no place, and the size is the SDK's own answer.
// The pinches the app's page zoom hands its board go to the `onPinch` it gave last.
const place = vi.hoisted(() => ({
  presence: undefined as PanelPresence | undefined,
  screenSize: undefined as 'Desktop' | 'Mobile' | undefined,
  onPinch: undefined as ((pinch: SurfacePinch) => void) | undefined,
}));
// The thread the room's page shows and the thread panel's controls, which the room provides, and the
// thread itself, which is the app's (e2e/plugins/agent-thread-view.spec.ts).
const roomPage = vi.hoisted(() => ({
  thread: undefined as string | undefined,
  closeThreadPanel: undefined as (() => void) | undefined,
}));
vi.mock('@mindroom/client-sdk/core', async (importOriginal) => {
  const core = await importOriginal<typeof import('@mindroom/client-sdk/core')>();
  return {
    ...core,
    useRoomSidePanel: (pluginId: string, panelId: string) => {
      const control = core.useRoomSidePanel(pluginId, panelId);
      const close = panelId === 'thread' ? roomPage.closeThreadPanel : undefined;
      return close
        ? { isOpen: true, open: () => undefined, openBesideThread: () => undefined, close }
        : control;
    },
  };
});
vi.mock('@mindroom/client-sdk/room', async (importOriginal) => {
  const sdk = await importOriginal<typeof import('@mindroom/client-sdk/room')>();
  return {
    ...sdk,
    useShownThread: () => {
      const shown = sdk.useShownThread();
      return roomPage.thread ?? shown;
    },
    ThreadView: ({ room: { roomId }, threadId }: { room: Room; threadId: string }) => (
      <button type="button">{`Thread ${threadId} of ${roomId}`}</button>
    ),
  };
});
vi.mock('@mindroom/client-sdk/ui', async (importOriginal) => {
  const ui = await importOriginal<typeof import('@mindroom/client-sdk/ui')>();
  return {
    ...ui,
    usePanelPresence: () => place.presence,
    usePinchSurface: (...args: Parameters<typeof ui.usePinchSurface>) => {
      place.onPinch = args[1].onPinch;
      ui.usePinchSurface(...args);
    },
    useScreenSize: () => place.screenSize ?? ui.useScreenSize(),
  };
});

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

/** The greeting's message in the room !lobby:example.org, as the homeserver answers for it. */
const fetchedGreeting = {
  event_id: '$greeting',
  room_id: '!lobby:example.org',
  type: 'm.room.message',
  sender: greeting.sender,
  content: { ...greeting.content },
};

describe('example plugin', () => {
  // Its panel asks the client's homeserver through `fetch` whether it binds sign-in tokens; the
  // stub keeps that off the network, and its answer counts as no.
  beforeEach(() => {
    vi.stubGlobal('fetch', async () => new Response('{}'));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    roomPage.thread = undefined;
    roomPage.closeThreadPanel = undefined;
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

  it("previews a greeting on one line in the app's language, and nothing else", async () => {
    await renderGreeting();
    expect(renderer?.preview?.(greeting)).toBe('Greeting: Hello');
    await renderGreeting({ language: 'de' });
    expect(renderer?.preview?.(greeting)).toBe('Gruß: Hello');
    expect(renderer?.preview?.({ ...greeting, content: { body: 'Hello' } })).toBeUndefined();
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

  it('shows the greeting of the message a card asked its panel to show, which it reads itself; outside a room a card offers none', async () => {
    const [panel] = plugin.sidePanels ?? [];
    if (!panel) throw new Error('the example plugin has no side panel');
    // The panel reads the room's members and the greeting's message through the account's client.
    const client = createClient({ baseUrl: 'https://example.org', userId: '@ada:example.org' });
    const fetched = vi.spyOn(client, 'fetchRoomEvent').mockResolvedValue(fetchedGreeting);
    const view = await renderPluginComponent(
      <panel.Component roomId="!lobby:example.org" request="$greeting" />,
      { id: 'example', plugin, client }
    );
    await waitFor(() =>
      expect(
        view.container.querySelector('[data-example-plugin-greeting]')?.textContent?.trim()
      ).toBe('Greeting: Hello')
    );
    expect(fetched).toHaveBeenCalledWith('!lobby:example.org', '$greeting');
    expect((await renderGreeting()).queryByRole('button', { name: 'Show in panel' })).toBeNull();
  });

  it('shows in its thread panel the thread the room showed as it opened, kept after, which an Escape nothing took closes', async () => {
    const panel = plugin.sidePanels?.find(({ id }) => id === 'thread');
    if (!panel) throw new Error('the example plugin has no thread panel');
    const client = createClient({ baseUrl: 'https://example.org', userId: '@ada:example.org' });
    client.store.storeRoom(new Room('!lobby:example.org', client, '@ada:example.org'));
    // A new element each time, so that a rerender renders the panel again.
    const ui = () => <panel.Component roomId="!lobby:example.org" />;
    const options = { id: 'example', plugin, client };
    expect((await renderPluginComponent(ui(), options)).container.textContent).toBe(
      'No example thread'
    );
    cleanup();

    roomPage.thread = '$root';
    const close = vi.fn();
    roomPage.closeThreadPanel = close;
    const view = await renderPluginComponent(ui(), options);
    const thread = view.getByRole('button', { name: 'Thread $root of !lobby:example.org' });
    roomPage.thread = '$other';
    view.rerender(ui());
    expect(view.getByRole('button', { name: 'Thread $root of !lobby:example.org' })).toBe(thread);

    // A menu of the thread, or a profile card, takes its Escape at the document.
    const takeEscape = (event: KeyboardEvent) => event.stopPropagation();
    document.addEventListener('keydown', takeEscape);
    fireEvent.keyDown(thread, { key: 'Escape' });
    document.removeEventListener('keydown', takeEscape);
    expect(close).not.toHaveBeenCalled();
    // One outside the panel is not the panel's.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(close).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(thread, { key: 'Escape' })).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("names its greeting's sender as the app names them in the room, apart from a member of the same name, and shows the account's own profile card", async () => {
    const [panel] = plugin.sidePanels ?? [];
    if (!panel) throw new Error('the example plugin has no side panel');
    const userId = '@ada:example.org';
    const client = createClient({ baseUrl: 'https://example.org', userId });
    const room = new Room('!lobby:example.org', client, userId);
    room.currentState.setStateEvents(
      [
        [userId, 'Ada Lovelace'],
        [greeting.sender, 'Helper'],
        ['@helper:example.org', 'Helper'],
      ].map(
        ([member, displayname]) =>
          new MatrixEvent({
            type: 'm.room.member',
            room_id: room.roomId,
            sender: member,
            state_key: member,
            content: { membership: KnownMembership.Join, displayname },
          })
      )
    );
    client.store.storeRoom(room);
    vi.spyOn(client, 'fetchRoomEvent').mockResolvedValue(fetchedGreeting);
    const view = await renderPluginComponent(
      <MemoryRouter>
        <panel.Component roomId={room.roomId} request="$greeting" />
      </MemoryRouter>,
      { id: 'example', plugin, client }
    );
    // The name is a button, which opens the app's floating card of the sender.
    expect(
      await view.findByRole('button', { name: `Helper (\u2066${greeting.sender}\u2069)` })
    ).toBeTruthy();
    // The card the app shows for the account, in the panel itself.
    expect(view.getByRole('heading', { name: 'Ada Lovelace' })).toBeTruthy();
    expect(view.getByText(userId)).toBeTruthy();
    expect(view.queryByRole('dialog')).toBeNull();
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
    // Its build module, which writes "Example banner" in place of the marker, runs in the unit tests
    // only while MINDROOM_CLIENT_PLUGINS lists the plugin, and then in this file too.
    expect(view.getByText('EXAMPLE_BANNER in Lobby')).toBeTruthy();
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
    // The panel shows the account's profile card in each room, which needs a router.
    const view = await renderPluginComponent(
      <MemoryRouter>
        <panel.Component roomId="!agent:example.org" />
        <panel.Component roomId="!people:example.org" />
      </MemoryRouter>,
      { id: 'example', plugin, client }
    );
    expect(view.getByText('Members: 2, with a MindRoom agent')).toBeTruthy();
    expect(view.getByText('Members: 3, without a MindRoom agent')).toBeTruthy();
    // Neither room has a MindRoom server: none published, and none in config.json.
    expect(await view.findAllByText('No MindRoom server')).toHaveLength(2);
  });

  it("lists its room's agents with a computer, and opens, shows and ends a session on one", async () => {
    const [panel] = plugin.sidePanels ?? [];
    if (!panel) throw new Error('the example plugin has no side panel');
    const userId = '@ada:example.org';
    const agent = '@mindroom_helper:example.org';
    const api = 'https://mindroom.example.org';
    const client = createClient({ baseUrl: 'https://example.org', userId });
    const room = new Room('!computer:example.org', client, userId);
    const state = (type: string, sender: string, content: Record<string, unknown>) =>
      new MatrixEvent({ type, room_id: room.roomId, sender, state_key: sender, content });
    // The agent's MindRoom has a computer, and the homeserver binds sign-in tokens to it.
    room.currentState.setStateEvents([
      state('m.room.member', userId, { membership: KnownMembership.Join }),
      state('m.room.member', agent, { membership: KnownMembership.Join }),
      state('io.mindroom.server', agent, { api_origin: api, computer: true }),
    ]);
    client.store.storeRoom(room);
    let created: (answer: Response) => void = () => undefined;
    let opening: AbortSignal | null | undefined;
    const sent: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url.endsWith('/_matrix/client/versions')) {
        return Response.json({
          versions: ['v1.11'],
          unstable_features: { 'io.mindroom.openid_audience': true },
        });
      }
      if (url.includes('/openid/request_token')) {
        return Response.json({ access_token: 'openid', matrix_server_name: 'example.org' });
      }
      // The panel's other parts (its server greeting, the profile card) get no answer.
      if (!url.startsWith(`${api}/api/computers/`)) return new Response(null, { status: 404 });
      sent.push(`${init.method} ${url}`);
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      opening = init.signal;
      return new Promise<Response>((resolve) => {
        created = resolve;
      });
    });
    const view = await renderPluginComponent(
      <MemoryRouter>
        <panel.Component roomId={room.roomId} />
      </MemoryRouter>,
      { id: 'example', plugin, client }
    );

    await view.findByText(`Agents with a computer: ${agent}`);
    const openButton = view.getByRole('button', { name: `Open computer of ${agent}` });
    fireEvent.click(openButton);
    await view.findByText('Computer session: starting');
    // A second session cannot start while the first one does.
    expect(openButton).toHaveProperty('disabled', true);
    await waitFor(() => expect(sent).toEqual([`POST ${api}/api/computers/sessions`]));
    created(
      Response.json({
        session_id: 's1',
        session_token: 'viewer',
        state: 'ready',
        mode: 'view',
        expires_at: 2,
      })
    );
    await view.findByText('Computer session: ready, view');
    fireEvent.click(view.getByRole('button', { name: 'End computer session' }));
    await view.findByText('Computer session: ended');
    expect(sent.at(-1)).toBe(`DELETE ${api}/api/computers/sessions/s1`);

    // A session still opening as the panel goes is called off.
    fireEvent.click(openButton);
    await waitFor(() => expect(sent).toHaveLength(3));
    view.unmount();
    expect(opening?.aborted).toBe(true);
    // One the server still gives then ends at once.
    created(
      Response.json({ session_id: 's2', session_token: 'late', state: 'ready', mode: 'view' })
    );
    await waitFor(() => expect(sent.at(-1)).toBe(`DELETE ${api}/api/computers/sessions/s2`));
  });

  it("says in its own-frame card the app's theme kind and screen size, and previews a PDF it builds", async () => {
    const card = plugin.sidePanels?.find(({ id }) => id === 'card');
    if (!card) throw new Error('the example plugin has no card');
    const objectUrl = 'blob:https://example.org/0b5e-4c1d';
    const created: Blob[] = [];
    const revoked: string[] = [];
    // jsdom makes no object URLs.
    vi.stubGlobal(
      'URL',
      class extends URL {
        static override createObjectURL = (blob: Blob) => {
          created.push(blob);
          return objectUrl;
        };

        static override revokeObjectURL = (url: string) => {
          revoked.push(url);
        };
      }
    );
    const view = await renderPluginComponent(<card.Component roomId="!lobby:example.org" />, {
      id: 'example',
      plugin,
      frame: { label: 'Example card', layout: 'beside', setLayout: () => undefined },
    });
    // Outside the app no theme is on the page and nothing lays out by size: light, and Desktop.
    expect(view.getByText('Theme: light')).toBeTruthy();
    expect(view.getByText('Screen: Desktop')).toBeTruthy();

    fireEvent.click(view.getByRole('button', { name: 'Show example PDF' }));
    expect(created.map(({ type }) => type)).toEqual(['application/pdf']);
    expect(view.getByTitle('Example PDF').getAttribute('src')).toBe(
      `/pdf-frame.html#${encodeURIComponent(objectUrl)}`
    );
    view.unmount();
    expect(revoked).toEqual([objectUrl]);
  });

  it("scales its pinch board's box around the centre of each pinch the app hands it", async () => {
    const card = plugin.sidePanels?.find(({ id }) => id === 'card');
    if (!card) throw new Error('the example plugin has no card');
    const view = await renderPluginComponent(<card.Component roomId="!lobby:example.org" />, {
      id: 'example',
      plugin,
      frame: { label: 'Example card', layout: 'beside', setLayout: () => undefined },
    });
    const board = view.getByRole('group', { name: 'Example pinch board' });
    const box = board.firstElementChild as HTMLElement;
    // The page zoom leaves the board's pinches to it.
    expect(board.hasAttribute('data-pinch-surface')).toBe(true);
    const pinch = (phase: SurfacePinch['phase'], scale: number, x: number, y: number) =>
      act(() => place.onPinch?.({ phase, scale, centre: { x, y } }));

    // jsdom lays nothing out: the board's corner is at 0, 0. Around the box's middle, twice the
    // size, its middle where it was.
    pinch('start', 1, 30, 30);
    pinch('move', 2, 30, 30);
    expect(view.getByText('Pinching')).toBeTruthy();
    pinch('end', 2, 30, 30);
    expect(view.queryByText('Pinching')).toBeNull();
    expect(view.getByText('Box scale: 2.00')).toBeTruthy();
    expect(box.style.transform).toBe('translate(-30px, -30px) scale(2)');

    // The next pinch goes on from there: half the size around the board's corner, moved by 10 px.
    pinch('start', 1, 0, 0);
    pinch('move', 0.5, 10, 10);
    pinch('end', 0.5, 10, 10);
    expect(view.getByText('Box scale: 1.00')).toBeTruthy();
    expect(box.style.transform).toBe('translate(-5px, -5px) scale(1)');
  });

  it.each([
    ['beside the conversation', 'beside', 'Desktop', true],
    ['filling the room', 'filled', 'Desktop', false],
    ['on a phone', 'beside', 'Mobile', false],
  ] as const)(
    "registers its own-frame card with the room's panel place and closes it %s, moving it out first and handing on its width only beside the conversation",
    async (_where, layout, screenSize, moves) => {
      const card = plugin.sidePanels?.find(({ id }) => id === 'card');
      if (!card) throw new Error('the example plugin has no card');
      // jsdom lays nothing out and has no Web Animations: the card's box is 336 px wide on the page
      // (none off it), and its motion ends when the test says.
      const offsetWidth = vi
        .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
        .mockImplementation(function width(this: HTMLElement) {
          return this.isConnected ? 336 : 0;
        });
      let finish = () => {};
      const animate = vi.fn(() => ({
        playState: 'running',
        cancel: () => undefined,
        finished: new Promise<void>((resolve) => {
          finish = resolve;
        }),
      }));
      Object.defineProperty(HTMLElement.prototype, 'animate', {
        value: animate,
        configurable: true,
      });
      // Called, it unregisters; its own `done` is the one the card calls.
      const unregister = Object.assign(vi.fn(), { done: vi.fn() });
      const presence: PanelPresence = {
        phase: 'shown',
        register: vi.fn(() => unregister),
        done: vi.fn(),
        lastWidth: { current: undefined },
      };
      place.presence = presence;
      place.screenSize = screenSize;
      try {
        const ui = () => <card.Component roomId="!lobby:example.org" />;
        const frame: PanelFrame = {
          label: 'Example card',
          layout: 'folded',
          setLayout: () => undefined,
        };
        const view = await renderPluginComponent(ui(), { id: 'example', plugin, frame });
        expect(presence.register).toHaveBeenCalledTimes(1);
        // Shown from its tab, the card has its box, and moves if it does, only from now on.
        frame.layout = layout;
        view.rerender(ui());
        place.presence = { ...presence, phase: 'exit' };
        view.rerender(ui());
        expect(animate).toHaveBeenCalledTimes(moves ? 1 : 0);
        expect(unregister.done).toHaveBeenCalledTimes(moves ? 0 : 1);
        await act(async () => finish());
        expect(unregister.done).toHaveBeenCalledTimes(1);
        expect(presence.done).not.toHaveBeenCalled();
        view.unmount();
        expect(unregister).toHaveBeenCalledTimes(1);
        // A panel that takes its place moves on from the width of its box on the page, if it moved.
        expect(presence.lastWidth.current).toBe(moves ? 336 : undefined);
      } finally {
        place.presence = undefined;
        place.screenSize = undefined;
        delete (HTMLElement.prototype as { animate?: unknown }).animate;
        offsetWidth.mockRestore();
      }
    }
  );

  it("says in its panel whether the account may post in the room, from the room's levels", async () => {
    const [panel] = plugin.sidePanels ?? [];
    if (!panel) throw new Error('the example plugin has no side panel');
    const userId = '@ada:example.org';
    const client = createClient({ baseUrl: 'https://example.org', userId });
    // An open room, and one where only moderators post; in both, only moderators change its state.
    const addRoom = (roomId: string, messageLevel: number) => {
      const room = new Room(roomId, client, userId);
      room.currentState.setStateEvents([
        new MatrixEvent({
          type: 'm.room.power_levels',
          room_id: roomId,
          sender: '@moderator:example.org',
          state_key: '',
          content: {
            users: { '@moderator:example.org': 50 },
            events_default: messageLevel,
            state_default: 50,
          },
        }),
      ]);
      client.store.storeRoom(room);
    };
    addRoom('!open:example.org', 0);
    addRoom('!announcements:example.org', 50);
    const view = await renderPluginComponent(
      <MemoryRouter>
        <panel.Component roomId="!open:example.org" />
        <panel.Component roomId="!announcements:example.org" />
      </MemoryRouter>,
      { id: 'example', plugin, client }
    );
    expect(view.getByText('You may post here')).toBeTruthy();
    expect(view.getByText('You may not post here')).toBeTruthy();
  });

  it("shows a greeting's sender with their avatar in the room, marked when they are an agent", async () => {
    if (!renderer) throw new Error('the example plugin has no message renderer');
    const userId = '@ada:example.org';
    const client = createClient({ baseUrl: 'https://example.org', userId });
    const room = new Room('!lobby:example.org', client, userId);
    const member = (memberId: string, avatarUrl?: string) =>
      new MatrixEvent({
        type: 'm.room.member',
        room_id: room.roomId,
        sender: memberId,
        state_key: memberId,
        content: { membership: KnownMembership.Join, avatar_url: avatarUrl },
      });
    room.currentState.setStateEvents([
      member(greeting.sender, 'mxc://example.org/helper'),
      member('@bob:example.org'),
    ]);
    client.store.storeRoom(room);
    const inRoom = { ...greeting, roomId: room.roomId };
    const view = await renderPluginComponent(
      <>
        <renderer.Component event={inRoom} />
        <renderer.Component event={{ ...inRoom, sender: '@bob:example.org' }} />
      </>,
      { id: 'example', plugin, client }
    );
    const agent = view.getByText('From @mindroom_helper:example.org, a MindRoom agent');
    // A test knows neither the homeserver's versions nor a service worker, so its media is the
    // unauthenticated kind.
    expect(agent.querySelector('img')?.getAttribute('src')).toBe(
      'https://example.org/_matrix/media/v3/thumbnail/example.org/helper?width=32&height=32&method=crop'
    );
    expect(view.getByText('From @bob:example.org').querySelector('img')).toBeNull();
  });

  it('greets the room or the thread with the text typed after /greet, and refuses with its usage without it', async () => {
    const greet = plugin.slashCommands?.find(({ name }) => name === 'greet');
    if (!greet) throw new Error('the example plugin has no /greet');
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
    await expect(async () => greet.run({ room, args: '  ' })).rejects.toStrictEqual(commandUsage());
    expect(sent).toHaveBeenCalledTimes(2);
  });

  it('creates a sub-room of the room called the name typed after /subroom, and refuses with its usage without it', async () => {
    const subroom = plugin.slashCommands?.find(({ name }) => name === 'subroom');
    if (!subroom) throw new Error('the example plugin has no /subroom');
    const client = createClient({ baseUrl: 'https://example.org', userId: '@ada:example.org' });
    const created = vi
      .spyOn(client, 'createRoom')
      .mockResolvedValue({ room_id: '!ideas:example.org' });
    const listed = vi.spyOn(client, 'sendStateEvent').mockResolvedValue({ event_id: '$child' });
    const room = new Room('!lobby:example.org', client, '@ada:example.org');
    // The app provides its configuration to what it renders, and to createSubRoom.
    await renderPluginComponent(<></>, { id: 'example', plugin });

    await subroom.run({ room, args: 'Ideas' });
    expect(created).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ideas' }));
    expect(listed).toHaveBeenCalledWith(
      '!lobby:example.org',
      'm.space.child',
      expect.anything(),
      '!ideas:example.org'
    );
    await expect(async () => subroom.run({ room, args: '  ' })).rejects.toStrictEqual(
      commandUsage()
    );
    expect(created).toHaveBeenCalledTimes(1);
  });

  it('refuses /subroom in a space, where the room menu offers no New Sub-room, and creates nothing', async () => {
    const subroom = plugin.slashCommands?.find(({ name }) => name === 'subroom');
    if (!subroom) throw new Error('the example plugin has no /subroom');
    const userId = '@ada:example.org';
    const client = createClient({ baseUrl: 'https://example.org', userId });
    const created = vi.spyOn(client, 'createRoom');
    const space = new Room('!estate:example.org', client, userId);
    space.currentState.setStateEvents([
      new MatrixEvent({
        type: 'm.room.create',
        room_id: space.roomId,
        sender: userId,
        state_key: '',
        content: { type: 'm.space' },
      }),
    ]);
    await renderPluginComponent(<></>, { id: 'example', plugin });

    await expect(async () => subroom.run({ room: space, args: 'Ideas' })).rejects.toThrow(
      'Sub-rooms go in chat rooms, not in spaces or direct chats.'
    );
    expect(created).not.toHaveBeenCalled();
  });

  it("sets the room's topic to the text typed after /topic once the room's levels let the account, and refuses before", async () => {
    const topic = plugin.slashCommands?.find(({ name }) => name === 'topic');
    if (!topic) throw new Error('the example plugin has no /topic');
    const userId = '@ada:example.org';
    const client = createClient({ baseUrl: 'https://example.org', userId });
    const set = vi.spyOn(client, 'setRoomTopic').mockResolvedValue({ event_id: '$topic' });
    const room = new Room('!lobby:example.org', client, userId);
    const levels = (level: number) =>
      new MatrixEvent({
        type: 'm.room.power_levels',
        room_id: room.roomId,
        sender: '@moderator:example.org',
        state_key: '',
        content: { users: { '@moderator:example.org': 50, [userId]: level }, state_default: 50 },
      });

    room.currentState.setStateEvents([levels(0)]);
    await expect(async () => topic.run({ room, args: 'Plans' })).rejects.toThrow(
      "You may not change this room's topic."
    );
    expect(set).not.toHaveBeenCalled();
    // A moderator raised the account's level.
    room.currentState.setStateEvents([levels(50)]);
    await topic.run({ room, args: 'Plans' });
    expect(set).toHaveBeenCalledWith('!lobby:example.org', 'Plans');
  });

  it("draws its panel's rows, menu and dialog with the app's own pieces from the ui subpath", async () => {
    const [panel] = plugin.sidePanels ?? [];
    if (!panel) throw new Error('the example plugin has no side panel');
    const userId = '@ada:example.org';
    const client = createClient({ baseUrl: 'https://example.org', userId });
    const room = new Room('!lobby:example.org', client, userId);
    room.name = 'Lobby';
    client.store.storeRoom(room);
    const view = await renderPluginComponent(
      <MemoryRouter>
        <panel.Component roomId={room.roomId} />
      </MemoryRouter>,
      { id: 'example', plugin, client }
    );
    // Its rows mark the chosen one as the sidebar marks the open room.
    const row = view.getByRole('button', { name: 'Second example row' });
    fireEvent.click(row);
    expect(row.getAttribute('aria-current')).toBe('true');
    expect(
      view.getByRole('button', { name: 'First example row' }).getAttribute('aria-current')
    ).toBe(null);

    // The app's test setup draws the glass menu as folds' plain one, without the `menu` and
    // `menuitem` roles the browser shows (e2e/plugins/ui.spec.ts), so the entries go by their text.
    const menuButton = view.getByRole('button', { name: 'Example menu' });
    expect(view.queryByText('Show example dialog')).toBeNull();
    fireEvent.click(menuButton);
    expect(menuButton.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(view.getByText('Clear example selection'));
    expect(view.queryByText('Show example dialog')).toBeNull();
    expect(row.getAttribute('aria-current')).toBe(null);

    fireEvent.click(menuButton);
    fireEvent.click(view.getByText('Show example dialog'));
    expect(view.queryByText('Clear example selection')).toBeNull();
    expect(view.getByRole('dialog', { name: 'Example dialog' }).textContent).toContain(
      'Example dialog of Lobby'
    );
    fireEvent.click(view.getByRole('button', { name: 'Close example dialog' }));
    expect(view.queryByRole('dialog')).toBeNull();
  });

  it("lists its room entry in every room's menu but a space's, and its dialog names the room", async () => {
    const [info] = plugin.roomActions ?? [];
    if (!info) throw new Error('the example plugin has no room action');
    const client = createClient({ baseUrl: 'https://example.org', userId: '@ada:example.org' });
    const room = new Room('!lobby:example.org', client, '@ada:example.org');
    room.name = 'Lobby';
    expect(info.shows?.(room)).toBe(true);
    expect(info.shows?.({ ...room, isSpaceRoom: () => true } as Room)).toBe(false);

    const showDialog = vi.fn();
    await info.run({ room, showDialog });
    const close = vi.fn();
    const view = await renderPluginComponent(<>{showDialog.mock.calls[0]?.[0](close)}</>, {
      id: 'example',
      plugin,
    });
    expect(view.getByRole('dialog', { name: 'Example dialog' }).textContent).toContain(
      'Example dialog of Lobby'
    );
    view.getByRole('button', { name: 'Close example dialog' }).click();
    expect(close).toHaveBeenCalled();
  });

  it('takes the links of example.org items for its message link', () => {
    const [link] = plugin.messageLinks ?? [];
    if (!link) throw new Error('the example plugin has no message link');
    expect(link.match(new URL('https://example.org/items/7'))).toBe(true);
    expect(link.match(new URL('https://example.org/items/7/x'))).toBe(false);
    expect(link.match(new URL('https://example.com/items/7'))).toBe(false);
  });

  it('names the item in its link card', async () => {
    const [link] = plugin.messageLinks ?? [];
    if (!link) throw new Error('the example plugin has no message link');
    const view = await renderPluginComponent(
      <link.Component
        href="https://example.org/items/7"
        roomId="!lobby:example.org"
        close={vi.fn()}
      />,
      { id: 'example', plugin }
    );
    expect(view.getByText('Example item 7')).toBeTruthy();
  });
});
