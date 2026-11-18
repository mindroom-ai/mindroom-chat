// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MatrixEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageLayout } from '../preferences/settings';
import { importBeforeTests } from '../../test/utils/importBeforeTests';
import type { ReplyTiming } from './replyTiming';

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn, i18n: { language: 'en' } }) };
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
  getMemberDisplayName: () => 'Helper',
}));
vi.mock('../event-store/threads/useThreadPinning', () => ({
  useThreadPinning: () => ({ canPin: false, setPinned: vi.fn(), updating: false }),
}));
vi.mock('../bug-reports/MessageBugReportItem', () => ({ MessageBugReportItem: () => null }));
vi.mock('../avatars/UserAvatar', () => ({ UserAvatar: () => null }));
// The dialog needs a layout jsdom lacks; the info button's aria-expanded says it opened.
vi.mock('../ui/ModalLayer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ui/ModalLayer')>()),
  ModalLayer: () => null,
}));
vi.mock('./Time.css', () => ({ ReplyTime: 'ReplyTime', Fold: 'Fold', FoldText: 'FoldText' }));

const loadMessage = async () => (await import('./Message')).Message;
importBeforeTests(loadMessage);

const START = new Date(2026, 2, 5, 10, 4, 12).getTime();

const PLAIN = { msgtype: 'm.text', body: 'Done' };
const WITH_RUN = { ...PLAIN, 'io.mindroom.ai_run': { version: 1, status: 'completed' } };

const renderMessage = async (
  layout: MessageLayout,
  replyTiming?: ReplyTiming,
  content: Record<string, unknown> = PLAIN
) => {
  const Message = await loadMessage();
  render(
    <Message
      room={{ roomId: '!room:example.org', getTimelineForEvent: () => undefined } as never}
      mEvent={
        {
          threadRootId: undefined,
          getContent: () => content,
          getId: () => '$event',
          getSender: () => '@mindroom_helper:example.org',
          getTs: () => START,
          isRedacted: () => false,
        } as unknown as MatrixEvent
      }
      collapse={false}
      highlight={false}
      messageLayout={layout}
      messageSpacing="400"
      hour24Clock
      replyTiming={replyTiming}
      onReplyClick={vi.fn()}
      data-message-id="$event"
    >
      <p>Done</p>
    </Message>
  );
  return document.querySelector('time') as HTMLElement;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 2, 5, 12, 0));
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
  vi.useRealTimers();
});

describe("an agent reply's header time", () => {
  const timing = { startTs: START, endTs: START + 432_000, streaming: false };

  it('shows the duration after the start, with the finish to unfold', async () => {
    const time = await renderMessage(MessageLayout.Modern, timing);
    expect(time.textContent).toBe('10:04\u00a0–\u00a010:11\u00a0·\u00a07m\u00a012s');
  });

  it('shows only the start and the short duration in the Compact layout', async () => {
    const time = await renderMessage(MessageLayout.Compact, timing);
    expect(time.textContent).toBe('10:04\u00a0·\u00a07m');
    expect(time.title).toContain('Duration 7m\u00a012s');
  });

  it('shows only the start of a message without a timing', async () => {
    const time = await renderMessage(MessageLayout.Modern);
    expect(time.textContent).toBe('10:04');
  });

  it('is no Tab stop of its own: the message row, which unfolds it, is the one', async () => {
    const time = await renderMessage(MessageLayout.Modern, timing);
    expect(time.hasAttribute('tabindex')).toBe(false);
    expect(time.closest<HTMLElement>('[data-message-id="$event"]')?.tabIndex).toBe(0);
  });

  it("unfolds on a tap that leaves the message's toolbar hidden", async () => {
    const time = await renderMessage(MessageLayout.Modern, timing);
    const row = time.closest<HTMLElement>('[data-message-id="$event"]')!;
    // jsdom cannot tell a tap's focus from the keyboard's (`:focus-visible`); a browser can.
    const { matches } = Element.prototype;
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function focusVisible(
      this: Element,
      selector: string
    ) {
      return selector === ':focus-visible' ? false : matches.call(this, selector);
    });
    await act(async () => {
      const down = new MouseEvent('pointerdown', { bubbles: true, button: 0 });
      Object.defineProperty(down, 'pointerType', { value: 'touch' });
      time.dispatchEvent(down);
      // The press focuses the row, the nearest focusable element, unless the time prevents it.
      if (fireEvent.mouseDown(time)) row.focus();
      fireEvent.click(time);
    });
    expect(time.hasAttribute('data-open')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
  });

  it('opens the reply details on a click with a hovering pointer, staying folded', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(hover: hover)',
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const time = await renderMessage(MessageLayout.Modern, timing, WITH_RUN);
    await act(async () => {
      fireEvent.click(time);
    });
    const details = screen.getByRole('button', { name: 'Reply details' });
    expect(details.getAttribute('aria-expanded')).toBe('true');
    expect(time.hasAttribute('data-open')).toBe(false);
  });

  it('unfolds on a tap on a touchscreen whose primary pointer hovers', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(hover: hover)',
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const time = await renderMessage(MessageLayout.Modern, timing, WITH_RUN);
    await act(async () => {
      // jsdom has no PointerEvent, so the press is a MouseEvent with a pointer type.
      const down = new MouseEvent('pointerdown', { bubbles: true, button: 0 });
      Object.defineProperty(down, 'pointerType', { value: 'touch' });
      time.dispatchEvent(down);
      fireEvent.click(time);
    });
    expect(time.hasAttribute('data-open')).toBe(true);
    const details = screen.getByRole('button', { name: 'Reply details' });
    expect(details.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps unfolding on a tap, with the reply details on its button', async () => {
    const time = await renderMessage(MessageLayout.Modern, timing, WITH_RUN);
    await act(async () => {
      fireEvent.click(time);
    });
    expect(time.hasAttribute('data-open')).toBe(true);
    const details = screen.getByRole('button', { name: 'Reply details' });
    expect(details.getAttribute('aria-expanded')).toBe('false');
  });
});
