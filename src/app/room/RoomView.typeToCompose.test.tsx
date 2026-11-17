// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createClient, Room } from 'matrix-js-sdk';
import type { Editor } from 'slate';
import { Editable, Slate } from 'slate-react';
import { getDefaultStore } from 'jotai';
import { afterEach, expect, it, vi } from 'vitest';
import { conversationBehindPanelAtom } from '../navigation/conversationCover';
import { runShortcut } from '../shortcuts/useShortcut';
import { RoomView } from './RoomView';

const mx = createClient({ baseUrl: 'https://matrix.example.org', userId: '@alice:example.org' });
const room = new Room('!room:example.org', mx, '@alice:example.org');

vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../matrix/hooks/usePowerLevels', () => ({ usePowerLevelsContext: () => ({}) }));
vi.mock('../matrix/hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../matrix/hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({ event: () => true }),
}));
vi.mock('../matrix/hooks/useStateEvent', () => ({ useStateEvent: () => undefined }));
vi.mock('../event-store/engine/engineContext', () => ({
  useSyncEngine: () => ({ noteRoomFocused: () => undefined, clearRoomFocus: () => undefined }),
}));
vi.mock('./useRoomViewThreadState', () => ({
  useRoomViewThreadState: () => ({
    viewMode: 'compact',
    handleExitThread: () => undefined,
    handleThreadRootDeleted: () => undefined,
    storeThreadSummary: () => undefined,
    summaryMap: new Map(),
    threadSortFreezeState: null,
  }),
}));
vi.mock('./RoomViewHeader', () => ({ RoomViewHeader: () => null }));
vi.mock('../timeline/RoomTimeline', () => ({ RoomTimeline: () => null }));
vi.mock('../timeline/typing/RoomViewTyping', () => ({ RoomViewTyping: () => null }));
vi.mock('../timeline/RoomViewFollowing', () => ({ RoomViewFollowing: () => null }));
vi.mock('../background-jobs/BackgroundJobsBar', () => ({ BackgroundJobsBar: () => null }));
vi.mock('../approvals/ThreadApprovalProvider', () => ({
  ThreadApprovalProvider: ({ children }: { children: ReactNode }) => children,
}));
// The composer is its Slate text box, which the room view focuses.
vi.mock('../composer/RoomInput', () => ({
  RoomInput: ({ editor }: { editor: Editor }) => (
    <Slate editor={editor} initialValue={[{ type: 'paragraph', children: [{ text: '' }] }]}>
      <Editable aria-label="Message" />
    </Slate>
  ),
}));

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  getDefaultStore().set(conversationBehindPanelAtom, false);
});

/** A focused element outside the room view, as a region of the page would hold it. */
const focusedElement = (tagName: 'canvas' | 'div', parent: HTMLElement = document.body) => {
  const element = parent.appendChild(document.createElement(tagName));
  element.tabIndex = 0;
  element.focus();
  return element;
};

const pressA = (target: Element) => fireEvent.keyDown(target, { key: 'a', code: 'KeyA' });
const pressPaste = (target: Element, modifiers: Partial<KeyboardEventInit>) =>
  fireEvent.keyDown(target, { key: 'v', code: 'KeyV', ...modifiers });
const pressEscape = () =>
  runShortcut('focusComposer', new KeyboardEvent('keydown', { key: 'Escape' }));

it('moves a letter typed with nothing focused to the composer', () => {
  render(<RoomView room={room} />);
  pressA(document.body);
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message' }));
});

it.each([
  ['Cmd+V', { metaKey: true }],
  ['Ctrl+V', { ctrlKey: true }],
  ['Cmd+Shift+V', { metaKey: true, shiftKey: true }],
  ['Ctrl+Shift+V', { ctrlKey: true, shiftKey: true }],
])('moves a paste (%s) with nothing focused to the composer', (_name, modifiers) => {
  render(<RoomView room={room} />);
  pressPaste(document.body, modifiers);
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message' }));
});

it.each([
  ['Dvorak, V on the period key', { key: 'v', code: 'Period' }],
  ['Cyrillic, V by its key', { key: 'м', code: 'KeyV' }],
])('moves a paste on another layout (%s) to the composer', (_name, keys) => {
  render(<RoomView room={room} />);
  fireEvent.keyDown(document.body, { ...keys, ctrlKey: true });
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message' }));
});

it("leaves Ctrl+K on Dvorak, whose K sits on QWERTY's V, where it was", () => {
  render(<RoomView room={room} />);
  fireEvent.keyDown(document.body, { key: 'k', code: 'KeyV', ctrlKey: true });
  expect(document.activeElement).toBe(document.body);
});

it('leaves a paste with Alt held where it was', () => {
  render(<RoomView room={room} />);
  pressPaste(document.body, { metaKey: true, altKey: true });
  pressPaste(document.body, { ctrlKey: true, altKey: true });
  expect(document.activeElement).toBe(document.body);
});

it('leaves a paste into a focused field in that field', () => {
  render(<RoomView room={room} />);
  const field = document.body.appendChild(document.createElement('input'));
  field.focus();
  pressPaste(field, { ctrlKey: true });
  pressPaste(field, { metaKey: true });
  expect(document.activeElement).toBe(field);
});

it('goes back to the composer on Escape with nothing focused', () => {
  render(<RoomView room={room} />);
  expect(pressEscape()).toBe(true);
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message' }));
});

it('leaves a letter typed inside a region marked data-keeps-typing in that region', () => {
  render(<RoomView room={room} />);
  const region = document.body.appendChild(document.createElement('div'));
  region.setAttribute('data-keeps-typing', '');
  const canvas = focusedElement('canvas', region);
  pressA(canvas);
  expect(document.activeElement).toBe(canvas);
});

it('leaves Escape pressed inside a region marked data-keeps-typing in that region', () => {
  render(<RoomView room={room} />);
  const region = document.body.appendChild(document.createElement('div'));
  region.setAttribute('data-keeps-typing', '');
  const canvas = focusedElement('canvas', region);
  expect(pressEscape()).toBe(false);
  expect(document.activeElement).toBe(canvas);
});

it('leaves a letter whose keydown another handler cancelled where it was typed', () => {
  render(<RoomView room={room} />);
  const game = focusedElement('div');
  game.addEventListener('keydown', (event) => event.preventDefault());
  pressA(game);
  expect(document.activeElement).toBe(game);
});

it("leaves a letter, and Escape, alone while a side panel takes the conversation's place", () => {
  getDefaultStore().set(conversationBehindPanelAtom, true);
  render(<RoomView room={room} />);
  pressA(document.body);
  expect(pressEscape()).toBe(false);
  expect(document.activeElement).toBe(document.body);
});
