// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { createStore, Provider } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { afterEach, expect, it, vi } from 'vitest';
import { roomIdToTypingMembersAtom } from '../../matrix/state/typingMembers';
import { RoomViewTyping } from './RoomViewTyping';

vi.mock('./RoomViewTyping.css', () => ({
  TypingStrip: 'typing-strip',
  TypingText: 'typing-text',
  TypingDots: 'typing-dots',
  TypingDot: 'typing-dot',
}));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getUserId: () => '@me:example.org' }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOM_ID = '!room:example.org';
const NAMES: Record<string, string> = {
  '@avery:example.org': 'Avery',
  '@code:example.org': 'Code',
};
const room = {
  roomId: ROOM_ID,
  getMember: (userId: string) => ({ rawDisplayName: NAMES[userId] }),
} as unknown as Room;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
});

const typing = (store: ReturnType<typeof createStore>, userId: string) =>
  store.set(roomIdToTypingMembersAtom, {
    type: 'PUT',
    roomId: ROOM_ID,
    userId,
    ts: Date.now(),
    isTyping: () => true,
  });

const render = (store: ReturnType<typeof createStore>) => {
  container = document.createElement('div');
  document.body.append(container);
  act(() => {
    root = createRoot(container!);
    root.render(
      <Provider store={store}>
        <RoomViewTyping room={room} />
      </Provider>
    );
  });
  return container;
};

it('shows nothing while nobody else types', () => {
  const store = createStore();
  typing(store, '@me:example.org');
  expect(render(store).textContent).toBe('');
});

it('names who types next to the dots, and drops the notice until the next update', () => {
  const store = createStore();
  typing(store, '@avery:example.org');
  typing(store, '@code:example.org');
  const view = render(store);

  const strip = view.querySelector('[role="status"]');
  expect(strip?.textContent).toBe('Avery and Code are typing...');
  expect(view.querySelectorAll('.typing-dot')).toHaveLength(3);

  const drop = view.querySelector<HTMLButtonElement>('button[aria-label="Drop Typing Status"]');
  act(() => drop?.click());
  expect(view.textContent).toBe('');

  act(() => typing(store, '@avery:example.org'));
  expect(view.querySelector('[role="status"]')?.textContent).toBe('Avery is typing...');
});
