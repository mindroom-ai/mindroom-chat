import type { ComponentType } from 'react';
import { useOptionalClientConfig } from '../config/useClientConfig';
import { getMxIdServer } from '../matrix/matrix';
import { isMindroomAgentUserIdForViewer } from '../matrix/protocol/agentIdentity';
import { revealDirectionControls } from '../ui/directional';
import { isPluginEnabled } from './pluginConfig';
import { registeredPlugins } from './registry';

/** A message as a renderer sees it: the content the app renders it from (latest edit included). */
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
  /**
   * A one-line text for the app's compact places (Activity, the Threads page), asked only after
   * `match` took the message. Pure and synchronous; undefined or blank leaves the app's own text.
   */
  preview?: (event: PluginEvent) => string | undefined;
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

/** Tags of the plugins whose `preview` threw, so each is logged once. */
const failedPreviews = new Set<string>();

/** As long as the app's own previews of a message (the thread signals' `PREVIEW_LENGTH`). */
const PREVIEW_LENGTH = 240;

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

/**
 * The text the renderer the timeline picks for `event` gives it (`preview`), on one line, cut as
 * the app cuts its own previews, direction controls written out. Undefined when that
 * renderer has no `preview`, gives no text, or throws: the place then shows the app's own text.
 */
export const useMessagePreview = (
  event: PluginEvent | undefined,
  viewerId: string | undefined
): string | undefined => {
  const matched = useMessageRenderer(event, viewerId);
  if (!matched?.renderer.preview || !event) return undefined;
  let text: unknown;
  try {
    text = matched.renderer.preview(event);
  } catch (error) {
    if (!failedPreviews.has(matched.tag)) {
      failedPreviews.add(matched.tag);
      // eslint-disable-next-line no-console
      console.error(
        `[plugin ${matched.tag}] a message renderer's preview failed; core previews it`,
        error
      );
    }
    return undefined;
  }
  if (typeof text !== 'string') return undefined;
  const line = text.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_LENGTH);
  return line ? revealDirectionControls(line) : undefined;
};
