import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useAtomValue } from 'jotai';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { clientSessions, type ClientSessions } from '../../computer/clientSessions';
import { useRoomMindroomServer } from '../../computer/useRoomMindroomServer';
import { useActiveCall } from '../callStore';
import { TranscriptionClient } from './api';
import { pollLiveCall } from './liveCallPoll';
import {
  applyLiveUpdate,
  callTranscriptionAtom,
  liveTranscriptAtom,
  type LiveTranscript,
} from './transcriptionState';

/**
 * `loading` until MindRoom first tells the room's live call; `live`; `unavailable` while MindRoom
 * cannot be reached (what it said last stays); `not-transcribed` in a room MindRoom does not
 * transcribe.
 */
export type LiveTranscriptState = 'loading' | 'live' | 'unavailable' | 'not-transcribed';

export type LiveTranscriptView = {
  state: LiveTranscriptState;
  live?: LiveTranscript;
  /** It is the call this device is in, transcribed here. */
  ownCall: boolean;
  /** This device knows the room's MindRoom server, so it can read the live call. */
  serverKnown: boolean;
};

type ReadView = Pick<LiveTranscriptView, 'state' | 'live'>;

/** The server and room reads come from, and the last line they read there. */
type LastRead = { client: TranscriptionClient; roomId: string; lineId?: string };

/**
 * One client per account and server, so rows, panels and remounts share it, and reads on the
 * server they left go on after its last line when it comes back.
 */
const clients = new WeakMap<ClientSessions, TranscriptionClient>();

const sharedClient = (mx: MatrixClient, apiUrl: string, discovered: boolean) => {
  const sessions = clientSessions(mx, apiUrl, discovered);
  const client = clients.get(sessions) ?? new TranscriptionClient(sessions);
  clients.set(sessions, client);
  return client;
};

const onVisibilityChange = (onChange: () => void) => {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
};

/** Whether the page shows: a hidden tab reads nothing. */
const usePageShown = () =>
  useSyncExternalStore(onVisibilityChange, () => document.visibilityState !== 'hidden');

/**
 * The room's live call, read every `everyMs` while `wanted` and the page shows, and at once when
 * it shows again.
 */
const useLiveCallReads = (
  room: Room,
  everyMs: number,
  wanted: boolean
): Omit<LiveTranscriptView, 'ownCall'> => {
  const mx = useMatrixClient();
  const reading = usePageShown() && wanted;
  const { roomId } = room;
  const { apiUrl, discovered } = useRoomMindroomServer(mx, roomId);
  const client = useMemo(
    () => (apiUrl ? sharedClient(mx, apiUrl, discovered) : undefined),
    [apiUrl, discovered, mx]
  );
  const [view, setView] = useState<ReadView>({ state: 'loading' });
  const lastRead = useRef<LastRead>();
  useEffect(() => {
    if (!client || !reading) return undefined;
    // What was read of the room on this server stays while reading pauses, and reads that start
    // again go on after its last line; another room's or server's goes.
    const last = lastRead.current;
    const read: LastRead =
      last?.client === client && last.roomId === roomId ? last : { client, roomId };
    lastRead.current = read;
    setView((shown) =>
      read === last && shown.live?.roomId === roomId ? shown : { state: 'loading' }
    );
    const stop = new AbortController();
    void pollLiveCall(
      client,
      roomId,
      everyMs,
      stop.signal,
      (live) => {
        read.lineId = live.lines[live.lines.length - 1]?.id ?? read.lineId;
        setView((shown) => ({
          state: 'live',
          live: applyLiveUpdate(shown.live, roomId, { type: 'live', live }),
        }));
      },
      () => setView((shown) => ({ ...shown, state: 'unavailable' })),
      read.lineId
    ).then((outcome) => {
      if (outcome !== 'not-transcribed') return;
      read.lineId = undefined;
      setView({ state: 'not-transcribed' });
    });
    return () => stop.abort();
  }, [client, everyMs, reading, roomId]);
  return client ? { ...view, serverKnown: true } : { state: 'not-transcribed', serverKnown: false };
};

/**
 * The room's live call: this device's own call as its transcriber reads it, or else one read here
 * every `everyMs` while `reading`.
 */
export const useLiveTranscript = (
  room: Room,
  everyMs: number,
  reading = true
): LiveTranscriptView => {
  const active = useActiveCall();
  const transcription = useAtomValue(callTranscriptionAtom);
  const shared = useAtomValue(liveTranscriptAtom);
  const { roomId } = room;
  const ownStatus =
    active?.kind === 'room' &&
    active.call.room.roomId === roomId &&
    transcription?.roomId === roomId
      ? transcription.status
      : undefined;
  const read = useLiveCallReads(room, everyMs, reading && !ownStatus);

  if (ownStatus) {
    const live = shared?.roomId === roomId ? shared : undefined;
    if (ownStatus === 'unavailable') {
      return { state: 'unavailable', live, ownCall: true, serverKnown: true };
    }
    return { state: live ? 'live' : 'loading', live, ownCall: true, serverKnown: true };
  }
  return { ...read, ownCall: false };
};
