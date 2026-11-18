// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientConfig } from '../config/useClientConfig';
import { isMessageLink, useMessageLinkMatcher, type MessageLink } from './messageLinks';
import type { RegisteredPlugin } from './registry';

const Component = (): null => null;
const OtherComponent = (): null => null;
const PULL = 'https://github.com/a/b/pull/1';

const link = (fields: Partial<MessageLink> = {}): MessageLink => ({
  match: () => true,
  Component,
  ...fields,
});

const plugin = (
  id: string,
  messageLinks: MessageLink[],
  sidePanels: RegisteredPlugin['sidePanels'] = []
): RegisteredPlugin => ({
  id,
  tag: `${id}@1.0.0`,
  conversationCovers: [],
  messageRenderers: [],
  pages: [],
  roomHeaderSlot: [],
  threadHeaderSlot: [],
  sidePanels,
  headerActions: [],
  slashCommands: [],
  roomActions: [],
  messageLinks,
  threadCardBadges: [],
  threadDetails: [],
});

const matcher = (plugins: RegisteredPlugin[], config?: ClientConfig) =>
  renderHook(() => useMessageLinkMatcher(plugins, config)).result.current;

describe('useMessageLinkMatcher', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps only well-formed entries', () => {
    expect(isMessageLink(link())).toBe(true);
    expect(isMessageLink({ Component })).toBe(false);
    expect(isMessageLink('https://example.org')).toBe(false);
    expect(isMessageLink({ match: () => true })).toBe(false);
    expect(isMessageLink(null)).toBe(false);
  });

  it('keeps a link whose side panel is an id and a request function, and no other', () => {
    expect(isMessageLink(link({ sidePanel: { id: 'p', request: () => 1 } }))).toBe(true);
    expect(isMessageLink({ ...link(), sidePanel: { id: 3, request: () => 1 } })).toBe(false);
    expect(isMessageLink({ ...link(), sidePanel: { id: 'p' } })).toBe(false);
    expect(isMessageLink({ ...link(), sidePanel: 'p' })).toBe(false);
  });

  it("gives an opted-in link its plugin's panel, under the plugin's id", () => {
    const request = (url: URL) => url.pathname;
    const panels = [{ id: 'p', label: 'P', Component }];
    const cards = matcher([
      plugin(
        'a',
        [
          link({ match: (url) => url.host === 'github.com', sidePanel: { id: 'p', request } }),
          link(),
        ],
        panels
      ),
    ]);
    expect(cards(PULL)?.sidePanel).toEqual({ id: 'a/p', request });
    expect(cards('https://other.example/x')).toEqual({ tag: 'a@1.0.0', Component });
  });

  it('gives no panel to a link that names one its plugin does not have', () => {
    const cards = matcher([
      plugin(
        'a',
        [link({ sidePanel: { id: 'missing', request: () => 1 } })],
        [{ id: 'p', label: 'P', Component }]
      ),
    ]);
    expect(cards(PULL)).toEqual({ tag: 'a@1.0.0', Component });
  });

  it('takes the first match in build order', () => {
    const cards = matcher([
      plugin('a', [link({ match: () => false }), link({ match: () => false })]),
      plugin('b', [link({ Component: OtherComponent }), link()]),
      plugin('c', [link()]),
    ]);
    expect(cards(PULL)).toEqual({ tag: 'b@1.0.0', Component: OtherComponent });
  });

  it('returns nothing when no entry matches', () => {
    expect(matcher([plugin('a', [link({ match: () => false })])])(PULL)).toBeUndefined();
  });

  it('skips a plugin config.json turns off', () => {
    const config = { plugins: { a: { enabled: false } } } as unknown as ClientConfig;
    const cards = matcher(
      [plugin('a', [link()]), plugin('b', [link({ Component: OtherComponent })])],
      config
    );
    expect(cards(PULL)?.tag).toBe('b@1.0.0');
  });

  it('treats a throwing match as none and logs the tag', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failure = new Error('no');
    const cards = matcher([
      plugin('a', [
        link({
          match: () => {
            throw failure;
          },
        }),
      ]),
      plugin('b', [link()]),
    ]);
    expect(cards(PULL)?.tag).toBe('b@1.0.0');
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('[plugin a@1.0.0]'), failure);
  });

  it('passes only http and https URLs to match', () => {
    const match = vi.fn(() => true);
    const cards = matcher([plugin('a', [link({ match })])]);
    expect(cards('mailto:x@y')).toBeUndefined();
    expect(cards('javascript:alert(1)')).toBeUndefined();
    expect(cards('not a url')).toBeUndefined();
    expect(match).not.toHaveBeenCalled();
    expect(cards(PULL)?.tag).toBe('a@1.0.0');
    expect(match).toHaveBeenCalledTimes(1);
    const [url] = match.mock.calls[0] as unknown as [URL];
    expect(url).toBeInstanceOf(URL);
    expect(url.href).toBe(PULL);
  });
});
