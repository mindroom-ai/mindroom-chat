// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../config/useClientConfig';
import type { RegisteredPlugin } from './registry';
import { useMessageRenderer, type MessageRenderer, type PluginEvent } from './messageRenderers';

const registry = vi.hoisted((): RegisteredPlugin[] => []);
vi.mock('./registry', () => ({ registeredPlugins: registry }));

const VIEWER = '@reader:example.org';
const AGENT = '@mindroom_helper:example.org';

const plugin = (id: string, ...messageRenderers: MessageRenderer[]): RegisteredPlugin => ({
  id,
  tag: `${id}@1.0.0`,
  messageRenderers,
  sidePanels: [],
});

const renderer = (overrides: Partial<MessageRenderer> = {}): MessageRenderer => ({
  match: () => true,
  Component: () => null,
  ...overrides,
});

const message = (sender: string): PluginEvent => ({ sender, content: { body: 'Hello' } });

/** The renderer the hook picks for `event`, as `viewer` (null: signed out) with `config`. */
const pick = (
  event: PluginEvent | undefined,
  config: ClientConfig = {},
  viewer: string | null = VIEWER
) =>
  renderHook(() => useMessageRenderer(event, viewer ?? undefined), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <ClientConfigProvider value={config}>{children}</ClientConfigProvider>
    ),
  }).result.current;

afterEach(() => {
  registry.splice(0);
  vi.restoreAllMocks();
});

describe('useMessageRenderer', () => {
  it("takes a MindRoom agent's message on the viewer's homeserver by default", () => {
    const match = vi.fn(() => true);
    const only = renderer({ match });
    registry.push(plugin('alpha', only));
    const event = message(AGENT);
    expect(pick(event)).toEqual({ tag: 'alpha@1.0.0', renderer: only });
    expect(match).toHaveBeenCalledWith(event);
    // An agent account on another homeserver, and a person on this one.
    expect(pick(message('@mindroom_helper:other.org'))).toBeUndefined();
    expect(pick(message('@person:example.org'))).toBeUndefined();
  });

  it("takes anyone on the viewer's homeserver with trust 'server'", () => {
    const open = renderer({ trust: 'server' });
    registry.push(plugin('alpha', open));
    expect(pick(message('@person:example.org'))?.renderer).toBe(open);
    expect(pick(message(AGENT))?.renderer).toBe(open);
    expect(pick(message('@person:other.org'))).toBeUndefined();
  });

  it('asks the plugins in build order, each in its list order, and takes the first match', () => {
    const declines = renderer({ match: () => false });
    const first = renderer();
    registry.push(plugin('alpha', declines, first), plugin('beta', renderer()));
    expect(pick(message(AGENT))).toEqual({ tag: 'alpha@1.0.0', renderer: first });
  });

  it('skips the renderers of a plugin config.json turns off', () => {
    const on = renderer();
    registry.push(plugin('alpha', renderer()), plugin('beta', on));
    const config = { plugins: { alpha: { enabled: false } } } as unknown as ClientConfig;
    expect(pick(message(AGENT), config)).toEqual({ tag: 'beta@1.0.0', renderer: on });
  });

  it('counts a match that throws as no match, and logs it once with the plugin tag', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const next = renderer();
    registry.push(
      plugin(
        'alpha',
        renderer({
          match: () => {
            throw new Error('boom');
          },
        })
      ),
      plugin('beta', next)
    );
    expect(pick(message(AGENT))?.renderer).toBe(next);
    expect(pick(message(AGENT))?.renderer).toBe(next);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0]?.[0]).toContain('[plugin alpha@1.0.0]');
  });

  it('picks nothing without a message or a signed-in viewer', () => {
    registry.push(plugin('alpha', renderer({ trust: 'server' })));
    expect(pick(undefined)).toBeUndefined();
    expect(pick(message('@person:example.org'), {}, null)).toBeUndefined();
  });
});
