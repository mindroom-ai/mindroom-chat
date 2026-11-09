// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MessageLinkCardProps } from '../plugins/messageLinks';
import type { RegisteredPlugin } from '../plugins/registry';
import { CheckedMessageLink } from '../rich-text/CheckedMessageLink';
import { MessageLinkCards } from './MessageLinkCards';

// jsdom lays nothing out, so a focus trap finds nothing it could focus and throws.
vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('react-i18next', async (importOriginal) => {
  const { translateFromEn } = await import('../../test/utils/i18n');
  return { ...(await importOriginal<object>()), useTranslation: () => ({ t: translateFromEn }) };
});

const mocks = vi.hoisted(() => ({ reportBoundaryError: vi.fn() }));
vi.mock('../bug-reports/error-reporting/errorReporting', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reportBoundaryError: mocks.reportBoundaryError,
}));

function Card({ href, roomId, close }: MessageLinkCardProps) {
  if (href.endsWith('/broken')) throw new Error('boom');
  return (
    <div>
      <span>{`card ${href} in ${roomId}`}</span>
      <button type="button" onClick={close}>
        Close card
      </button>
    </div>
  );
}

const plugin = {
  id: 'pr',
  tag: 'pr@1.0.0',
  messageLinks: [{ match: (url: URL) => url.host === 'github.com', Component: Card }],
} as unknown as RegisteredPlugin;

const renderCards = (roomId = '!a:x') => {
  const ui = (id: string) => (
    <MessageLinkCards roomId={id} plugins={[plugin]}>
      <CheckedMessageLink href="https://github.com/o/r/pull/1">One</CheckedMessageLink>
      <CheckedMessageLink href="https://github.com/o/r/pull/2">Two</CheckedMessageLink>
      <CheckedMessageLink href="https://github.com/o/r/broken">Broken</CheckedMessageLink>
      <CheckedMessageLink href="https://other.example/page">Other</CheckedMessageLink>
    </MessageLinkCards>
  );
  const view = render(ui(roomId));
  return { ...view, again: (id: string) => view.rerender(ui(id)) };
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mocks.reportBoundaryError.mockClear();
});

describe('MessageLinkCards', () => {
  it('shows the card at the link with href, roomId and close', () => {
    renderCards();
    expect(fireEvent.click(screen.getByRole('link', { name: 'One' }))).toBe(false);
    expect(screen.getByText('card https://github.com/o/r/pull/1 in !a:x')).toBeTruthy();
  });

  it('close() hides the card and focuses the link', () => {
    renderCards();
    const link = screen.getByRole('link', { name: 'One' });
    fireEvent.click(link);
    fireEvent.click(screen.getByRole('button', { name: 'Close card' }));
    expect(screen.queryByText(/^card /)).toBeNull();
    expect(document.activeElement).toBe(link);
  });

  it("another link's card takes the place of the first", () => {
    renderCards();
    fireEvent.click(screen.getByRole('link', { name: 'One' }));
    fireEvent.click(screen.getByRole('link', { name: 'Two' }));
    expect(screen.queryByText('card https://github.com/o/r/pull/1 in !a:x')).toBeNull();
    expect(screen.getByText('card https://github.com/o/r/pull/2 in !a:x')).toBeTruthy();
  });

  it('a throwing Component closes the card and logs the tag', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderCards();
    fireEvent.click(screen.getByRole('link', { name: 'Broken' }));
    expect(screen.queryByText(/^card /)).toBeNull();
    expect(error).toHaveBeenCalledWith(
      '[plugin pr@1.0.0] failed to render its message link card',
      expect.any(Error)
    );
    expect(mocks.reportBoundaryError).toHaveBeenCalledOnce();
  });

  it('a link no plugin takes opens as before', () => {
    renderCards();
    // The link would be followed; a listener above the cards sees it unprevented, then stops jsdom.
    const seen: boolean[] = [];
    document.addEventListener(
      'click',
      (event) => {
        seen.push(event.defaultPrevented);
        event.preventDefault();
      },
      { once: true }
    );
    fireEvent.click(screen.getByRole('link', { name: 'Other' }));
    expect(seen).toEqual([false]);
    expect(screen.queryByText(/^card /)).toBeNull();
  });

  it('closes on a switch to another room', () => {
    const { again } = renderCards();
    fireEvent.click(screen.getByRole('link', { name: 'One' }));
    again('!b:x');
    expect(screen.queryByText(/^card /)).toBeNull();
  });
});
