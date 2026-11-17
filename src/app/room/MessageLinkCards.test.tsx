// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import type { MessageLinkCardProps } from '../plugins/messageLinks';
import type { RegisteredPlugin } from '../plugins/registry';
import { PluginPanelControlsContext, type PluginPanelControls } from '../plugins/sidePanels';
import { CheckedMessageLink } from '../rich-text/CheckedMessageLink';
import { MessageLinkCards } from './MessageLinkCards';

// jsdom lays nothing out, so a focus trap finds nothing it could focus and throws.
// Its options are kept, so a test can run the trap's deactivation: the trap would then move focus
// to the element it saved on activation (here `returnTarget`) when `returnFocusOnDeactivate` is on.
vi.mock('focus-trap-react', () => ({
  default: ({
    children,
    focusTrapOptions,
  }: {
    children: ReactNode;
    focusTrapOptions: { returnFocusOnDeactivate?: boolean; onDeactivate?: () => void };
  }) => {
    mocks.deactivate = () => {
      focusTrapOptions.onDeactivate?.();
      if (focusTrapOptions.returnFocusOnDeactivate) mocks.returnTarget?.focus();
    };
    return children;
  },
}));
vi.mock('react-i18next', async (importOriginal) => {
  const { translateFromEn } = await import('../../test/utils/i18n');
  return { ...(await importOriginal<object>()), useTranslation: () => ({ t: translateFromEn }) };
});

const mocks = vi.hoisted(() => ({
  reportBoundaryError: vi.fn(),
  position: undefined as string | undefined,
  deactivate: undefined as (() => void) | undefined,
  returnTarget: undefined as HTMLElement | undefined,
}));
// Records where the card is asked to open.
vi.mock('../ui/directional', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  PopOut: ({ content, position }: { content?: ReactNode; position: string }) => {
    mocks.position = content ? position : undefined;
    return content ?? null;
  },
}));
vi.mock('../bug-reports/error-reporting/errorReporting', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reportBoundaryError: mocks.reportBoundaryError,
}));

function Card({ href, roomId, close }: MessageLinkCardProps) {
  if (href.endsWith('/broken')) throw new Error('boom');
  if (href.endsWith('/slow')) throw new Promise(() => undefined);
  return (
    <div>
      <span>{`card ${href} in ${roomId}`}</span>
      <button type="button" onClick={close}>
        Close card
      </button>
    </div>
  );
}

// Links to panel.example open the plugin's panel `p` with their path's item; `/throw` has a request
// that throws.
const itemOf = (url: URL) => {
  if (url.pathname === '/throw') throw new Error('no item');
  return { item: url.pathname.slice(1) };
};
const plugin = {
  id: 'pr',
  tag: 'pr@1.0.0',
  sidePanels: [{ id: 'p', label: 'P', Component: () => null }],
  messageLinks: [
    { match: (url: URL) => url.host === 'github.com', Component: Card },
    {
      match: (url: URL) => url.host === 'panel.example',
      Component: Card,
      sidePanel: { id: 'p', request: itemOf },
    },
  ],
} as unknown as RegisteredPlugin;

const panelControls = (showsRequest = false): PluginPanelControls => ({
  shown: undefined,
  thread: undefined,
  open: vi.fn(),
  openBesideThread: vi.fn(),
  close: vi.fn(),
  showsRequest: vi.fn(() => showsRequest),
});

const renderCards = (
  roomId = '!a:x',
  {
    controls,
    screenSize = ScreenSize.Desktop,
  }: { controls?: PluginPanelControls; screenSize?: ScreenSize } = {}
) => {
  const ui = (id: string) => (
    <ScreenSizeProvider value={screenSize}>
      <PluginPanelControlsContext.Provider value={controls}>
        <MessageLinkCards roomId={id} plugins={[plugin]}>
          <CheckedMessageLink href="https://github.com/o/r/pull/1">One</CheckedMessageLink>
          <CheckedMessageLink href="https://github.com/o/r/pull/2">Two</CheckedMessageLink>
          <CheckedMessageLink href="https://github.com/o/r/broken">Broken</CheckedMessageLink>
          <CheckedMessageLink href="https://github.com/o/r/slow">Slow</CheckedMessageLink>
          <CheckedMessageLink href="https://other.example/page">Other</CheckedMessageLink>
          <CheckedMessageLink href="https://panel.example/7">Seven</CheckedMessageLink>
          <CheckedMessageLink href="https://panel.example/throw">Thrower</CheckedMessageLink>
        </MessageLinkCards>
      </PluginPanelControlsContext.Provider>
    </ScreenSizeProvider>
  );
  const view = render(ui(roomId));
  return { ...view, again: (id: string) => view.rerender(ui(id)) };
};

