import { createContext } from 'react';

/**
 * Shows a card for a message link and says whether one took the click. A room's page provides it,
 * for the links a client plugin takes; it is undefined outside a room's page.
 */
export const MessageLinkCardContext = createContext<
  ((link: HTMLAnchorElement, href: string) => boolean) | undefined
>(undefined);
