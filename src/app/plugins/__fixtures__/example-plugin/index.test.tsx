// @vitest-environment jsdom
// The example plugin's test, written as a plugin outside this repository writes one: it imports the
// app only through the client SDK, `/testing` included, and runs in the app's vitest.
import type { Room } from 'matrix-js-sdk';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
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

  it('keeps values in its storage for the account signed in', async () => {
    function Stored() {
      const storage = usePluginStorage('example');
      const kept = storage.setItem('note', 'kept');
      return <p>{`${String(kept)}: ${storage.getItem('note') ?? 'nothing'}`}</p>;
    }
    const view = await renderPluginComponent(<Stored />, { id: 'example', plugin });
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

  it('links its room page to the room and to its thread under a router', async () => {
    const page = plugin.pages?.find(({ path }) => path === 'rooms/:roomId/:threadId');
    if (!page) throw new Error('the example plugin has no room page');
    const view = await renderPluginComponent(
      <MemoryRouter>
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
});
