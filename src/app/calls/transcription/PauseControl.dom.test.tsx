// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, Provider } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { PauseControl } from './PauseControl';
import { pauseHeldAtom } from './transcriptionState';

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getSafeUserId: () => '@ann:example.org' }),
}));

const room = { roomId: '!room:example.org', getMember: () => null } as unknown as Room;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('PauseControl on the page', () => {
  it('takes presses, keys and clicks on its real button', () => {
    const store = createStore();
    act(() =>
      root.render(
        <Provider store={store}>
          <PauseControl room={room} />
        </Provider>
      )
    );
    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Pause transcription"]'
    );
    expect(button).not.toBeNull();
    const fire = (event: Event) => act(() => void button?.dispatchEvent(event));

    fire(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(store.get(pauseHeldAtom)).toBe(true);
    expect(button?.getAttribute('aria-pressed')).toBe('true');
    fire(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    fire(new MouseEvent('click', { bubbles: true, button: 0 }));
    expect(store.get(pauseHeldAtom)).toBe(false);

    // A finger: the pointer leaves the button between lifting and the click.
    fire(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(store.get(pauseHeldAtom)).toBe(true);
    fire(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    fire(new MouseEvent('pointerout', { bubbles: true, button: 0 }));
    fire(new MouseEvent('pointerleave', { bubbles: false, button: 0 }));
    fire(new MouseEvent('click', { bubbles: true, button: 0 }));
    expect(store.get(pauseHeldAtom)).toBe(false);

    fire(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    expect(store.get(pauseHeldAtom)).toBe(true);
    fire(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }));
    expect(store.get(pauseHeldAtom)).toBe(false);

    // A click on its own, as a screen reader sends: held until the next one.
    act(() => button?.click());
    expect(store.get(pauseHeldAtom)).toBe(true);
    act(() => button?.click());
    expect(store.get(pauseHeldAtom)).toBe(false);
  });
});
