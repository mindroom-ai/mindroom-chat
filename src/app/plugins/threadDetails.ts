import type { ComponentType } from 'react';
import type { Room } from 'matrix-js-sdk';
import type { ClientConfig } from '../config/useClientConfig';
import { isRecord } from '../lib/isRecord';
import { isPluginEnabled } from './pluginConfig';
import type { RegisteredPlugin } from './registry';

/** What a thread detail is given: the thread's room and the ID of its root event. */
export type ThreadDetailProps = { room: Room; threadId: string };

/** A detail a plugin draws about a thread. */
export type ThreadDetail = {
  /** Whether this thread shows it; pure and synchronous. Without it, every thread does. */
  shows?: (room: Room, threadId: string) => boolean;
  Component: ComponentType<ThreadDetailProps>;
};

/** Whether a plugin's contribution is a thread detail; the build does not type-check plugins. */
export const isThreadDetail = (value: unknown): value is ThreadDetail =>
  isRecord(value) &&
  (typeof value.Component === 'function' || isRecord(value.Component)) &&
  (value.shows === undefined || typeof value.shows === 'function');

/** A plugin's detail shown for one thread. */
export type ShownThreadDetail = {
  /** `<plugin id>/<index in its plugin's list>`. */
  key: string;
  /** Its plugin's tag, which names it in logs and error reports. */
  tag: string;
  Component: ThreadDetail['Component'];
};

/**
 * The details the plugins config.json leaves on show for the thread, in build order, each with its
 * plugin's tag. A `shows` that throws leaves out only its entry, logged with the plugin's tag.
 */
export const shownThreadDetails = (
  plugins: readonly RegisteredPlugin[],
  config: ClientConfig | undefined,
  room: Room,
  threadId: string
): ShownThreadDetail[] =>
  plugins
    .filter((plugin) => isPluginEnabled(config, plugin.id))
    .flatMap(({ id, tag, threadDetails }) =>
      threadDetails.flatMap(({ Component, shows }, index) => {
        try {
          if (shows && !shows(room, threadId)) return [];
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error(`[plugin ${tag}] its thread details' shows failed`, error);
          return [];
        }
        return [{ key: `${id}/${index}`, tag, Component }];
      })
    );
