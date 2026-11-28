// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { use, useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import { MessageLayout } from '../preferences/settings';
import { makeUiEvent, makeUiRoom, viewerId } from '../ui-actions/testUtils';
import { importBeforeTests } from '../../test/utils/importBeforeTests';
import { MessageInlineCanvasContext } from './hoverToolbarPlacement';
import type { MessageProps } from './Message';

vi.unmock('../ui/glass/GlassPrimitives');

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn, i18n: { language: 'en' } }) };
});
vi.mock('../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));
vi.mock('../event-store/threads/useThreadPinning', () => ({
  useThreadPinning: () => ({ canPin: false, setPinned: vi.fn(), updating: false }),
}));
vi.mock('../bug-reports/MessageBugReportItem', () => ({
  MessageBugReportItem: () => null,
  useCanReportMessageBug: () => false,
}));
vi.mock('../avatars/UserAvatar', () => ({ UserAvatar: () => null }));
vi.mock('../emoji/board/LazyEmojiBoard', () => ({ EmojiBoard: () => 'Emoji board' }));

const loadMessage = async () => (await import('./Message')).Message;
importBeforeTests(loadMessage);

function RegisteredCanvas() {
  const register = use(MessageInlineCanvasContext);
  useLayoutEffect(() => {
    register?.((count) => count + 1);
    return () => register?.((count) => count - 1);
  }, [register]);
  return <button type="button">Open canvas</button>;
}

const mountMessage = async (withCanvas = false, onKeyDown?: MessageProps['onKeyDown']) => {
  const Message = await loadMessage();
  const { mx, room } = makeUiRoom();
  const content = { msgtype: 'm.text', body: 'plain reply' };
  const mEvent = makeUiEvent({}, { event_id: '$event', sender: viewerId, content });
  const message = (canvas: boolean, edit = false) => (
    <Message
      edit={edit}
      onKeyDown={onKeyDown}
      room={room}
      mEvent={mEvent}
      collapse={withCanvas}
      highlight={false}
      messageLayout={MessageLayout.Modern}
      messageSpacing="400"
      canSendReaction={withCanvas}
      onReactionToggle={vi.fn()}
      onReplyClick={vi.fn()}
      data-message-id="$event"
    >
      <p>plain reply</p>
      {canvas && <RegisteredCanvas />}
    </Message>
  );
  const { rerender } = render(message(withCanvas), {
    wrapper: ({ children }) => <MatrixClientProvider value={mx}>{children}</MatrixClientProvider>,
  });
  return {
    text: screen.getByText('plain reply'),
    removeCanvas: () => rerender(message(false)),
    startEdit: () => rerender(message(withCanvas, true)),
  };
};

const renderMessage = async () => (await mountMessage()).text;

const row = (): HTMLElement => {
  const element = document.querySelector<HTMLElement>('[data-message-id="$event"]');
  if (!element) throw new Error('Expected the message row');
  return element;
};

const toolbarShown = (): boolean =>
  row().querySelector('button[aria-label="Reply"], button[aria-label="Add Reaction"]') !== null;

/**
 * A press on `target` with `pointerType`, as a browser sends it: a pointerdown, the focus the
 * press gives (`focus`, or none when the focus stays where it is), what the browser does before
 * the click (`beforeClick`), and the click.
 */
const press = async (
  target: HTMLElement,
  pointerType: string,
  focus?: HTMLElement,
  beforeClick?: () => void
) => {
  await act(async () => {
    // jsdom has no PointerEvent.
    const down = new MouseEvent('pointerdown', { bubbles: true, button: 0 });
    Object.defineProperty(down, 'pointerType', { value: pointerType });
    target.dispatchEvent(down);
    focus?.focus();
    beforeClick?.();
    fireEvent.click(target);
  });
};

beforeEach(() => {
  // A phone: no pointer hovers.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query !== '(hover: hover)',
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Message toolbar on a phone', () => {
  it('shows on a tap on the message, hides on the next tap, and shows on the one after', async () => {
    const text = await renderMessage();

    await press(text, 'touch', row());
    expect(toolbarShown()).toBe(true);

    // The row keeps the focus: the second tap gives no focus event.
    await press(text, 'touch');
    expect(toolbarShown()).toBe(false);
    expect(document.activeElement).not.toBe(row());

    await press(text, 'touch', row());
    expect(toolbarShown()).toBe(true);
  });

  it('keeps the toolbar for a tap on one of its buttons', async () => {
    const text = await renderMessage();
    await press(text, 'touch', row());

    const reply = screen.getByRole('button', { name: 'Reply' });
    await press(reply, 'touch', reply);
    expect(toolbarShown()).toBe(true);
  });

  it('keeps the toolbar for a tap that ends a text selection', async () => {
    const text = await renderMessage();
    await press(text, 'touch', row());

    // The browser clears the selection between the press and its click.
    const selection = document.getSelection();
    selection?.selectAllChildren(text);
    await press(text, 'touch', undefined, () => selection?.removeAllRanges());
    expect(toolbarShown()).toBe(true);
    expect(document.activeElement).toBe(row());
  });

  it('keeps the toolbar for a tap that selects text', async () => {
    const text = await renderMessage();
    await press(text, 'touch', row());

    const selection = document.getSelection();
    await press(text, 'touch', undefined, () => selection?.selectAllChildren(text));
    expect(toolbarShown()).toBe(true);
    selection?.removeAllRanges();
  });

  it('leaves a second mouse click on the message as the first left it', async () => {
    const text = await renderMessage();
    await press(text, 'mouse', row());
    const afterFirst = toolbarShown();

    await press(text, 'mouse');
    expect(toolbarShown()).toBe(afterFirst);
    expect(document.activeElement).toBe(row());
  });
});

describe('Message toolbar with an inline canvas', () => {
  it('keeps only the collapsed time on hover until the canvas is removed', async () => {
    vi.stubGlobal('matchMedia', undefined); // Without matchMedia, Message allows hover.
    const { removeCanvas } = await mountMessage(true);
    fireEvent.pointerEnter(row(), { pointerType: 'mouse' });
    fireEvent.mouseEnter(row());
    expect(toolbarShown()).toBe(false);
    expect(row().querySelector('time')).not.toBeNull();
    removeCanvas();
    expect(toolbarShown()).toBe(true);
  });

  it('hides the toolbar on focus without blurring or activating it on a second tap', async () => {
    const { text, removeCanvas } = await mountMessage(true);
    const element = row();
    act(() => element.focus());
    expect(toolbarShown()).toBe(false);
    await press(text, 'touch');
    expect(document.activeElement).toBe(element);

    act(() => element.blur());
    // jsdom does not distinguish a tap's focus from the keyboard's.
    const matches = element.matches.bind(element);
    vi.spyOn(element, 'matches').mockImplementation(
      (selector) => selector !== ':focus-visible' && matches(selector)
    );
    await press(text, 'touch', element);
    await press(text, 'touch');
    expect(document.activeElement).toBe(element);
    removeCanvas();
    expect(toolbarShown()).toBe(false);
  });

  const allowMenuFocus = () => {
    // The focus trap needs visible menu items; jsdom gives them no layout.
    const rects = [new DOMRect()] as unknown as DOMRectList;
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue(rects);
  };
  const addReaction = () => screen.getByRole('menuitem', { name: 'Add Reaction' });
  const shiftF10 = { key: 'F10', shiftKey: true };

  it('opens the right-click menu and Add Reaction without a toolbar', async () => {
    allowMenuFocus();
    const { text } = await mountMessage(true);
    fireEvent.contextMenu(text, { button: 2, clientX: 24, clientY: 24 });
    expect(toolbarShown()).toBe(false);
    fireEvent.click(addReaction());
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByText('Emoji board')).toBeTruthy();
    expect(toolbarShown()).toBe(false);
  });

  it.each([shiftF10, { key: 'ContextMenu', shiftKey: false }])(
    'opens the menu for $key on the focused canvas row and dismisses it with Escape',
    async (shortcut) => {
      allowMenuFocus();
      await mountMessage(true);
      const element = row();
      act(() => element.focus());
      expect(fireEvent.keyDown(element, shortcut)).toBe(false);
      expect(toolbarShown()).toBe(false);

      fireEvent.keyDown(element, { key: 'ArrowDown' });
      expect(document.activeElement).toBe(addReaction());
      fireEvent.keyDown(addReaction(), { key: 'Escape' });
      expect(screen.queryByRole('menu')).toBeNull();
      expect(toolbarShown()).toBe(false);
    }
  );

  it('passes Shift+F10 on a nested canvas control through to the caller', async () => {
    const onKeyDown = vi.fn();
    await mountMessage(true, onKeyDown);
    const control = screen.getByRole('button', { name: 'Open canvas' });
    act(() => control.focus());
    expect(fireEvent.keyDown(control, shiftF10)).toBe(true);
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('hides the open menu when the message enters edit mode externally', async () => {
    allowMenuFocus();
    const { startEdit } = await mountMessage(true);
    act(() => row().focus());
    fireEvent.keyDown(row(), shiftF10);
    expect(addReaction()).toBeTruthy();

    startEdit();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(fireEvent.keyDown(row(), shiftF10)).toBe(true);
    expect(toolbarShown()).toBe(false);
  });
});
