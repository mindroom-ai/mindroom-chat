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

/**
 * One entry per person, in the order each first joined, for the places that show people rather
 * than devices (the voice stage, speaker view's faces, the window's bar): someone on a phone and a
 * laptop shows once, speaking, connected and heard while any of their devices is, and as this
 * device's person when one of the devices is this one.
 */
export const byPerson = (participants: CallParticipant[]): CallParticipant[] => {
  const people = new Map<string, CallParticipant>();
  participants.forEach((device) => {
    const known = people.get(device.userId);
    people.set(
      device.userId,
      known
        ? {
            ...known,
            local: known.local || device.local,
            connected: known.connected || device.connected,
            speaking: known.speaking || device.speaking,
            microphone: known.microphone || device.microphone,
          }
        : device
    );
  });
  return [...people.values()];
};

/** The tile key of the screen a participant shares, beside the key of their camera tile. */
export const screenKey = (participant: CallParticipant): string => `${participant.key}:screen`;

/**
 * The participants who share a screen, in their order but this device's own last (its sharer has
 * it in front of them anyway).
 */
export const sharedScreens = (participants: CallParticipant[]): CallParticipant[] => {
  const sharing = participants.filter((participant) => participant.screen);
  return [...sharing.filter(({ local }) => !local), ...sharing.filter(({ local }) => local)];
};

/**
 * What a pick of speaker view or the grid holds for: while someone else shares a screen, the
 * screens shared then (keys, space-separated), so new shares open at their default again; else
 * none (''), where the person's pick of the call holds.
 */
export const pickScope = (participants: CallParticipant[]): string => {
  const screens = sharedScreens(participants);
  return screens.some(({ local }) => !local) ? screens.map(screenKey).join(' ') : '';
};

/** What the video stage shows: speaker view or the grid, and whether the switch is held. */
export type StageView = { speaker: boolean; held: boolean };

/**
 * Speaker view or the grid. While grid tiles would be too small (`tiny`), the stage holds it:
 * speaker view, or the rows of two or more shared screens, which scroll. Else the person's `pick`,
 * and without one speaker view while someone else shares the one shared screen, the grid
 * otherwise (where the shared screens show as rows over everyone's tiles).
 */
export const stageView = (
  participants: CallParticipant[],
  tiny: boolean,
  pick: boolean | undefined
): StageView => {
  const screens = sharedScreens(participants);
  if (tiny) return { speaker: screens.length < 2, held: true };
  const theirs = screens.length === 1 && !screens[0]?.local;
  return { speaker: pick ?? theirs, held: false };
};

/**
 * The tile speaker view puts in focus: the first screen someone else shares; else the remote in
 * focus before (`previous`) while it still speaks, so a second speaker does not take the stage from
 * it; else the first remote speaker; else `previous` while still in the call; else the first
 * remote; else whoever is there. This device's own camera is never chosen over someone else's, and
 * its own screen never (its sharer has it before them).
 */
export const pickFocus = (
  participants: CallParticipant[],
  previous: string | undefined
): string | undefined => {
  const sharing = participants.find((participant) => participant.screen && !participant.local);
  if (sharing) return screenKey(sharing);
  const remotes = participants.filter((participant) => !participant.local);
  const last = remotes.find(({ key }) => key === previous);
  if (last?.speaking) return last.key;
  const speaking = remotes.find((participant) => participant.speaking);
  return (speaking ?? last ?? remotes[0] ?? participants[0])?.key;
};
