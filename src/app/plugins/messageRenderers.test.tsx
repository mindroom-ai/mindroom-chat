// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../config/useClientConfig';
import type { RegisteredPlugin } from './registry';
import {
  useMessagePreview,
  useMessageRenderer,
  useMessageRowHidden,
  type MessageRenderer,
  type PluginEvent,
} from './messageRenderers';

const registry = vi.hoisted((): RegisteredPlugin[] => []);
vi.mock('./registry', () => ({ registeredPlugins: registry }));

const VIEWER = '@reader:example.org';
const AGENT = '@mindroom_helper:example.org';

const plugin = (id: string, ...messageRenderers: MessageRenderer[]): RegisteredPlugin => ({
  id,
  tag: `${id}@1.0.0`,
  messageRenderers,
  pages: [],
  roomHeaderSlot: [],
  conversationCovers: [],
  sidePanels: [],
  headerActions: [],
  slashCommands: [],
  roomActions: [],
  messageLinks: [],
});

const renderer = (overrides: Partial<MessageRenderer> = {}): MessageRenderer => ({
  match: () => true,
  Component: () => null,
  ...overrides,
});

const message = (sender: string): PluginEvent => ({ sender, content: { body: 'Hello' } });

const withConfig =
  (config: ClientConfig) =>
  ({ children }: { children: ReactNode }) =>
    <ClientConfigProvider value={config}>{children}</ClientConfigProvider>;

/** The renderer the hook picks for `event`, as `viewer` (null: signed out) with `config`. */
const pick = (
  event: PluginEvent | undefined,
  config: ClientConfig = {},
  viewer: string | null = VIEWER
) =>
  renderHook(() => useMessageRenderer(event, viewer ?? undefined), {
    wrapper: withConfig(config),
  }).result.current;

/** The preview the hook gives `event`, as the viewer with `config`. */
const previewOf = (event: PluginEvent, config: ClientConfig = {}) =>
  renderHook(() => useMessagePreview(event, VIEWER), { wrapper: withConfig(config) }).result
    .current;

/** Whether the timeline leaves `event` without a row, as the viewer with `config`. */
const hiddenOf = (event: PluginEvent, config: ClientConfig = {}) => {
  const test = renderHook(() => useMessageRowHidden(VIEWER), { wrapper: withConfig(config) }).result
    .current;
  expect(test).toBeDefined();
  return test?.(event);
};

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
    expect(pick(event)).toEqual({ id: 'alpha', tag: 'alpha@1.0.0', renderer: only });
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
    expect(pick(message(AGENT))).toEqual({ id: 'alpha', tag: 'alpha@1.0.0', renderer: first });
  });

  it('skips the renderers of a plugin config.json turns off', () => {
    const on = renderer();
    registry.push(plugin('alpha', renderer()), plugin('beta', on));
    const config = { plugins: { alpha: { enabled: false } } } as unknown as ClientConfig;
    expect(pick(message(AGENT), config)).toEqual({ id: 'beta', tag: 'beta@1.0.0', renderer: on });
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

describe('useMessagePreview', () => {
  it("gives the matching renderer's text on one line, cut, direction controls written out", () => {
    const preview = vi.fn(() => `  Greeting:\n\t Hello \u202Eworld ${'x'.repeat(300)}`);
    registry.push(plugin('alpha', renderer({ preview })));
    const event = message(AGENT);
    const text = previewOf(event);
    expect(preview).toHaveBeenCalledWith(event);
    expect(text?.startsWith('Greeting: Hello <U+202E>world xxx')).toBe(true);
    // Cut to 240 characters before the control is written out (7 characters longer).
    expect(text).toHaveLength(240 + '<U+202E>'.length - 1);
  });

  it('asks no preview of a sender the renderer does not trust', () => {
    const preview = vi.fn(() => 'Card');
    registry.push(plugin('alpha', renderer({ preview })));
    expect(previewOf(message('@person:example.org'))).toBeUndefined();
    registry.splice(0, 1, plugin('alpha', renderer({ trust: 'server', preview })));
    expect(previewOf(message('@person:other.org'))).toBeUndefined();
    expect(preview).not.toHaveBeenCalled();
  });

  it('asks no preview when match declines or config.json turns the plugin off', () => {
    const preview = vi.fn(() => 'Card');
    registry.push(plugin('alpha', renderer({ match: () => false, preview })));
    expect(previewOf(message(AGENT))).toBeUndefined();
    registry.splice(0, 1, plugin('alpha', renderer({ preview })));
    const off = { plugins: { alpha: { enabled: false } } } as unknown as ClientConfig;
    expect(previewOf(message(AGENT), off)).toBeUndefined();
    expect(preview).not.toHaveBeenCalled();
  });

  it('gives no text for a preview that throws or gives no string, each logged once, or a blank one', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    registry.push(
      plugin(
        'alpha',
        renderer({
          preview: () => {
            throw new Error('boom');
          },
        })
      )
    );
    expect(previewOf(message(AGENT))).toBeUndefined();
    expect(previewOf(message(AGENT))).toBeUndefined();
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0]?.[0]).toContain(
      "[plugin alpha@1.0.0] a message renderer's preview failed"
    );
    // A result that is no string is logged once too; undefined and a blank text are not.
    registry.splice(0, 1, plugin('beta', renderer({ preview: () => 42 as unknown as string })));
    expect(previewOf(message(AGENT))).toBeUndefined();
    expect(previewOf(message(AGENT))).toBeUndefined();
    expect(logged).toHaveBeenCalledTimes(2);
    expect(logged.mock.calls[1]?.[0]).toContain(
      "[plugin beta@1.0.0] a message renderer's preview failed"
    );
    registry.splice(0, 1, plugin('gamma', renderer({ preview: () => undefined })));
    expect(previewOf(message(AGENT))).toBeUndefined();
    registry.splice(0, 1, plugin('gamma', renderer({ preview: () => ' \n ' })));
    expect(previewOf(message(AGENT))).toBeUndefined();
    expect(logged).toHaveBeenCalledTimes(2);
  });

  it("keeps the app's text when the renderer that takes the message has no preview", () => {
    const later = vi.fn(() => 'Card');
    registry.push(plugin('alpha', renderer()), plugin('beta', renderer({ preview: later })));
    expect(previewOf(message(AGENT))).toBeUndefined();
    expect(later).not.toHaveBeenCalled();
  });
});

