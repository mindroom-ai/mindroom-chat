import { createContext } from 'react';

/**
 * Shows a card for a message link and says whether one took the click. A room's page provides it,
 * for the links a client plugin takes; it is undefined outside a room's page.
 */
export const MessageLinkCardContext = createContext<
  ((link: HTMLAnchorElement, href: string) => boolean) | undefined
>(undefined);

/** The hover cards of the links client plugins take, in a room's page that has any. */
export type MessageLinkHoverCards = {
  /** Whether the plugin that takes `href` has a hover card. */
  has: (href: string) => boolean;
  /** Shows the link's hover card in a moment, if `still()` holds then. */
  open: (link: HTMLAnchorElement, href: string, still: () => boolean) => void;
  /** Hides the hover card, or stops the wait for it; given a link, only that link's. */
  hide: (link?: HTMLAnchorElement) => void;
};

export const MessageLinkHoverCardContext = createContext<MessageLinkHoverCards | undefined>(
  undefined
);
