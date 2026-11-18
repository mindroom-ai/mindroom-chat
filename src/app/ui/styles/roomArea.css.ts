import { createContainer } from '@vanilla-extract/css';

/**
 * The container of a room's or a thread's area (`RoomView.css.ts` `RoomArea`). It answers its
 * own height: a phone's keyboard shrinks the area, while media queries read the layout viewport,
 * which keeps its height under Safari's keyboard.
 */
export const roomArea = createContainer();

/** Shorter than the header, the composer and a couple of rows together. */
export const shortRoomArea = `${roomArea} (max-height: 240px)`;
