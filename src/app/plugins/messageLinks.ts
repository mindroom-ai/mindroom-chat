import { useCallback, type ComponentType } from 'react';
import type { ClientConfig } from '../config/useClientConfig';
import { isRecord } from '../lib/isRecord';
import { isPluginEnabled } from './pluginConfig';
import type { RegisteredPlugin } from './registry';

/** What a plugin's link card is given: the link, the room its message is in, and how to close the card. */
export type MessageLinkCardProps = {
  /** The link's address, as the message has it. */
  href: string;
  /** The room whose message holds the link. */
  roomId: string;
  /** Closes the card. */
  close: () => void;
};

/**
 * Links in a room's message that a plugin takes: a plain click on one shows the plugin's card in a
 * pop-out beside the link, in place of opening it.
 */
export type MessageLink = {
  /** Whether the plugin takes this link; pure and synchronous, given only http and https URLs. */
  match: (url: URL) => boolean;
  /** The card that the link opens. */
  Component: ComponentType<MessageLinkCardProps>;
  /**
   * Since version 62: off a phone, a plain click on the link opens this side panel of the same
   * plugin with `request(url)` instead of showing `Component`. A click while the panel shows,
   * unfolded, the same request follows the link (a new tab). `id` names one of the plugin's
   * `sidePanels`; `request`, pure and synchronous, gives what JSON can hold.
   */
  sidePanel?: { id: string; request: (url: URL) => unknown };
};

/** Whether a plugin's contribution is a message link; the build does not type-check plugins. */
export const isMessageLink = (value: unknown): value is MessageLink =>
  isRecord(value) &&
  typeof value.match === 'function' &&
  !!value.Component &&
  (value.sidePanel === undefined ||
    (isRecord(value.sidePanel) &&
      typeof value.sidePanel.id === 'string' &&
      typeof value.sidePanel.request === 'function'));

/**
 * The card of the plugin that takes a link, with its plugin's tag for logs and error reports, and
 * the side panel a click opens instead, its `id` as `<plugin id>/<panel id>`.
 */
export type MessageLinkCard = {
  tag: string;
  Component: ComponentType<MessageLinkCardProps>;
  sidePanel?: { id: string; request: (url: URL) => unknown };
};

const parseWebUrl = (href: string): URL | undefined => {
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Finds the card for a link: the first entry, in build order, of a plugin that config.json leaves
 * on and whose `match` takes the link. Only http and https links reach a `match`; one that throws
 * counts as no match and is logged with the plugin's tag. An entry's `sidePanel` comes along when
 * its plugin has that panel. The function stays the same while its arguments do.
 */
export const useMessageLinkMatcher = (
  plugins: readonly RegisteredPlugin[],
  config: ClientConfig | undefined
): ((href: string) => MessageLinkCard | undefined) =>
  useCallback(
    (href) => {
      const url = parseWebUrl(href);
      if (!url) return undefined;
      for (const plugin of plugins) {
        if (plugin.messageLinks.length === 0 || !isPluginEnabled(config, plugin.id)) continue;
        for (const { match, Component, sidePanel } of plugin.messageLinks) {
          try {
            if (!match(url)) continue;
            const card: MessageLinkCard = { tag: plugin.tag, Component };
            if (sidePanel && plugin.sidePanels.some(({ id }) => id === sidePanel.id)) {
              card.sidePanel = { id: `${plugin.id}/${sidePanel.id}`, request: sidePanel.request };
            }
            return card;
          } catch (error) {
            // eslint-disable-next-line no-console
            console.error(`[plugin ${plugin.tag}] its message link's match failed`, error);
          }
        }
      }
      return undefined;
    },
    [plugins, config]
  );
