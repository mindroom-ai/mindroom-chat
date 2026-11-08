import type { CallParticipant } from './RoomCall';

/** Grid tiles narrower than this (px) give the stage over to speaker view. */
export const SPEAKER_VIEW_MIN_TILE = 100;

/** The stage keeps this much room (px) around its tiles. */
export const STAGE_PADDING = 8;

/** Room (px) between two tiles of the grid. */
export const TILE_GAP = 6;

export type TileFit = {
  columns: number;
  tileWidth: number;
  tileHeight: number;
  /** How wide each tile would be at 4:3, which decides the columns and speaker view. */
  size: number;
};

/**
 * The column count that makes `count` tiles biggest at 4:3 in a `width` by `height` box, then
 * each tile's own size: as wide as its column up to 16:9, as tall as its row up to square.
 */
export const fitTiles = (count: number, width: number, height: number, gap: number): TileFit => {
  let best = { columns: 1, cw: 0, ch: 0, size: 0 };
  for (let columns = 1; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns);
    const cw = (width - gap * (columns - 1)) / columns;
    const ch = (height - gap * (rows - 1)) / rows;
    const size = Math.min(cw, (ch * 4) / 3);
    if (size > best.size) best = { columns, cw, ch, size };
  }
  const tileWidth = Math.min(best.cw, (best.ch * 16) / 9);
  return {
    columns: best.columns,
    tileWidth,
    tileHeight: Math.min(best.ch, tileWidth),
    size: best.size,
  };
};

/** Someone shows a camera or a screen: the stage shows video tiles rather than voices. */
export const hasVideo = (participants: CallParticipant[]): boolean =>
  participants.some((participant) => !!participant.video || !!participant.screen);

/** The tile key of the screen a participant shares, beside the key of their camera tile. */
export const screenKey = (participant: CallParticipant): string => `${participant.key}:screen`;

/**
 * The tile speaker view puts in focus: a shared screen, someone else's before this device's own
 * (which its sharer has in front of them anyway); else the remote in focus before (`previous`)
 * while it still speaks, so a second speaker does not take the stage from it; else the first
 * remote speaker; else `previous` while still in the call; else the first remote; else whoever
 * is there. This device's own camera is never chosen over someone else's.
 */
export const pickFocus = (
  participants: CallParticipant[],
  previous: string | undefined
): string | undefined => {
  const sharing =
    participants.find((participant) => participant.screen && !participant.local) ??
    participants.find((participant) => participant.screen);
  if (sharing) return screenKey(sharing);
  const remotes = participants.filter((participant) => !participant.local);
  const last = remotes.find(({ key }) => key === previous);
  if (last?.speaking) return last.key;
  const speaking = remotes.find((participant) => participant.speaking);
  return (speaking ?? last ?? remotes[0] ?? participants[0])?.key;
};
