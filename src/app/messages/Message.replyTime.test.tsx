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
vi.mock('./Time.css', () => ({ ReplyTime: 'ReplyTime', Fold: 'Fold', FoldText: 'FoldText' }));

const loadMessage = async () => (await import('./Message')).Message;
importBeforeTests(loadMessage);

const START = new Date(2026, 2, 5, 10, 4, 12).getTime();

const renderMessage = async (layout: MessageLayout, replyTiming?: ReplyTiming) => {
  const Message = await loadMessage();
  render(
    <Message
      room={{ roomId: '!room:example.org', getTimelineForEvent: () => undefined } as never}
      mEvent={
        {
          threadRootId: undefined,
          getContent: () => ({ msgtype: 'm.text', body: 'Done' }),
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

  it.each([MessageLayout.Modern, MessageLayout.Compact])(
    'shows the duration after the start in the %s layout',
    async (layout) => {
      const time = await renderMessage(layout, timing);
      expect(time.textContent).toBe('10:04\u00a0–\u00a010:11\u00a0·\u00a07m\u00a012s');
    }
  );

  it('shows only the start of a message without a timing', async () => {
    const time = await renderMessage(MessageLayout.Modern);
    expect(time.textContent).toBe('10:04');
  });

  it("unfolds on a tap that leaves the message's toolbar hidden", async () => {
    const time = await renderMessage(MessageLayout.Modern, timing);
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
      time.focus();
      fireEvent.click(time);
    });
    expect(time.hasAttribute('data-open')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
  });
});
