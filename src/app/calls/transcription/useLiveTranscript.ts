import { useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { requestAudienceOpenIdToken } from '../../matrix/openidAudience';
import { useActiveCall } from '../callStore';
import { TranscriptionClient } from './api';
import { followCallEvents } from './liveCallStream';
import {
  applyCallEvent,
  callTranscriptionAtom,
  liveTranscriptAtom,
  type LiveTranscript,
} from './transcriptionState';
import { useTranscriptionServer } from './useTranscriptionServer';

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
};

type StreamView = Omit<LiveTranscriptView, 'ownCall'>;

/** The room's live call, followed on its own stream while `apiUrl` is given. */
const useOwnStream = (
  mx: MatrixClient,
  roomId: string,
  apiUrl: string | undefined,
  discovered: boolean
): StreamView => {
  const [view, setView] = useState<StreamView>({ state: 'loading' });
  useEffect(() => {
    if (!apiUrl) return undefined;
    setView({ state: 'loading' });
    const client = new TranscriptionClient({
      apiUrl,
      getOpenIdToken: () => requestAudienceOpenIdToken(mx, apiUrl, { requireBinding: discovered }),
    });
    const stream = new AbortController();
    let live: LiveTranscript | undefined;
    void followCallEvents(
      client,
      roomId,
      stream.signal,
      (event) => {
        live = applyCallEvent(live, roomId, event);
        setView({ state: 'live', live });
      },
      () => setView({ state: 'unavailable', live })
    ).then((outcome) => {
      if (outcome === 'not-transcribed') setView({ state: 'not-transcribed' });
    });
    return () => stream.abort();
  }, [apiUrl, discovered, mx, roomId]);
  return view;
};

/**
 * The room's live call for its transcript panel: this device's own call as its transcriber
 * follows it, or else one followed here, for as long as the panel shows.
 */
export const useLiveTranscript = (room: Room): LiveTranscriptView => {
  const mx = useMatrixClient();
  const active = useActiveCall();
  const transcription = useAtomValue(callTranscriptionAtom);
  const shared = useAtomValue(liveTranscriptAtom);
  const server = useTranscriptionServer(mx, room);
  const { roomId } = room;
  const ownStatus =
    active?.kind === 'room' &&
    active.call.room.roomId === roomId &&
    transcription?.roomId === roomId
      ? transcription.status
      : undefined;
  const own = useOwnStream(mx, roomId, ownStatus ? undefined : server.apiUrl, server.discovered);

  if (ownStatus) {
    const live = shared?.roomId === roomId ? shared : undefined;
    if (ownStatus === 'unavailable') return { state: 'unavailable', live, ownCall: true };
    return { state: live ? 'live' : 'loading', live, ownCall: true };
  }
  if (!server.apiUrl) return { state: 'not-transcribed', ownCall: false };
  return { ...own, ownCall: false };
};
