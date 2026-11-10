import {
  type ComponentProps,
  type DragEvent,
  type MouseEvent,
  type SyntheticEvent,
  useContext,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Text } from 'folds';
import { ActionDialog } from '../ui/ActionDialog';
import { MessageLink } from './MessageLink';
import { linkTextMisleads } from './linkDestination';
import { MessageLinkCardContext } from './messageLinkCards';

/** The address as the browser will open it, so an encoded or punycode host shows as such. */
const displayAddress = (href: string): string => {
  try {
    return new URL(href).href;
  } catch {
    return href;
  }
};

// The dialog renders in a portal, but React passes its events up through the link's ancestors,
// such as a thread card that opens its thread on a click; they stop at the dialog.
const stop = (evt: SyntheticEvent) => evt.stopPropagation();

/**
 * A message link that names its real address on hover (its title, whatever the message's HTML
 * says) and, when its visible text reads as an address on another site, shows where it really
 * goes and opens only on a second confirmation. Every way a page sees of opening it asks: a click
 * (also with a new-tab modifier) or Enter, a middle click, the context menu (the browser's offers
 * to open the link; a long press on Android opens it too), and dragging it to the tab bar.
 */
export function CheckedMessageLink({ onClick, ...props }: ComponentProps<typeof MessageLink>) {
  const { t } = useTranslation();
  const { href } = props;
  const [asking, setAsking] = useState(false);
  const anchor = useRef<HTMLAnchorElement | null>(null);
  const confirmed = useRef(false);
  const showCard = useContext(MessageLinkCardContext);

  const misleads = (link: HTMLAnchorElement) =>
    !!href && linkTextMisleads(link.textContent ?? '', href);

  const ask = (evt: MouseEvent<HTMLAnchorElement>) => {
    if (!misleads(evt.currentTarget)) return;
    evt.preventDefault();
    anchor.current = evt.currentTarget;
    setAsking(true);
  };

  const handleClick = (evt: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(evt);
    if (evt.defaultPrevented || !href) return;
    if (confirmed.current) {
      confirmed.current = false;
      return;
    }
    ask(evt);
    if (evt.defaultPrevented) return;
    // A plain click on a link a plugin takes shows its card; a click that opens elsewhere follows the link.
    if (evt.button !== 0 || evt.ctrlKey || evt.metaKey || evt.shiftKey || evt.altKey) return;
    if (showCard?.(evt.currentTarget, href)) {
      evt.preventDefault();
      evt.stopPropagation();
    }
  };

  // A middle click opens the link in a new tab.
  const handleAuxClick = (evt: MouseEvent<HTMLAnchorElement>) => {
    if (evt.button === 1) ask(evt);
  };

  // The question replaces the menu, also a thread card's or a message's own.
  const handleContextMenu = (evt: MouseEvent<HTMLAnchorElement>) => {
    ask(evt);
    if (evt.defaultPrevented) evt.stopPropagation();
  };

  // A link dropped on the tab bar or the address bar opens there.
  const handleDragStart = (evt: DragEvent<HTMLAnchorElement>) => {
    if (misleads(evt.currentTarget)) evt.preventDefault();
  };

  const open = () => {
    setAsking(false);
    // The link itself opens, with its own target and rel, as if clicked without the check.
    confirmed.current = true;
    anchor.current?.click();
  };

  return (
    <>
      <MessageLink
        {...props}
        title={href}
        onClick={handleClick}
        onAuxClick={handleAuxClick}
        onContextMenu={handleContextMenu}
        onDragStart={handleDragStart}
      />
      {asking && href && (
        <span onClick={stop} onKeyDown={stop} role="presentation">
          <ActionDialog
            label={t('mindroomUi.messages.linkCheck.title')}
            onClose={() => setAsking(false)}
            busy={false}
          >
            <Text size="T300">{t('mindroomUi.messages.linkCheck.description')}</Text>
            <Text
              as="p"
              size="T300"
              dir="ltr"
              style={{ overflowWrap: 'anywhere', fontFamily: 'monospace', marginBlock: 0 }}
            >
              {displayAddress(href)}
            </Text>
            <Box justifyContent="End" gap="200">
              <Button
                type="button"
                size="300"
                variant="Secondary"
                fill="Soft"
                onClick={() => setAsking(false)}
              >
                <Text size="B300">{t('threadActions.cancel')}</Text>
              </Button>
              <Button type="button" size="300" variant="Primary" onClick={open}>
                <Text size="B300">{t('mindroomUi.messages.linkCheck.open')}</Text>
              </Button>
            </Box>
          </ActionDialog>
        </span>
      )}
    </>
  );
}