describe('useMessageRowHidden', () => {
  it('gives no test when no renderer of the build has hidden', () => {
    registry.push(plugin('alpha', renderer()));
    expect(renderHook(() => useMessageRowHidden(VIEWER)).result.current).toBeUndefined();
  });

  it('hides the row of a message the renderer takes when its hidden says so', () => {
    const hidden = vi.fn(() => true);
    registry.push(plugin('alpha', renderer({ hidden })));
    const event = message(AGENT);
    expect(hiddenOf(event)).toBe(true);
    expect(hidden).toHaveBeenCalledWith(event);
  });

  it('keeps the row when hidden says no or gives anything but true', () => {
    registry.push(plugin('alpha', renderer({ hidden: () => false })));
    expect(hiddenOf(message(AGENT))).toBe(false);
    registry.splice(0, 1, plugin('alpha', renderer({ hidden: () => 'yes' as unknown as boolean })));
    expect(hiddenOf(message(AGENT))).toBe(false);
  });

  it('asks only the renderer the timeline would pick, after the trust check, match and config.json', () => {
    const hidden = vi.fn(() => true);
    registry.push(plugin('alpha', renderer({ hidden })));
    expect(hiddenOf(message('@person:example.org'))).toBe(false);
    const off = { plugins: { alpha: { enabled: false } } } as unknown as ClientConfig;
    expect(hiddenOf(message(AGENT), off)).toBe(false);
    registry.splice(0, 1, plugin('alpha', renderer({ match: () => false, hidden })));
    expect(hiddenOf(message(AGENT))).toBe(false);
    // A renderer before it that takes the message and has no hidden keeps the row.
    registry.splice(0, 1, plugin('alpha', renderer()), plugin('beta', renderer({ hidden })));
    expect(hiddenOf(message(AGENT))).toBe(false);
    expect(hidden).not.toHaveBeenCalled();
  });

  it("🔒 hides only a MindRoom agent's message on the viewer's homeserver, also with trust 'server'", () => {
    const hidden = vi.fn(() => true);
    registry.push(plugin('alpha', renderer({ trust: 'server', hidden })));
    // The renderer takes a person's message, and draws it, but its row stays.
    expect(pick(message('@person:example.org'))?.renderer.hidden).toBe(hidden);
    expect(hiddenOf(message('@person:example.org'))).toBe(false);
    expect(hidden).not.toHaveBeenCalled();
    expect(hiddenOf(message(AGENT))).toBe(true);
  });

  it('keeps the row when hidden throws, and logs it once with the plugin tag', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    registry.push(
      plugin(
        'alpha',
        renderer({
          hidden: () => {
            throw new Error('boom');
          },
        })
      )
    );
    expect(hiddenOf(message(AGENT))).toBe(false);
    expect(hiddenOf(message(AGENT))).toBe(false);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0]?.[0]).toContain(
      "[plugin alpha@1.0.0] a message renderer's hidden failed"
    );
  });
});
