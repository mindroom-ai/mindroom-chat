// `@mindroom/client-sdk/ui`, the client SDK's subpath for plugins whose menus, dialogs, pop-outs
// and rows should look like the app's (docs/architecture.md "Client plugins"): the app's own
// components, with the app's props, which keep the app's theme, glass and reading direction. Like
// `/core` it only grows, and each addition raises CLIENT_PLUGIN_API_VERSION in
// scripts/client-plugins.mjs.
export { Dialog, Header, IconButton, Menu } from '../app/ui/glass/GlassPrimitives';
export { PopOut } from '../app/ui/directional';
export { IconTooltip } from '../app/ui/IconTooltip';
export { MenuEntry, MenuGroup } from '../app/ui/MenuEntry';
export { NavButton, NavItem, NavItemContent } from '../app/ui/nav/NavItem';
