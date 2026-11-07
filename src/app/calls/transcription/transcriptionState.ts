import { atom } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { getMemberDisplayName } from '../../matrix/room';
import { getMxIdLocalPart } from '../../matrix/matrix';
import type { CallEvent, LiveCall, TranscriptLine } from './api';

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

/** This device holds Pause: its capture pauses at once, before MindRoom answers. */
export const pauseHeldAtom = atom(false);

/** The live call of the room this device is in a call in, as MindRoom's event stream tells it. */
export type LiveTranscript = LiveCall & { roomId: string };

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

/** The room's live call after one event of its stream (or a line MindRoom answered an upload with). */
export const applyCallEvent = (
  live: LiveTranscript | undefined,
  roomId: string,
  event: CallEvent
): LiveTranscript | undefined => {
  const current = live?.roomId === roomId ? live : undefined;
  switch (event.type) {
    case 'ready':
      return { roomId, ...event.live };
    case 'call':
      if (current?.call?.id === event.call.id) return { ...current, call: event.call };
      // A new call starts without lines.
      return { roomId, call: event.call, lines: [], names: current?.names ?? {} };
    case 'line':
      if (!current?.call || current.call.id !== event.line.callId) return live;
      return { ...current, lines: withLine(current.lines, event.line) };
    case 'ended':
      if (current?.call?.id !== event.callId) return live;
      return { ...current, call: null, lines: [] };
  }
};

/** Who holds Pause in the room's live call, as MindRoom last said. */
export const heldBy = (live: LiveTranscript | undefined, roomId: string): string[] =>
  (live?.roomId === roomId && live.call?.holds) || [];

/** Whether anyone holds Pause in the room's live call, as MindRoom last said. */
export const heldInCall = (live: LiveTranscript | undefined, roomId: string): boolean =>
  heldBy(live, roomId).length > 0;

/**
 * The name someone in the room's call shows under: the room's, which tells apart members who
 * share a name, else the one MindRoom knows them by (a member the room has not loaded yet).
 */
export const nameInCall = (room: Room, live: LiveTranscript | undefined, userId: string): string =>
  getMemberDisplayName(room, userId) ??
  (live?.roomId === room.roomId ? live.names[userId] : undefined) ??
  getMxIdLocalPart(userId) ??
  userId;