// Whether a click reaches the document unprevented; the listener then prevents it, so jsdom does
// not follow the link.
const goesOn = (link: HTMLElement) => {
  const seen: boolean[] = [];
  document.addEventListener(
    'click',
    (event) => {
      seen.push(event.defaultPrevented);
      event.preventDefault();
    },
    { once: true }
  );
  fireEvent.click(link);
  return seen[0] === false;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mocks.reportBoundaryError.mockClear();
  mocks.deactivate = undefined;
  mocks.returnTarget = undefined;
});

describe('MessageLinkCards', () => {
  const clickAt = (top: number) => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
    const link = screen.getByRole('link', { name: 'One' });
    link.getBoundingClientRect = () => ({ top, bottom: top + 20, left: 0, right: 50 } as DOMRect);
    fireEvent.click(link);
  };

  it('opens the card above a link in the lower half of the window', () => {
    renderCards();
    clickAt(700);
    expect(mocks.position).toBe('Top');
  });

  it('opens the card below a link in the upper half of the window', () => {
    renderCards();
    clickAt(100);
    expect(mocks.position).toBe('Bottom');
  });

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

  it('Escape leaves focus on the link, not on what the trap saved', () => {
    renderCards();
    const link = screen.getByRole('link', { name: 'One' });
    const other = screen.getByRole('link', { name: 'Two' });
    mocks.returnTarget = other;
    fireEvent.click(link);
    act(() => mocks.deactivate?.());
    expect(screen.queryByText(/^card /)).toBeNull();
    expect(document.activeElement).toBe(link);
  });

  it('a card that suspends leaves the room content showing', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderCards();
    fireEvent.click(screen.getByRole('link', { name: 'Slow' }));
    expect(screen.getByRole('link', { name: 'One' })).toBeTruthy();
    expect(mocks.reportBoundaryError).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
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
    expect(goesOn(screen.getByRole('link', { name: 'Other' }))).toBe(true);
    expect(screen.queryByText(/^card /)).toBeNull();
  });

  it('closes on a switch to another room', () => {
    const { again } = renderCards();
    fireEvent.click(screen.getByRole('link', { name: 'One' }));
    again('!b:x');
    expect(screen.queryByText(/^card /)).toBeNull();
  });

  it('a link with a side panel opens it with its request and shows no card', () => {
    const controls = panelControls();
    renderCards('!a:x', { controls });
    expect(fireEvent.click(screen.getByRole('link', { name: 'Seven' }))).toBe(false);
    expect(controls.showsRequest).toHaveBeenCalledWith('pr/p', { item: '7' });
    expect(controls.open).toHaveBeenCalledWith('pr/p', { item: '7' });
    expect(screen.queryByText(/^card /)).toBeNull();
  });

  it('a click while its panel shows the same request goes on as a link click', () => {
    const controls = panelControls(true);
    renderCards('!a:x', { controls });
    expect(goesOn(screen.getByRole('link', { name: 'Seven' }))).toBe(true);
    expect(controls.open).not.toHaveBeenCalled();
    expect(screen.queryByText(/^card /)).toBeNull();
  });

  it('on a phone a link with a side panel shows its card', () => {
    const controls = panelControls(true);
    renderCards('!a:x', { controls, screenSize: ScreenSize.Mobile });
    fireEvent.click(screen.getByRole('link', { name: 'Seven' }));
    expect(screen.getByText('card https://panel.example/7 in !a:x')).toBeTruthy();
    expect(controls.open).not.toHaveBeenCalled();
  });

  it('without panel controls a link with a side panel shows its card', () => {
    renderCards();
    fireEvent.click(screen.getByRole('link', { name: 'Seven' }));
    expect(screen.getByText('card https://panel.example/7 in !a:x')).toBeTruthy();
  });

  it("a throwing request shows the card and logs the plugin's tag", () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const controls = panelControls();
    renderCards('!a:x', { controls });
    fireEvent.click(screen.getByRole('link', { name: 'Thrower' }));
    expect(screen.getByText('card https://panel.example/throw in !a:x')).toBeTruthy();
    expect(controls.open).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      "[plugin pr@1.0.0] its message link's request failed",
      expect.any(Error)
    );
  });

  it("opening the panel closes another link's card", () => {
    const controls = panelControls();
    renderCards('!a:x', { controls });
    fireEvent.click(screen.getByRole('link', { name: 'One' }));
    expect(screen.getByText('card https://github.com/o/r/pull/1 in !a:x')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Seven' }));
    expect(screen.queryByText(/^card /)).toBeNull();
    expect(controls.open).toHaveBeenCalledWith('pr/p', { item: '7' });
  });

  it('Enter on the focused link opens the panel', () => {
    const controls = panelControls();
    renderCards('!a:x', { controls });
    const link = screen.getByRole('link', { name: 'Seven' });
    link.focus();
    // A browser makes Enter on a focused link a click with no pointer (detail 0); jsdom does not.
    expect(fireEvent.click(link, { detail: 0 })).toBe(false);
    expect(controls.open).toHaveBeenCalledWith('pr/p', { item: '7' });
    expect(screen.queryByText(/^card /)).toBeNull();
  });
});
