import { globalStyle, style } from '@vanilla-extract/css';
import { Anchor } from '../background-jobs/BackgroundJobsBar.css';
import { TypingStrip } from '../timeline/typing/RoomViewTyping.css';
import { DockBars } from '../ui/styles/RoomOverlay.css';
import { roomArea, shortRoomArea } from '../ui/styles/roomArea.css';

export const RoomArea = style({ containerName: roomArea, containerType: 'size' });

// Shorter than the header, the composer and a couple of rows together (a phone held sideways with
// its keyboard up), the area gives the header's place to the conversation and the composer; the
// header returns with the height.
export const HeaderInShortArea = style({
  '@container': { [shortRoomArea]: { display: 'none' } },
});

// Listed background jobs take the dock's whole line: the typing strip beside their bar gives way
// until the list folds, so on a phone the rows are not squeezed into what the strip leaves.
globalStyle(`${DockBars}:has(> ${Anchor}[data-takes-line]) > ${TypingStrip}`, {
  display: 'none',
});
