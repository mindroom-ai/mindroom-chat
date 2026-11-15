import { memo } from 'react';
import { describe, expect, it } from 'vitest';
import type { ClientConfig } from '../config/useClientConfig';
import type { RegisteredPlugin } from './registry';
import {
  enabledThreadCardBadges,
  isThreadCardBadge,
  type ThreadCardBadge,
} from './threadCardBadges';

const Component = (): null => null;
const OtherComponent = (): null => null;
const ThirdComponent = (): null => null;

const plugin = (id: string, threadCardBadges: ThreadCardBadge[]): RegisteredPlugin => ({
  id,
  tag: `${id}@1.0.0`,
  conversationCovers: [],
  messageRenderers: [],
  pages: [],
  roomHeaderSlot: [],
  sidePanels: [],
  headerActions: [],
  slashCommands: [],
  roomActions: [],
  messageLinks: [],
  threadCardBadges,
});

describe('isThreadCardBadge', () => {
  it('takes an entry whose Component is a function or a memo or lazy component', () => {
    expect(isThreadCardBadge({ Component: () => null })).toBe(true);
    expect(isThreadCardBadge({ Component: memo(Component) })).toBe(true);
  });

  it('refuses an entry without a component', () => {
    expect(isThreadCardBadge({})).toBe(false);
    expect(isThreadCardBadge({ Component: 'x' })).toBe(false);
    expect(isThreadCardBadge(null)).toBe(false);
  });
});

describe('enabledThreadCardBadges', () => {
  it('lists the badges of the enabled plugins in build order, keyed <plugin id>/<index>, with their tags', () => {
    const config = { plugins: { off: { enabled: false } } } as unknown as ClientConfig;
    const badges = enabledThreadCardBadges(
      [
        plugin('alpha', [{ Component }, { Component: OtherComponent }]),
        plugin('off', [{ Component }]),
        plugin('none', []),
        plugin('beta', [{ Component: ThirdComponent }]),
      ],
      config
    );
    expect(badges).toEqual([
      { key: 'alpha/0', tag: 'alpha@1.0.0', Component },
      { key: 'alpha/1', tag: 'alpha@1.0.0', Component: OtherComponent },
      { key: 'beta/0', tag: 'beta@1.0.0', Component: ThirdComponent },
    ]);
  });
});
