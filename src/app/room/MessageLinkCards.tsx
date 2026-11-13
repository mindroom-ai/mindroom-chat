import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import FocusTrap from 'focus-trap-react';
import { ErrorBoundary } from 'react-error-boundary';
import { reportBoundaryError } from '../bug-reports/error-reporting/errorReporting';
import { useOptionalClientConfig } from '../config/useClientConfig';
import { useMessageLinkMatcher, type MessageLinkCard } from '../plugins/messageLinks';
import { pluginFailure } from '../plugins/pluginFailure';
import { registeredPlugins, type RegisteredPlugin } from '../plugins/registry';
import { MessageLinkCardContext } from '../rich-text/messageLinkCards';
import { PopOut } from '../ui/directional';
import { Menu } from '../ui/glass/GlassPrimitives';

type Shown = { link: HTMLAnchorElement; href: string; card: MessageLinkCard };

const reportFailure = (tag: string, thrown: unknown, componentStack?: string | null) => {
  // eslint-disable-next-line no-console
  console.error(`[plugin ${tag}] failed to render its message link card`, thrown);
  reportBoundaryError(pluginFailure(tag, thrown), componentStack);
};

/**
 * Shows the card of a client plugin for a link a plain click takes in a room's messages, in a
 * pop-out at the link (docs/client-plugins.md "Message links"). One card shows at a time: another
 * link's card takes its place, and a switch to another room closes it. A card that throws closes
 * and is reported under its plugin's tag. Closing returns focus to the link, if it is still there.
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
  const match = useMessageLinkMatcher(plugins, useOptionalClientConfig());
  const [shown, setShown] = useState<Shown>();

  useEffect(() => setShown(undefined), [roomId]);

  const show = useCallback(
    (link: HTMLAnchorElement, href: string) => {
      const card = match(href);
      if (!card) return false;
      setShown({ link, href, card });
      return true;
    },
    [match]
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

  const anchor = shown?.link.getBoundingClientRect();
  return (
    <MessageLinkCardContext.Provider value={show}>
      {children}
      <PopOut
        anchor={anchor}
        position={anchor && anchor.top > window.innerHeight / 2 ? 'Top' : 'Bottom'}
        align="Start"
        offset={4}
        content={content}
      />
    </MessageLinkCardContext.Provider>
  );
}
