import { memo } from 'react';
import type { Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientConfig } from '../config/useClientConfig';
import type { RegisteredPlugin } from './registry';
import {
  hasThreadDetails,
  isThreadDetail,
  shownThreadDetails,
  type ThreadDetail,
} from './threadDetails';

const A = (): null => null;
const B = (): null => null;
const C = (): null => null;
const D = (): null => null;
const E = (): null => null;

const plugin = (id: string, threadDetails: ThreadDetail[]): RegisteredPlugin => ({
  id,
  tag: `${id}@1.0.0`,
  conversationCovers: [],
  messageRenderers: [],
  pages: [],
  roomHeaderSlot: [],
  threadHeaderSlot: [],
  sidePanels: [],
  headerActions: [],
  slashCommands: [],
  roomActions: [],
  messageLinks: [],
  threadCardBadges: [],
  threadDetails,
});

afterEach(() => vi.restoreAllMocks());

describe('isThreadDetail', () => {
  it('takes an entry whose Component is a function or a component object, with or without a shows function', () => {
    expect(isThreadDetail({ Component: () => null })).toBe(true);
    expect(isThreadDetail({ Component: memo(A), shows: () => true })).toBe(true);
  });
  it('refuses an entry without a component or whose shows is no function', () => {
    expect(isThreadDetail({})).toBe(false);
    expect(isThreadDetail({ Component: 'x' })).toBe(false);
    expect(isThreadDetail({ Component: A, shows: true })).toBe(false);
    expect(isThreadDetail(null)).toBe(false);
  });
});

describe('shownThreadDetails', () => {
  it("lists the details of the enabled plugins whose shows takes the thread, in build order, keyed <plugin id>/<index>; a shows that throws leaves out only its entry, logged with the plugin's tag", () => {
    const failure = new Error('no');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const config = { plugins: { off: { enabled: false } } } as unknown as ClientConfig;
    const room = { roomId: '!room:example.org' } as Room;
    const shown = shownThreadDetails(
      [
        plugin('off', [{ Component: A }]),
        plugin('alpha', [
          { Component: A },
          { Component: B, shows: () => false },
          { Component: C, shows: (r, id) => r === room && id === '$root' },
        ]),
        plugin('broken', [
          {
            Component: D,
            shows: () => {
              throw failure;
            },
          },
        ]),
        plugin('beta', [{ Component: E }]),
      ],
      config,
      room,
      '$root'
    );
    expect(shown).toEqual([
      { key: 'alpha/0', tag: 'alpha@1.0.0', Component: A },
      { key: 'alpha/2', tag: 'alpha@1.0.0', Component: C },
      { key: 'beta/0', tag: 'beta@1.0.0', Component: E },
    ]);
    expect(logged).toHaveBeenCalledWith(
      "[plugin broken@1.0.0] its thread details' shows failed",
      failure
    );
  });
});

describe('hasThreadDetails', () => {
  it('says whether a plugin config.json leaves on contributes a thread detail', () => {
    const off = { plugins: { alpha: { enabled: false } } } as unknown as ClientConfig;
    expect(hasThreadDetails([], undefined)).toBe(false);
    expect(hasThreadDetails([plugin('alpha', []), plugin('beta', [{ Component: A }])], off)).toBe(
      true
    );
    expect(hasThreadDetails([plugin('alpha', [{ Component: A }]), plugin('beta', [])], off)).toBe(
      false
    );
  });
});
