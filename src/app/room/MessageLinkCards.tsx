import {
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import FocusTrap from 'focus-trap-react';
import { ErrorBoundary } from 'react-error-boundary';
import { reportBoundaryError } from '../bug-reports/error-reporting/errorReporting';
import { useOptionalClientConfig } from '../config/useClientConfig';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { useMessageLinkMatcher, type MessageLinkCard } from '../plugins/messageLinks';
import { isPluginEnabled } from '../plugins/pluginConfig';
import { pluginFailure } from '../plugins/pluginFailure';
import { registeredPlugins, type RegisteredPlugin } from '../plugins/registry';
import { PluginPanelControlsContext } from '../plugins/sidePanels';
import {
  MessageLinkCardContext,
  MessageLinkHoverCardContext,
  type MessageLinkHoverCards,
} from '../rich-text/messageLinkCards';
import { PopOut } from '../ui/directional';
import { Menu } from '../ui/glass/GlassPrimitives';
import * as css from './MessageLinkCards.css';

/** How long a mouse rests on a link, or the keyboard's focus, before its hover card shows. */
export const HOVER_CARD_DELAY_MS = 150;

type Shown = { link: HTMLAnchorElement; href: string; card: MessageLinkCard };

const reportFailure = (
  tag: string,
  thrown: unknown,
  componentStack?: string | null,
  what = 'card'
) => {
  // eslint-disable-next-line no-console
  console.error(`[plugin ${tag}] failed to render its message link ${what}`, thrown);
  reportBoundaryError(pluginFailure(tag, thrown), componentStack);
};

/** The request a link's panel opens with, or undefined when `request` throws, which is logged. */
const requestOf = (
  tag: string,
  panel: NonNullable<MessageLinkCard['sidePanel']>,
  href: string
): { request: unknown } | undefined => {
  try {
    return { request: panel.request(new URL(href)) };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[plugin ${tag}] its message link's request failed`, error);
    return undefined;
  }
};

/**
 * Shows the card of a client plugin for a link a plain click takes in a room's messages, in a
 * pop-out at the link (docs/client-plugins.md "Message links"). One card shows at a time: another
 * link's card takes its place, and a switch to another room closes it. A card that throws closes
 * and is reported under its plugin's tag. Closing returns focus to the link, if it is still there.
 * Off a phone and in a room's page, a link whose plugin names a side panel opens that panel
 * instead; while the panel already shows its request, the click follows the link. Either way the
 * card that shows closes.
 * A link whose plugin has a hover card shows it, one at a time, while a mouse rests on it or the
 * keyboard's focus is on it (CheckedMessageLink says when); Escape, a scroll, a click card or panel
 * opening and a switch to another room hide it.
 */
export function MessageLinkCards({
  roomId,
  children,
  plugins = registeredPlugins,
}: {
  roomId: string;
  children: ReactNode;
  plugins?: readonly RegisteredPlugin[];
}) {
  const config = useOptionalClientConfig();
  const match = useMessageLinkMatcher(plugins, config);
  const [shown, setShown] = useState<Shown>();
  const [hovered, setHovered] = useState<Shown>();
  const hoverId = useId();
  const hoverBox = useRef<HTMLDivElement>(null);
  const [, relayout] = useReducer((count: number) => count + 1, 0);
  const hoverCards = plugins.some(
    (plugin) =>
      isPluginEnabled(config, plugin.id) && plugin.messageLinks.some((link) => link.hoverCard)
  );
  // Read in the click, so `show` keeps its identity as the room's panels change.
  const panels = useLatestRef({
    controls: useContext(PluginPanelControlsContext),
    phone: useScreenSizeContext() === ScreenSize.Mobile,
  });

  // The wait for a hover card listens for Escape and a scroll until the card hides.
  const hover = useMemo((): MessageLinkHoverCards => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: HTMLAnchorElement | undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    const onScroll = () => hide();
    const hide = (link?: HTMLAnchorElement) => {
      if (link && link !== current) return;
      clearTimeout(timer);
      current = undefined;
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
      setHovered(undefined);
    };
    return {
      has: (href) => !!match(href)?.hoverCard,
      open: (link, href, still) => {
        const card = match(href);
        if (!card?.hoverCard) return;
        hide();
        current = link;
        document.addEventListener('keydown', onKeyDown);
        window.addEventListener('scroll', onScroll, true);
        timer = setTimeout(
          () => (still() ? setHovered({ link, href, card }) : hide()),
          HOVER_CARD_DELAY_MS
        );
      },
      hide,
    };
  }, [match]);
  useEffect(() => hover.hide, [hover]);

  useEffect(() => {
    setShown(undefined);
    hover.hide();
  }, [roomId, hover]);

  // The link names the card only while it shows.
  useLayoutEffect(() => {
    const link = hovered?.link;
    if (!link) return undefined;
    link.setAttribute('aria-describedby', hoverId);
    return () => link.removeAttribute('aria-describedby');
  }, [hovered, hoverId]);

  // folds' PopOut places itself only as it opens: a card that grows as its data comes is placed again.
  useEffect(() => {
    const box = hoverBox.current;
    if (!box || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => relayout());
    observer.observe(box);
    return () => observer.disconnect();
  }, [hovered]);

  const show = useCallback(
    (link: HTMLAnchorElement, href: string) => {
      const card = match(href);
      if (!card) return false;
      hover.hide();
      const { controls, phone } = panels.current;
      const panel = card.sidePanel;
      // On a phone the panel would cover the room, so the card shows there.
      const asked = panel && controls && !phone ? requestOf(card.tag, panel, href) : undefined;
      if (panel && controls && asked) {
        setShown(undefined);
        // A second click on the link the panel shows opens it, as message links open: a new tab.
        if (controls.showsRequest(panel.id, asked.request)) return false;
        controls.open(panel.id, asked.request);
        return true;
      }
      setShown({ link, href, card });
      return true;
    },
    [match, panels, hover]
  );

  const close = useCallback(() => {
    setShown((current) => {
      if (current?.link.isConnected) current.link.focus();
      return undefined;
    });
  }, []);

  const content = useMemo(() => {
    if (!shown) return undefined;
    const { href, card } = shown;
    return (
      <FocusTrap
        focusTrapOptions={{
          initialFocus: false,
          // close() returns focus to the link; the trap's own target may be another element, as a
          // click does not focus a link in WebKit.
          returnFocusOnDeactivate: false,
          clickOutsideDeactivates: true,
          escapeDeactivates: true,
          onDeactivate: close,
        }}
      >
        <Menu>
          <ErrorBoundary
            key={href}
            fallback={null}
            onError={(thrown: unknown, info) => {
              reportFailure(card.tag, thrown, info.componentStack);
              close();
            }}
          >
            <Suspense fallback={null}>
              <card.Component href={href} roomId={roomId} close={close} />
            </Suspense>
          </ErrorBoundary>
        </Menu>
      </FocusTrap>
    );
  }, [shown, roomId, close]);

  const hoverContent = useMemo(() => {
    const HoverCard = hovered?.card.hoverCard;
    if (!hovered || !HoverCard) return undefined;
    return (
      <Menu role="none" className={css.HoverCard}>
        <div ref={hoverBox} id={hoverId} role="tooltip">
          <ErrorBoundary
            key={hovered.href}
            fallback={null}
            onError={(thrown: unknown, info) => {
              reportFailure(hovered.card.tag, thrown, info.componentStack, 'hover card');
              hover.hide();
            }}
          >
            <Suspense fallback={null}>
              <HoverCard href={hovered.href} roomId={roomId} />
            </Suspense>
          </ErrorBoundary>
        </div>
      </Menu>
    );
  }, [hovered, hoverId, roomId, hover]);

  const anchor = shown?.link.getBoundingClientRect();
  const hoverAnchor = hovered?.link.getBoundingClientRect();
  return (
    <MessageLinkCardContext.Provider value={show}>
      <MessageLinkHoverCardContext.Provider value={hoverCards ? hover : undefined}>
        {children}
      </MessageLinkHoverCardContext.Provider>
      <PopOut
        anchor={anchor}
        position={anchor && anchor.top > window.innerHeight / 2 ? 'Top' : 'Bottom'}
        align="Start"
        offset={4}
        content={content}
      />
      <PopOut
        anchor={hoverAnchor}
        position={hoverAnchor && hoverAnchor.top > window.innerHeight / 2 ? 'Top' : 'Bottom'}
        align="Start"
        offset={4}
        style={{ pointerEvents: 'none' }}
        content={hoverContent}
      />
    </MessageLinkCardContext.Provider>
  );
}
