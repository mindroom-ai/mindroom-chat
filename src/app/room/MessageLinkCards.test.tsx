// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import type { MessageLinkCardProps, MessageLinkHoverCardProps } from '../plugins/messageLinks';
import type { RegisteredPlugin } from '../plugins/registry';
import { PluginPanelControlsContext, type PluginPanelControls } from '../plugins/sidePanels';
import { CheckedMessageLink } from '../rich-text/CheckedMessageLink';
import { HOVER_CARD_DELAY_MS, MessageLinkCards } from './MessageLinkCards';

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
  hoverPosition: undefined as string | undefined,
  deactivate: undefined as (() => void) | undefined,
  returnTarget: undefined as HTMLElement | undefined,
}));
// Records where the card is asked to open.
vi.mock('../ui/directional', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  PopOut: ({
    content,
    position,
    style,
  }: {
    content?: ReactNode;
    position: string;
    style?: { pointerEvents?: string };
  }) => {
    // The hover card is the pop-out that takes no pointer.
    if (style?.pointerEvents === 'none') mocks.hoverPosition = content ? position : undefined;
    else mocks.position = content ? position : undefined;
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
    link.getBoundingClientRect = () => ({ top, bottom: top + 20, left: 0, right: 50 }) as DOMRect;
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

  it("following the link its panel shows closes another link's card", () => {
    const controls = panelControls(true);
    renderCards('!a:x', { controls });
    fireEvent.click(screen.getByRole('link', { name: 'One' }));
    expect(screen.getByText('card https://github.com/o/r/pull/1 in !a:x')).toBeTruthy();
    expect(goesOn(screen.getByRole('link', { name: 'Seven' }))).toBe(true);
    expect(screen.queryByText(/^card /)).toBeNull();
    expect(controls.open).not.toHaveBeenCalled();
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

const received: MessageLinkHoverCardProps[] = [];
function HoverCard(props: MessageLinkHoverCardProps) {
  received.push(props);
  if (props.href.endsWith('/broken')) throw new Error('hover boom');
  if (props.href.endsWith('/slow')) throw new Promise(() => undefined);
  return <span>{`hover ${props.href} in ${props.roomId}`}</span>;
}

const hoverPlugin = {
  id: 'hover',
  tag: 'hover@1.0.0',
  sidePanels: [{ id: 'q', label: 'Q', Component: () => null }],
  messageLinks: [
    { match: (url: URL) => url.host === 'hover.example', Component: Card, hoverCard: HoverCard },
    {
      match: (url: URL) => url.host === 'hover-panel.example',
      Component: Card,
      hoverCard: HoverCard,
      sidePanel: { id: 'q', request: () => ({}) },
    },
  ],
} as unknown as RegisteredPlugin;
const HOVER_PLUGINS = [plugin, hoverPlugin];

const links = (
  // Keyed as its edits are, so an edit keeps the link's node.
  first: ReactNode = (
    <CheckedMessageLink key="1" href="https://hover.example/1">
      Hovered
    </CheckedMessageLink>
  )
) => (
  <>
    {first}
    <CheckedMessageLink href="https://hover.example/2">Second</CheckedMessageLink>
    <CheckedMessageLink href="https://hover.example/broken">Broken</CheckedMessageLink>
    <CheckedMessageLink href="https://hover.example/slow">Slow</CheckedMessageLink>
    <CheckedMessageLink href="https://hover.example/3">https://bank.example</CheckedMessageLink>
    <CheckedMessageLink href="https://github.com/o/r/pull/1">Plain</CheckedMessageLink>
    <CheckedMessageLink href="https://hover-panel.example/4">Paneled</CheckedMessageLink>
    <span>Text</span>
  </>
);
const LINKS = links();

describe('MessageLinkCards hover cards', () => {
  let fine = true;
  const renderHover = (controls?: PluginPanelControls) => {
    const ui = (id: string, links: ReactNode, shownControls = controls) => (
      <PluginPanelControlsContext.Provider value={shownControls}>
        <MessageLinkCards roomId={id} plugins={HOVER_PLUGINS}>
          {links}
        </MessageLinkCards>
      </PluginPanelControlsContext.Provider>
    );
    const view = render(ui('!a:x', LINKS));
    return {
      ...view,
      again: (id: string, links: ReactNode = LINKS, shownControls = controls) =>
        view.rerender(ui(id, links, shownControls)),
    };
  };
  const link = (name: string) => screen.getByRole('link', { name });
  const wait = (ms = HOVER_CARD_DELAY_MS) => {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  };
  // An edit or a removal reaches the host through a MutationObserver, after a microtask.
  const settle = () => act(async () => undefined);
  const card = () => screen.queryByRole('tooltip');
  // jsdom has no PointerEvent.
  const pointer = (element: Element, type: string, pointerType = 'mouse', init = {}) => {
    const event = new MouseEvent(type, { bubbles: true, ...init });
    Object.assign(event, { pointerType });
    fireEvent(element, event);
  };
  const rest = (name = 'Hovered') => {
    const element = link(name);
    pointer(element, 'pointermove');
    return element;
  };
  const shown = (name = 'Hovered') => {
    const element = rest(name);
    wait();
    expect(card()).not.toBeNull();
    return element;
  };

  beforeEach(() => {
    fine = true;
    received.length = 0;
    vi.useFakeTimers();
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        get matches() {
          return fine;
        },
      }))
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows the card once a mouse rests 150 ms on the link, in place of its title', () => {
    renderHover();
    const element = rest();
    expect(element.hasAttribute('title')).toBe(false);
    wait(HOVER_CARD_DELAY_MS - 1);
    // A move restarts the wait.
    pointer(element, 'pointermove');
    wait(HOVER_CARD_DELAY_MS - 1);
    expect(card()).toBeNull();
    wait(1);
    expect(card()?.textContent).toBe('hover https://hover.example/1 in !a:x');
    expect(mocks.hoverPosition).toBe('Bottom');
    pointer(screen.getByText('Text'), 'pointermove');
    expect(card()).toBeNull();
    expect(element.getAttribute('title')).toBe('https://hover.example/1');
  });

  it('names the card from the link while it shows, keeping what else describes the link', () => {
    renderHover();
    const element = link('Hovered');
    element.setAttribute('aria-describedby', 'note');
    shown();
    expect(element.getAttribute('aria-describedby')).toBe(`note ${card()?.id}`);
    // The pointer leaves the window.
    pointer(element, 'pointerout');
    expect(card()).toBeNull();
    expect(element.getAttribute('aria-describedby')).toBe('note');
  });

  it('leaving the link hides it at once, also for an iframe, and not for its own parts', () => {
    renderHover();
    const element = shown();
    const part = document.createElement('b');
    element.append(part);
    pointer(element, 'pointerout', 'mouse', { relatedTarget: part });
    expect(card()).not.toBeNull();
    // An iframe beside it takes the pointer: no pointermove follows here.
    const frame = document.createElement('iframe');
    document.body.append(frame);
    pointer(part, 'pointerout', 'mouse', { relatedTarget: frame });
    expect(card()).toBeNull();
    // A press hid it, and leaving the link lets the next rest show it again.
    shown();
    pointer(document.body, 'pointerdown');
    pointer(element, 'pointerout', 'mouse', { relatedTarget: frame });
    shown();
    frame.remove();
  });

  it('a pen leaving the link keeps a card the keyboard opened', () => {
    renderHover();
    const element = link('Hovered');
    vi.spyOn(element, 'matches').mockReturnValue(true);
    act(() => element.focus());
    wait();
    expect(card()).not.toBeNull();
    pointer(element, 'pointerout', 'pen', { relatedTarget: document.body });
    expect(card()).not.toBeNull();
    pointer(element, 'pointerout', 'mouse', { relatedTarget: document.body });
    expect(card()).toBeNull();
  });

  it('a click anywhere hides it, also Enter on a link whose panel already shows', () => {
    renderHover(panelControls(true));
    const element = link('Paneled');
    vi.spyOn(element, 'matches').mockReturnValue(true);
    act(() => element.focus());
    wait();
    expect(card()).not.toBeNull();
    // The link is followed, as a link the panel shows; the test keeps jsdom from following it.
    document.addEventListener('click', (event) => event.preventDefault(), { once: true });
    fireEvent.click(element, { detail: 0 });
    expect(card()).toBeNull();
    // A click no link card takes, such as on the message's text.
    act(() => element.blur());
    act(() => element.focus());
    wait();
    expect(card()).not.toBeNull();
    fireEvent.click(screen.getByText('Text'), { detail: 0 });
    expect(card()).toBeNull();
  });

  it('shows one preview over nested hosts, and a click card in one hides the other', () => {
    render(
      <MessageLinkCards roomId="!a:x" plugins={HOVER_PLUGINS}>
        {LINKS}
        <MessageLinkCards roomId="!a:x" plugins={HOVER_PLUGINS}>
          <CheckedMessageLink href="https://hover.example/7">Inner</CheckedMessageLink>
          <CheckedMessageLink href="https://github.com/o/r/pull/7">Inner plain</CheckedMessageLink>
        </MessageLinkCards>
      </MessageLinkCards>
    );
    shown();
    const inner = link('Inner');
    vi.spyOn(inner, 'matches').mockReturnValue(true);
    act(() => inner.focus());
    wait();
    expect(screen.getAllByRole('tooltip').map((shownCard) => shownCard.textContent)).toEqual([
      'hover https://hover.example/7 in !a:x',
    ]);
    act(() => inner.blur());
    pointer(screen.getByText('Text'), 'pointermove');
    shown();
    fireEvent.click(link('Inner plain'));
    expect(card()).toBeNull();
    expect(screen.getByText('card https://github.com/o/r/pull/7 in !a:x')).toBeTruthy();
  });

  it('keeps the title off while the card shows, also when the link renders again', () => {
    const { again } = renderHover();
    const element = shown();
    // New elements of the same links: React renders them again, with the title they had.
    again('!a:x', links());
    expect(card()).not.toBeNull();
    expect(element.hasAttribute('title')).toBe(false);
  });

  it('opens for a mouse only on a screen that hovers with a fine pointer, also when the wait ends', () => {
    fine = false;
    renderHover();
    const element = rest();
    wait();
    expect(card()).toBeNull();
    expect(element.getAttribute('title')).toBe('https://hover.example/1');
    fine = true;
    rest();
    fine = false;
    wait();
    expect(card()).toBeNull();
  });

  it('a pen or a touch never opens it, and a touch anywhere hides it', () => {
    renderHover();
    const element = link('Hovered');
    pointer(element, 'pointermove', 'pen');
    pointer(element, 'pointermove', 'touch');
    wait();
    expect(card()).toBeNull();
    rest();
    pointer(document.body, 'pointerdown', 'touch');
    wait();
    expect(card()).toBeNull();
    pointer(screen.getByText('Text'), 'pointermove');
    shown();
    pointer(document.body, 'pointerdown', 'touch');
    expect(card()).toBeNull();
  });

  it('Escape hides it, also while it waits, until the mouse leaves the link', () => {
    renderHover();
    rest();
    fireEvent.keyDown(document, { key: 'Escape' });
    wait();
    expect(card()).toBeNull();
    pointer(screen.getByText('Text'), 'pointermove');
    shown();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(card()).toBeNull();
    rest();
    wait();
    expect(card()).toBeNull();
  });

  it('a scroll, a click, a panel opening and a switch to another room hide it', () => {
    const controls = panelControls();
    const { again } = renderHover(controls);
    shown();
    fireEvent.scroll(window);
    expect(card()).toBeNull();
    pointer(screen.getByText('Text'), 'pointermove');
    shown();
    again('!a:x', LINKS, { ...controls, shown: 'pr/p' });
    expect(card()).toBeNull();
    pointer(screen.getByText('Text'), 'pointermove');
    shown('Second');
    again('!b:x', LINKS, { ...controls, shown: 'pr/p' });
    expect(card()).toBeNull();
    // The plugin never got the new room's ID with the old room's link.
    expect(received.every(({ roomId }) => roomId === '!a:x')).toBe(true);
  });

  it('the click card wins: a click hides the hover card, and none opens while the click card shows', () => {
    renderHover();
    const element = shown();
    pointer(element, 'pointerdown');
    fireEvent.click(element);
    expect(card()).toBeNull();
    expect(screen.getByText('card https://hover.example/1 in !a:x')).toBeTruthy();
    rest('Second');
    wait();
    expect(card()).toBeNull();
  });

  it('opens on keyboard focus and hides on blur', () => {
    renderHover();
    const element = link('Hovered');
    vi.spyOn(element, 'matches').mockReturnValue(true);
    act(() => element.focus());
    wait();
    expect(card()).not.toBeNull();
    act(() => element.blur());
    expect(card()).toBeNull();
  });

  it('a link whose text reads as another address has no card and keeps its title', () => {
    renderHover();
    const element = rest('https://bank.example');
    wait();
    expect(card()).toBeNull();
    expect(element.getAttribute('title')).toBe('https://hover.example/3');
  });

  it.each([
    ['removed', null],
    [
      'given another address',
      <CheckedMessageLink key="1" href="https://hover.example/9">
        Hovered
      </CheckedMessageLink>,
    ],
    [
      'given misleading text',
      <CheckedMessageLink key="1" href="https://hover.example/1">
        https://bank.example
      </CheckedMessageLink>,
    ],
  ])('a link %s loses its card, waiting or shown', async (_change, edited) => {
    const { again } = renderHover();
    rest();
    // The same node, edited in place, or gone.
    again('!a:x', links(edited));
    await settle();
    wait();
    expect(card()).toBeNull();
    again('!a:x', links());
    pointer(screen.getByText('Text'), 'pointermove');
    shown();
    again('!a:x', links(edited));
    await settle();
    expect(card()).toBeNull();
  });

  it('a card that loads shows no empty surface and names nothing', () => {
    renderHover();
    const element = rest('Slow');
    wait();
    expect(card()).toBeNull();
    expect(element.hasAttribute('aria-describedby')).toBe(false);
  });

  it('a throwing card hides and is reported with its tag', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderHover();
    rest('Broken');
    wait();
    expect(card()).toBeNull();
    expect(error).toHaveBeenCalledWith(
      '[plugin hover@1.0.0] failed to render its message link card',
      expect.any(Error)
    );
    expect(mocks.reportBoundaryError).toHaveBeenCalled();
  });
});
