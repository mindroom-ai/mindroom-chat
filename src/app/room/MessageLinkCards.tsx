import {
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import FocusTrap from 'focus-trap-react';
import { config, toRem } from 'folds';
import { ErrorBoundary } from 'react-error-boundary';
import { reportBoundaryError } from '../bug-reports/error-reporting/errorReporting';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { useMessageLinkMatcher, type MessageLinkCard } from '../plugins/messageLinks';
import { isPluginEnabled, usePluginClientConfig } from '../plugins/pluginConfig';
import { pluginFailure } from '../plugins/pluginFailure';
import { registeredPlugins, type RegisteredPlugin } from '../plugins/registry';
import { PluginPanelControlsContext } from '../plugins/sidePanels';
import { linkTextMisleads } from '../rich-text/linkDestination';
import { MessageLinkCardContext, MessageLinkHostContext } from '../rich-text/messageLinkCards';
import { PopOut } from '../ui/directional';
import { Menu } from '../ui/glass/GlassPrimitives';

/** How long a mouse rests on a link, or the keyboard's focus, before its hover card shows. */
export const HOVER_CARD_DELAY_MS = 150;

const FINE_POINTER = '(hover: hover) and (pointer: fine)';
const HOVER_CARD_STYLE = { maxWidth: toRem(320), padding: config.space.S300 };

type Shown = { link: HTMLAnchorElement; href: string; card: MessageLinkCard };

// One preview at a time over every host of the page, such as a thread's inside the room's.
let hideActive: (() => void) | undefined;

/** Adds or removes `id` among the ids that describe `link`, keeping the others. */
const describe = (link: Element, id: string, on: boolean) => {
  const ids = (link.getAttribute('aria-describedby') ?? '').split(' ').filter((o) => o && o !== id);
  if (on) ids.push(id);
  if (ids.length > 0) link.setAttribute('aria-describedby', ids.join(' '));
  else link.removeAttribute('aria-describedby');
};

const reportFailure = (tag: string, thrown: unknown, componentStack?: string | null) => {
  // eslint-disable-next-line no-console
  console.error(`[plugin ${tag}] failed to render its message link card`, thrown);
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
 * A link whose plugin has a hover card shows it while a mouse rests on it or the keyboard's focus
 * is on it, in place of its title; the click card wins over it.
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
  const clientConfig = usePluginClientConfig();
  const match = useMessageLinkMatcher(plugins, clientConfig);
  const [shown, setShown] = useState<Shown>();
  const [hovered, setHovered] = useState<Shown & { roomId: string }>();
  const hideHover = useRef<() => void>();
  const hoverId = useId();
  const [, relayout] = useReducer((count: number) => count + 1, 0);
  const hoverCards = plugins.some(
    (plugin) =>
      isPluginEnabled(clientConfig, plugin.id) && plugin.messageLinks.some((link) => link.hoverCard)
  );
  const panelControls = useContext(PluginPanelControlsContext);
  // Read in the click, so `show` keeps its identity as the room's panels change.
  const panels = useLatestRef({
    controls: panelControls,
    phone: useScreenSizeContext() === ScreenSize.Mobile,
  });
  const latest = useLatestRef({ roomId, shown });

  useEffect(() => setShown(undefined), [roomId]);
  useEffect(
    () => setShown((current) => (current && match(current.href) ? current : undefined)),
    [match]
  );
  useEffect(() => hideHover.current?.(), [roomId, shown, panelControls?.shown]);

  useEffect(() => {
    if (!hoverCards) return undefined;
    const fine = window.matchMedia?.(FINE_POINTER);
    let link: HTMLAnchorElement | undefined;
    let href: string | undefined;
    let title: string | null = null;
    // A link whose card a press or Escape hid keeps it hidden until the pointer leaves it.
    let dismissed: Element | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let point = { x: 0, y: 0 };
    const cardOf = (target: EventTarget | null | undefined) => {
      const found = target instanceof Element ? target.closest('a[data-message-link]') : null;
      const at = found?.getAttribute('href');
      if (!(found instanceof HTMLAnchorElement) || !at || !found.isConnected) return undefined;
      // A link of a nested host's messages is that host's.
      if (found.getAttribute('data-message-link') !== hoverId) return undefined;
      if (linkTextMisleads(found.textContent ?? '', at)) return undefined;
      const card = match(at);
      return card?.hoverCard ? { link: found, href: at, card } : undefined;
    };
    // An edit can change the link's address or make its text mislead; a removal takes it away.
    const changes = new MutationObserver((records) => {
      const shownLink = link;
      if (!shownLink) return;
      if (shownLink.isConnected && !records.some(({ target }) => shownLink.contains(target))) {
        return;
      }
      if (cardOf(shownLink)?.href !== href) hide();
    });
    const press = () => {
      dismissed = link;
      hide();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') press();
    };
    const hide = () => {
      if (!link) return;
      clearTimeout(timer);
      timer = undefined;
      changes.disconnect();
      document.removeEventListener('pointerdown', press, true);
      document.removeEventListener('click', press, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', hide, true);
      if (title !== null && !link.hasAttribute('title')) link.setAttribute('title', title);
      link = undefined;
      if (hideActive === hide) hideActive = undefined;
      setHovered(undefined);
    };
    const arm = (found: NonNullable<ReturnType<typeof cardOf>>, still: () => boolean) => {
      if (found.link !== link) {
        hideActive?.();
        hideActive = hide;
        ({ link, href } = found);
        title = link.getAttribute('title');
        link.removeAttribute('title');
        changes.observe(document.body, { subtree: true, childList: true, characterData: true });
        changes.observe(link, { attributes: true, attributeFilter: ['href'] });
        // Any press or click hides it, also Enter on a link.
        document.addEventListener('pointerdown', press, true);
        document.addEventListener('click', press, true);
        document.addEventListener('keydown', onKeyDown);
        window.addEventListener('scroll', hide, { capture: true, passive: true });
      } else if (!timer) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        const now = cardOf(link);
        if (!now || now.href !== href || !still() || latest.current.shown) return hide();
        return setHovered({ ...now, roomId: latest.current.roomId });
      }, HOVER_CARD_DELAY_MS);
    };
    const underPointer = (target: Element) =>
      typeof document.elementFromPoint !== 'function' ||
      cardOf(document.elementFromPoint(point.x, point.y))?.link === target;
    const byMouse = () => fine?.matches === true;
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      point = { x: event.clientX, y: event.clientY };
      const found = byMouse() ? cardOf(event.target) : undefined;
      if (found && found.link === dismissed) return;
      dismissed = undefined;
      if (!found) return hide();
      return arm(found, () => byMouse() && underPointer(found.link));
    };
    // The pointer left the link, for something outside it or another window (an iframe too).
    const onOut = (event: PointerEvent) => {
      // A hovering pen passing by keeps a card the keyboard opened.
      if (event.pointerType !== 'mouse') return;
      const left = link ?? dismissed;
      const to = event.relatedTarget;
      if (to instanceof Node && !(left?.contains(event.target as Node) && !left.contains(to))) {
        return;
      }
      dismissed = undefined;
      hide();
    };
    const onFocusIn = (event: FocusEvent) => {
      const found = cardOf(event.target);
      if (found?.link.matches(':focus-visible')) {
        arm(found, () => document.activeElement === found.link);
      }
    };
    const onFocusOut = (event: FocusEvent) => {
      if (event.target === link) hide();
    };
    const listeners: [string, EventListener][] = [
      ['pointermove', onMove as EventListener],
      ['pointerout', onOut as EventListener],
      ['focusin', onFocusIn as EventListener],
      ['focusout', onFocusOut as EventListener],
    ];
    for (const [type, listener] of listeners) document.addEventListener(type, listener);
    hideHover.current = hide;
    return () => {
      hide();
      hideHover.current = undefined;
      for (const [type, listener] of listeners) document.removeEventListener(type, listener);
    };
  }, [hoverCards, match, latest, hoverId]);

  const show = useCallback(
    (link: HTMLAnchorElement, href: string) => {
      const card = match(href);
      if (!card) return false;
      hideActive?.();
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
    [match, panels]
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

  // A preview belongs to the room it was hovered in: it never renders with another room's ID.
  const visible = hovered?.roomId === roomId ? hovered : undefined;
  const hoverContent = useMemo(() => {
    const HoverCard = visible?.card.hoverCard;
    if (!visible || !HoverCard) return undefined;
    let resize: ResizeObserver | undefined;
    // The surface mounts once its card has loaded: then the link names it, and folds' PopOut,
    // which places itself only as it opens, places it again as its data grows it.
    const surface = (element: HTMLDivElement | null) => {
      describe(visible.link, hoverId, !!element);
      resize?.disconnect();
      if (!element || typeof ResizeObserver === 'undefined') return;
      resize = new ResizeObserver(() => relayout());
      resize.observe(element);
    };
    return (
      <ErrorBoundary
        key={visible.href}
        fallback={null}
        onError={(thrown: unknown, info) => {
          reportFailure(visible.card.tag, thrown, info.componentStack);
          hideHover.current?.();
        }}
      >
        <Suspense fallback={null}>
          <Menu ref={surface} id={hoverId} role="tooltip" style={HOVER_CARD_STYLE}>
            <HoverCard href={visible.href} roomId={visible.roomId} />
          </Menu>
        </Suspense>
      </ErrorBoundary>
    );
  }, [visible, hoverId]);

  const anchor = shown?.link.getBoundingClientRect();
  const hoverAnchor = hoverContent && visible?.link.getBoundingClientRect();
  return (
    <MessageLinkCardContext.Provider value={show}>
      <MessageLinkHostContext.Provider value={hoverCards ? hoverId : undefined}>
        {children}
      </MessageLinkHostContext.Provider>
      <PopOut
        anchor={anchor}
        position={anchor && anchor.top > window.innerHeight / 2 ? 'Top' : 'Bottom'}
        align="Start"
        offset={4}
        content={content}
      />
      {hoverAnchor && (
        <PopOut
          anchor={hoverAnchor}
          position={hoverAnchor.top > window.innerHeight / 2 ? 'Top' : 'Bottom'}
          align="Start"
          offset={4}
          style={{ pointerEvents: 'none' }}
          content={hoverContent}
        />
      )}
    </MessageLinkCardContext.Provider>
  );
}
