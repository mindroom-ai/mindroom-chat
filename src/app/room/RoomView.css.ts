import { style } from '@vanilla-extract/css';
import { roomArea, shortRoomArea } from '../ui/styles/roomArea.css';

export const RoomArea = style({ containerName: roomArea, containerType: 'size' });

// Shorter than the header, the composer and a couple of rows together (a phone held sideways with
// its keyboard up), the area gives the header's place to the conversation and the composer; the
// header returns with the height.
export const HeaderInShortArea = style({
  '@container': { [shortRoomArea]: { display: 'none' } },
});
