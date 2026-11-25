import { globalStyle, style } from '@vanilla-extract/css';
import { config } from 'folds';
import { Bar, Listed } from '../background-jobs/BackgroundJobsBar.css';
import { Following } from '../timeline/RoomViewFollowing.css';
import { TypingStrip } from '../timeline/typing/RoomViewTyping.css';
import { DockBars, DockRow, footerInset, jumpLane } from '../ui/styles/RoomOverlay.css';
import { compactJumpArea, roomArea, shortRoomArea } from '../ui/styles/roomArea.css';

export const RoomArea = style({ containerName: roomArea, containerType: 'size' });

// Shorter than the header, the composer and a couple of rows together (a phone held sideways with
// its keyboard up), the area gives the header's place to the conversation and the composer; the
// header returns with the height.
export const HeaderInShortArea = style({
  '@container': { [shortRoomArea]: { display: 'none' } },
});

// When Jump to Latest is shown without a full-width jobs or approvals bar, give DockRow a
// symmetric 3-column grid so typing and "following" sit in the outer lanes beside Jump to Latest
// with zero vertical jump.
const sharedDock = `${RoomArea}:has([data-jump-to-latest]):not(:has([data-jobs-bar], [data-approvals-bar]))`;
globalStyle(`${sharedDock} ${DockRow}`, {
  vars: { [jumpLane]: '11rem' },
  display: 'grid',
  gridTemplateColumns: `minmax(0, 1fr) ${jumpLane} minmax(0, 1fr)`,
  alignItems: 'end',
  columnGap: config.space.S300,
  // CSS pixels (matching MIN_TARGET in touchTarget.ts) so the center lane holds the full 44 px
  // touch target independently of zoom level.
  '@container': { [compactJumpArea]: { vars: { [jumpLane]: '44px' } } },
});
globalStyle(`${sharedDock} ${DockBars}`, {
  gridColumn: '1',
  minWidth: 0,
});
globalStyle(`${sharedDock} ${Following}`, {
  gridColumn: '3',
  justifySelf: 'end',
  maxInlineSize: '100%',
  marginInlineStart: 0,
});

// Full-width dock bars (background jobs or thread approvals) keep DockRow full width and lift
// Jump to Latest above the dock.
const blockedDock = `${RoomArea}:has([data-jobs-bar], [data-approvals-bar])`;
globalStyle(`${blockedDock} [data-jump-to-latest]`, {
  bottom: `calc(${footerInset} + ${config.space.S400})`,
  maxWidth: `calc(100% - ${config.space.S400} * 2)`,
});

// A typing strip that holds the keyboard keeps listed jobs beside it, so its button stays in sight.
globalStyle(`${DockBars}:has(> ${TypingStrip}:focus-within) > ${Listed} > ${Bar}`, {
  position: 'relative',
});
