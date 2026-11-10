// `@mindroom/client-sdk/ui`, the client SDK's subpath for plugins whose menus, dialogs, pop-outs,
// rows and text should look like the app's (docs/architecture.md "Client plugins"): the app's own
// components, with the app's props, which keep the app's theme, glass and reading direction, text
// as the app renders it, and for a surface a plugin draws itself the app's theme kind, its screen
// size, its PDF frame, the motion of the room's side panels and the mark that keeps its pinches.
// Like `/core` it only grows, and each addition raises CLIENT_PLUGIN_API_VERSION in
// scripts/client-plugins.mjs.
import { useMemo, useSyncExternalStore } from 'react';
import type { Room } from 'matrix-js-sdk';
import { useOptionalClientConfig } from '../app/config/useClientConfig';
import { replaceMatrixUserIdsWithDisplayNames as replaceInApp } from '../app/event-store/threads/threadMessagePreview';
import { renderLiveMarkdown, useLiveMarkdownReady } from '../app/messages/live/liveMarkdown';
import { sanitizeCustomHtml } from '../app/rich-text/sanitize';
import { subscribeAppliedTheme } from '../app/theme/appliedTheme';
import { ThemeKind } from '../app/theme/useTheme';

export { Dialog, Header, IconButton, Menu } from '../app/ui/glass/GlassPrimitives';
export { PopOut } from '../app/ui/directional';
export { IconTooltip } from '../app/ui/IconTooltip';
export { MenuEntry, MenuGroup } from '../app/ui/MenuEntry';
export { NavButton, NavItem, NavItemContent } from '../app/ui/nav/NavItem';
// The app's `Mobile`, `Tablet` or `Desktop`, as it lays out, rendered again when that changes.
export { useScreenSizeContext as useScreenSize } from '../app/lib/hooks/useScreenSize';
export { pdfFrameUrl } from '../app/messages/viewers/pdfFrame';
// The attribute that marks an element whose pinches are its own, which the app's page zoom leaves
// to it.
export { PINCH_SURFACE_ATTRIBUTE } from '../app/theme/usePinchToZoom';
// A side panel that draws its own frame moves in and out as the room's panels do: its phase in the
// room's panel place, which waits for it once it registers, and the room's motion of a panel's width.
export { animatePanel, usePanelPresence } from '../app/ui/panels/panelPresence';
export type {
  PanelPhase,
  PanelPresence,
  PanelRegistration,
  PanelSize,
} from '../app/ui/panels/panelPresence';

// The kind of the theme on the page, which the app marks on the root element as it applies one.
const appliedThemeKind = (): ThemeKind =>
  document.documentElement.dataset.themeKind === ThemeKind.Dark ? ThemeKind.Dark : ThemeKind.Light;

/**
 * `light` or `dark`, as the app applies its theme, the person's choice or the system's, rendered
 * again once another kind is on the page.
 */
export const useThemeKind = (): ThemeKind =>
  useSyncExternalStore(subscribeAppliedTheme, appliedThemeKind);

/** `html` with only what the app keeps of a message's HTML, under the app's default policy. */
export const sanitizeHtml = (html: string): string => sanitizeCustomHtml(html);

/**
 * The sanitized HTML of `markdown` as the app renders an agent's reply, or undefined until the
 * Markdown renderer has loaded; it starts loading it and renders again once it has.
 */
export const useMarkdownHtml = (markdown: string): string | undefined => {
  const ready = useLiveMarkdownReady();
  // The deployment's link schemes, which the timeline allows in an agent's reply too.
  const schemes = useOptionalClientConfig()?.messageRendering?.additionalAllowedUriSchemes;
  return useMemo(() => {
    const html = ready ? renderLiveMarkdown(markdown) : undefined;
    return html === undefined
      ? undefined
      : sanitizeCustomHtml(html, { additionalAllowedUriSchemes: schemes });
  }, [ready, markdown, schemes]);
};

/**
 * `text` with each Matrix user ID of a member of `room` replaced by their name there, also before
 * trailing punctuation, as the app's thread previews show it; other IDs stay.
 */
export const replaceMatrixUserIdsWithDisplayNames = (room: Room, text: string): string =>
  replaceInApp(room, text);
