import type { ComponentType } from 'react';
import type { Room } from 'matrix-js-sdk';
import type { ClientConfig } from '../config/useClientConfig';
import { isRecord } from '../lib/isRecord';
import { isPluginEnabled } from './pluginConfig';
import type { RegisteredPlugin } from './registry';

/** What a thread card badge is given: the thread's room and the ID of its root event. */
export type ThreadCardBadgeProps = { room: Room; threadId: string };

/**
 * A small mark a plugin draws on a thread's card in the Compact view, after the thread's tags. It
 * is drawn inside the card's button, so it renders no control of its own: no button, link or tab
 * stop.
 */
export type ThreadCardBadge = { Component: ComponentType<ThreadCardBadgeProps> };

/**
 * Whether a plugin's contribution is a thread card badge; the build does not type-check plugins.
 */
export const isThreadCardBadge = (value: unknown): value is ThreadCardBadge =>
  isRecord(value) && (typeof value.Component === 'function' || isRecord(value.Component));

/**
 * The badges of the plugins config.json leaves on, in build order, each with its plugin's tag. Each
 * is keyed `<plugin id>/<index in its plugin's list>`.
 */
export const enabledThreadCardBadges = (
  plugins: readonly RegisteredPlugin[],
  config: ClientConfig | undefined
): { key: string; tag: string; Component: ThreadCardBadge['Component'] }[] =>
  plugins
    .filter((plugin) => isPluginEnabled(config, plugin.id))
    .flatMap(({ id, tag, threadCardBadges }) =>
      threadCardBadges.map(({ Component }, index) => ({ key: `${id}/${index}`, tag, Component }))
    );
