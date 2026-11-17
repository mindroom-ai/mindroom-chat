// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageLayout } from '../preferences/settings';
import { importBeforeTests } from '../../test/utils/importBeforeTests';

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});
vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getUserId: () => '@alice:example.org' }),
}));
vi.mock('../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));
vi.mock('../matrix/room', () => ({
  canEditEvent: () => false,
  getMemberAvatarMxc: () => undefined,
  getMemberDisplayName: () => 'Alice',
}));
vi.mock('../event-store/threads/useThreadPinning', () => ({
  useThreadPinning: () => ({ canPin: false, setPinned: vi.fn(), updating: false }),
}));
vi.mock('../bug-reports/MessageBugReportItem', () => ({ MessageBugReportItem: () => null }));
vi.mock('../avatars/UserAvatar', () => ({ UserAvatar: () => null }));
vi.mock('./Time', () => ({ Time: () => null }));

const loadMessage = async () => (await import('./Message')).Message;
importBeforeTests(loadMessage);

const createEvent = () =>
  ({
    threadRootId: undefined,
    getContent: () => ({ msgtype: 'm.text', body: 'plain reply' }),
    getId: () => '$event',
    getSender: () => '@alice:example.org',
    getTs: () => 1,
    isRedacted: () => false,
  } as unknown as MatrixEvent);

const createRoom = () =>
  ({ roomId: '!room:example.org', getTimelineForEvent: () => undefined } as unknown as Room);

/** Renders one confirmed message whose body is a plain paragraph, and returns that paragraph. */
const renderMessage = async () => {
  const Message = await loadMessage();
  render(
    <Message
      room={createRoom()}
      mEvent={createEvent()}
      collapse={false}
      highlight={false}
      messageLayout={MessageLayout.Modern}
      messageSpacing="400"
      onReplyClick={vi.fn()}
      data-message-id="$event"
    >
      <p>plain reply</p>
    </Message>
  );
  return screen.getByText('plain reply');
};

const row = (): HTMLElement => {
  const element = document.querySelector<HTMLElement>('[data-message-id="$event"]');
  if (!element) throw new Error('Expected the message row');
  return element;
};

const toolbarShown = (): boolean => screen.queryByRole('button', { name: 'Reply' }) !== null;

/**
 * A press on `target` with `pointerType`, as a browser sends it: a pointerdown, the focus the
 * press gives (`focus`, or none when the focus stays where it is), and the click.
 */
const press = async (target: HTMLElement, pointerType: string, focus?: HTMLElement) => {
  await act(async () => {
    // jsdom has no PointerEvent.
    const down = new MouseEvent('pointerdown', { bubbles: true, button: 0 });
    Object.defineProperty(down, 'pointerType', { value: pointerType });
    target.dispatchEvent(down);
    focus?.focus();
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

    const selection = document.getSelection();
    selection?.selectAllChildren(text);
    await press(text, 'touch');
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
