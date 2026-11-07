import type { ComponentType } from 'react';
import { useOptionalClientConfig } from '../config/useClientConfig';
import { getMxIdServer } from '../matrix/matrix';
import { isMindroomAgentUserIdForViewer } from '../matrix/protocol/agentIdentity';
import { isPluginEnabled } from './pluginConfig';
import { registeredPlugins } from './registry';

/** A message as a renderer sees it: its content as the app shows it (latest edit included). */
export type PluginEvent = {
  eventId?: string;
  roomId?: string;
  /** The Matrix event type, such as `m.room.message`. */
  type?: string;
  sender: string;
  content: Readonly<Record<string, unknown>>;
};

/** A plugin's own rendering of the messages it matches, in place of the app's. */
export type MessageRenderer = {
  /** Whether this renderer shows `event`: pure and synchronous, asked on every render. */
  match: (event: PluginEvent) => boolean;
  Component: ComponentType<{ event: PluginEvent }>;
  /**
   * Whose messages it may show: `agent` (the default) a MindRoom agent on the viewer's homeserver,
   * `server` anyone on the viewer's homeserver.
   */
  trust?: 'agent' | 'server';
};

/** The renderer that takes a message, and its plugin's tag. */
export type MatchedRenderer = { tag: string; renderer: MessageRenderer };

const trusts = (trust: MessageRenderer['trust'], sender: string, viewerId: string): boolean => {
  if (trust !== 'server') return isMindroomAgentUserIdForViewer(sender, viewerId);
  const server = getMxIdServer(sender);
  return !!server && server === getMxIdServer(viewerId);
};

/** Tags of the plugins whose `match` threw, so each is logged once. */
const failedMatches = new Set<string>();

const matches = (tag: string, renderer: MessageRenderer, event: PluginEvent): boolean => {
  try {
    return renderer.match(event);
  } catch (error) {
    if (!failedMatches.has(tag)) {
      failedMatches.add(tag);
      // eslint-disable-next-line no-console
      console.error(`[plugin ${tag}] a message renderer's match failed; core renders it`, error);
    }
    return false;
  }
};

/**
 * The first renderer that takes `event`: plugins in build order, each plugin's renderers in its
 * order, skipping plugins config.json turns off and renderers that do not trust the sender.
 */
export const useMessageRenderer = (
  event: PluginEvent | undefined,
  viewerId: string | undefined
): MatchedRenderer | undefined => {
  const config = useOptionalClientConfig();
  if (!event || !viewerId) return undefined;
  for (const { id, tag, messageRenderers } of registeredPlugins) {
    if (!isPluginEnabled(config, id)) continue;
    const renderer = messageRenderers.find(
      (candidate) =>
        trusts(candidate.trust, event.sender, viewerId) && matches(tag, candidate, event)
    );
    if (renderer) return { tag, renderer };
  }
  return undefined;
};
