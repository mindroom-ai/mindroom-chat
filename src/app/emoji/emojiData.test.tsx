import { MatrixEvent, type MatrixClient } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// A loaded machine can take seconds to load a lazy module's code.
const LOAD_WAIT = { timeout: 60_000, interval: 20 };
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

// Every test starts from fresh modules, without the emoji data, as the app starts.
beforeEach(() => {
  vi.resetModules();
});

let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.doUnmock('./emoji');
});

const clientWithRecent = (recentEmoji: Array<[string, number]>) =>
  ({
    getAccountData: () =>
      new MatrixEvent({ type: 'io.element.recent_emoji', content: { recent_emoji: recentEmoji } }),
    on: () => undefined,
    off: () => undefined,
  } as unknown as MatrixClient);

it('gives recent emoji as their text at once and names them once the data it asks for loads', async () => {
  const { useRecentEmoji } = await import('./useRecentEmoji');
  const { getEmojiData } = await import('./emojiData');
  const client = clientWithRecent([
    ['😀', 2],
    ['not an emoji', 1],
  ]);
  const seen: unknown[][] = [];
  function Probe() {
    seen.push(useRecentEmoji(client));
    return null;
  }

  act(() => {
    renderer = create(<Probe />);
  });
  expect(seen[0]).toEqual([{ unicode: '😀' }, { unicode: 'not an emoji' }]);

  await act(async () => {
    await vi.waitFor(() => expect(getEmojiData()).toBeDefined(), LOAD_WAIT);
  });
  // Named now, and text the data does not know is gone.
  expect(seen.at(-1)).toEqual([expect.objectContaining({ unicode: '😀', label: 'grinning face' })]);
});

it('has the data at once when the emoji board chunk loaded it', async () => {
  const { getEmojiData } = await import('./emojiData');
  expect(getEmojiData()).toBeUndefined();

  const emoji = await import('./emoji');

  expect(getEmojiData()?.getEmojiByUnicode('😀')).toBe(emoji.getEmojiByUnicode('😀'));
});

it('loads the data again after a failed load', async () => {
  vi.doMock('./emoji', () => {
    throw new Error('offline');
  });
  const { loadEmojiData, getEmojiData } = await import('./emojiData');
  await expect(loadEmojiData()).rejects.toThrow();

  vi.doUnmock('./emoji');
  await expect(loadEmojiData()).resolves.toHaveProperty('emojis');
  expect(getEmojiData()?.emojis.length).toBeGreaterThan(1000);
});
