import { createContainer, style } from '@vanilla-extract/css';

// The room area answers its own height: a phone's keyboard shrinks the area, while media queries
// read the layout viewport, which keeps its height under Safari's keyboard.
const roomArea = createContainer();

export const RoomArea = style({ containerName: roomArea, containerType: 'size' });

// Shorter than the header, the composer and a couple of rows together (a phone held sideways with
// its keyboard up), the area gives the header's place to the conversation and the composer; the
// header returns with the height.
export const HeaderInShortArea = style({
  '@container': { [`${roomArea} (max-height: 240px)`]: { display: 'none' } },
});
