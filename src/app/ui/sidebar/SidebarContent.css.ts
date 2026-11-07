import { style } from '@vanilla-extract/css';

/**
 * A rail too short to keep its foot group (Inbox, the account, the panel toggle) in place and still
 * show the spaces above it, such as a phone's in landscape: there the whole rail scrolls as one
 * column instead (the foot group takes about 200 px, which left a 330 px rail one entry and a half).
 */
export const shortRail = '(max-height: 500px)';

/** The rail's part above its foot group, which scrolls on its own unless the rail is short. */
export const SidebarScrollPart = style({
  minBlockSize: 0,
  '@media': { [shortRail]: { flexShrink: 0 } },
});
