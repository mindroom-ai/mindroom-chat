import { atom } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { getMemberDisplayName } from '../../matrix/room';
import { getMxIdLocalPart } from '../../matrix/matrix';
import type { LiveCall, TranscriptCall, TranscriptLine } from './api';

/**
 * How this device's call is transcribed: `joining` until MindRoom first answers, `transcribing`,
 * or `unavailable` while MindRoom cannot be reached or fails (the call goes on).
 */
export type TranscriptionStatus = 'joining' | 'transcribing' | 'unavailable';

export type CallTranscription = { roomId: string; status: TranscriptionStatus };

/**
 * The transcription of the call this device is in; none without a call, in a call with an agent,
 * and in a room MindRoom does not transcribe.
 */
export const callTranscriptionAtom = atom<CallTranscription | undefined>(undefined);

/**
 * Pause (true) or resume (false) as pressed on this device, until MindRoom answers: this device's
 * capture and the controls follow it at once.
 */
export const pauseRequestAtom = atom<boolean | undefined>(undefined);

/** The live call of a room, as MindRoom's answers and reads of it tell it. */
export type LiveTranscript = LiveCall & { roomId: string };

/**
 * What changes a room's live call: a read of it, which brings the lines after the last one read,
 * the call MindRoom answered Pause with, or the line it answered an upload with.
 */
export type LiveUpdate =
  | { type: 'live'; live: LiveCall }
  | { type: 'call'; call: TranscriptCall }
  | { type: 'line'; line: TranscriptLine };

export const liveTranscriptAtom = atom<LiveTranscript | undefined>(undefined);

/** `line` among `lines` in the order they were said, in place of an earlier copy of it. */
const withLine = (lines: TranscriptLine[], line: TranscriptLine): TranscriptLine[] => {
  const others = lines.filter(({ id }) => id !== line.id);
  const said = Date.parse(line.saidAt);
  const after = others.findIndex((other) => Date.parse(other.saidAt) > said);
  return after === -1
    ? [...others, line]
    : [...others.slice(0, after), line, ...others.slice(after)];
};

/** The room's live call after one update. */
export const applyLiveUpdate = (
  live: LiveTranscript | undefined,
  roomId: string,
  update: LiveUpdate
): LiveTranscript | undefined => {
  const current = live?.roomId === roomId ? live : undefined;
  switch (update.type) {
    case 'live': {
      // Lines of the same call add to those already here; another call (or none) starts over.
      const same = current?.call && current.call.id === update.live.call?.id ? current : undefined;
      return {
        roomId,
        call: update.live.call,
        lines: update.live.lines.reduce(withLine, same?.lines ?? []),
        names: { ...same?.names, ...update.live.names },
      };
    }
    case 'call':
      if (current?.call?.id === update.call.id) return { ...current, call: update.call };
      // A new call starts without lines.
      return { roomId, call: update.call, lines: [], names: current?.names ?? {} };
    case 'line':
      if (!current?.call || current.call.id !== update.line.callId) return live;
      return { ...current, lines: withLine(current.lines, update.line) };
  }
};

/** Who paused the room's live call, as MindRoom last said; null while it is not paused. */
export const pausedByIn = (live: LiveTranscript | undefined, roomId: string): string | null =>
  (live?.roomId === roomId && live.call?.pausedBy) || null;

/**
 * The name someone in the room's call shows under: the room's, which tells apart members who
 * share a name, else the one MindRoom knows them by (a member the room has not loaded yet).
 */
export const nameInCall = (room: Room, live: LiveTranscript | undefined, userId: string): string =>
  getMemberDisplayName(room, userId) ??
  (live?.roomId === room.roomId ? live.names[userId] : undefined) ??
  getMxIdLocalPart(userId) ??
  userId;
