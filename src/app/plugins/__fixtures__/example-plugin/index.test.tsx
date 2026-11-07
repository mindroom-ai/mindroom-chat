// @vitest-environment jsdom
// The example plugin's test, written as a plugin outside this repository writes one: it imports the
// app only through the client SDK, `/testing` included, and runs in the app's vitest.
import type { Room } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import type { PluginEvent } from '@mindroom/client-sdk/core';
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

  it('names the open room under the header', async () => {
    if (!Banner) throw new Error('the example plugin has nothing under the room header');
    const room = { roomId: '!lobby:example.org', name: 'Lobby' } as Room;
    const view = await renderPluginComponent(<Banner room={room} />, { id: 'example', plugin });
    expect(view.getByText('Example banner in Lobby')).toBeTruthy();
  });
});
