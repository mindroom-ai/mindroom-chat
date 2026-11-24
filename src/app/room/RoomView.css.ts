import { globalStyle, style } from '@vanilla-extract/css';
import { Bar, Listed } from '../background-jobs/BackgroundJobsBar.css';
import { TypingStrip } from '../timeline/typing/RoomViewTyping.css';
import { DockBars, dockRowReserve } from '../ui/styles/RoomOverlay.css';
import { roomArea, shortRoomArea } from '../ui/styles/roomArea.css';

export const RoomArea = style({ containerName: roomArea, containerType: 'size' });

// Shorter than the header, the composer and a couple of rows together (a phone held sideways with
// its keyboard up), the area gives the header's place to the conversation and the composer; the
// header returns with the height.
export const HeaderInShortArea = style({
  '@container': { [shortRoomArea]: { display: 'none' } },
});

// In that same short area, drop the empty-dock reservation so Jump to Latest fits inside the
// visible band when the dock is empty while still clearing an occupied dock via `footerInset`.
export const TimelineArea = style({
  '@container': { [shortRoomArea]: { vars: { [dockRowReserve]: '0px' } } },
});

// A typing strip that holds the keyboard keeps listed jobs beside it, so its button stays in sight.
globalStyle(`${DockBars}:has(> ${TypingStrip}:focus-within) > ${Listed} > ${Bar}`, {
  position: 'relative',
});
