// `@mindroom/client-sdk/ui`, the client SDK's subpath for plugins whose menus, dialogs, pop-outs,
// rows and text should look like the app's (docs/architecture.md "Client plugins"): the app's own
// components, with the app's props, which keep the app's theme, glass and reading direction, and
// text as the app renders it. Like `/core` it only grows, and each addition raises
// CLIENT_PLUGIN_API_VERSION in scripts/client-plugins.mjs.
import { useMemo } from 'react';
import type { Room } from 'matrix-js-sdk';
import { replaceMatrixUserIdsWithDisplayNames as replaceInApp } from '../app/event-store/threads/threadMessagePreview';
import { renderLiveMarkdown, useLiveMarkdownReady } from '../app/messages/live/liveMarkdown';
import { sanitizeCustomHtml } from '../app/rich-text/sanitize';

export { Dialog, Header, IconButton, Menu } from '../app/ui/glass/GlassPrimitives';
export { PopOut } from '../app/ui/directional';
export { IconTooltip } from '../app/ui/IconTooltip';
export { MenuEntry, MenuGroup } from '../app/ui/MenuEntry';
export { NavButton, NavItem, NavItemContent } from '../app/ui/nav/NavItem';

/** `html` with only what the app keeps of a message's HTML, under the app's own policy. */
export const sanitizeHtml = (html: string): string => sanitizeCustomHtml(html);

/**
 * The sanitized HTML of `markdown` as the app renders an agent's reply, or undefined until the
 * Markdown renderer has loaded; it starts loading it and renders again once it has.
 */
export const useMarkdownHtml = (markdown: string): string | undefined => {
  const ready = useLiveMarkdownReady();
  return useMemo(() => {
    const html = ready ? renderLiveMarkdown(markdown) : undefined;
    return html === undefined ? undefined : sanitizeCustomHtml(html);
  }, [ready, markdown]);
};

/**
 * `text` with each Matrix user ID of a member of `room` replaced by their name there, also before
 * trailing punctuation, as the app's thread previews show it; other IDs stay.
 */
export const replaceMatrixUserIdsWithDisplayNames = (room: Room, text: string): string =>
  replaceInApp(room, text);
