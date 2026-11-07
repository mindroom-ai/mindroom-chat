import { useEffect, useRef } from 'react';
import { useAtomValue, useStore } from 'jotai';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { requestAudienceOpenIdToken } from '../../matrix/openidAudience';
import { useActiveCall, useCallState } from '../callStore';
import type { RoomCall } from '../RoomCall';
import type { CallTranscriber } from './callTranscriber';
import {
  applyLiveUpdate,
  callTranscriptionAtom,
  liveTranscriptAtom,
  pausedByIn,
  pauseRequestAtom,
} from './transcriptionState';
import { useTranscriptionServer } from './useTranscriptionServer';

/** Transcribes this device's speech while it is connected to `call`. */
function RoomCallTranscription({ call }: { call: RoomCall }) {
  const mx = useMatrixClient();
  const store = useStore();
  const { roomId } = call.room;
  const server = useTranscriptionServer(mx, call.room);
  const state = useCallState(call);
  const connected = state.phase === 'connected' || state.phase === 'reconnecting';
  const apiUrl = connected ? server.apiUrl : undefined;
  const { discovered } = server;
  // A muted microphone sends nothing.
  const track = state.microphone ? state.microphoneTrack : undefined;
  // Paused as MindRoom says, and at once when Pause or Resume is pressed here, until MindRoom
  // answered every request: nothing said before it resumed is sent.
  const request = useAtomValue(pauseRequestAtom);
  const live = useAtomValue(liveTranscriptAtom);
  const paused = request !== undefined || !!pausedByIn(live, roomId);
  /** Pause and Resume requests MindRoom has not answered yet. */
  const unanswered = useRef(0);

  const transcriberRef = useRef<CallTranscriber>();
  const latest = useRef({ track, paused });
  latest.current = { track, paused };

  useEffect(() => {
    if (!apiUrl) return undefined;
    let current = true;
    let transcriber: CallTranscriber | undefined;
    store.set(callTranscriptionAtom, { roomId, status: 'joining' });
    // Loaded on the first call MindRoom may transcribe, with the speech finder and the routes.
    import('./callTranscriber').then(
      ({ CallTranscriber: Transcriber }) => {
        if (!current) return;
        transcriber = new Transcriber({
          roomId,
          apiUrl,
          getOpenIdToken: () =>
            requestAudienceOpenIdToken(mx, apiUrl, { requireBinding: discovered }),
          onStatus: (status) => {
            if (!current) return;
            store.set(callTranscriptionAtom, status === 'off' ? undefined : { roomId, status });
          },
          onUpdate: (update) => {
            if (!current) return;
            store.set(liveTranscriptAtom, (shown) => applyLiveUpdate(shown, roomId, update));
          },
        });
        transcriberRef.current = transcriber;
        transcriber.setMicrophone(latest.current.track);
        transcriber.setPaused(latest.current.paused);
        transcriber.start();
      },
      () => {
        // Without its part (offline after a deployment) the call goes on untranscribed.
        if (current) store.set(callTranscriptionAtom, undefined);
      }
    );
    return () => {
      current = false;
      transcriberRef.current = undefined;
      void transcriber?.end();
      store.set(callTranscriptionAtom, undefined);
      store.set(liveTranscriptAtom, undefined);
      store.set(pauseRequestAtom, undefined);
    };
  }, [apiUrl, call, discovered, mx, roomId, store]);

  useEffect(() => {
    transcriberRef.current?.setMicrophone(track);
  }, [track]);

  useEffect(() => {
    transcriberRef.current?.setPaused(paused);
  }, [paused]);

  // Pause pressed here goes to MindRoom; once it answered (or refused) every request, the request
  // ends.
  useEffect(() => {
    if (request === undefined) return;
    unanswered.current += 1;
    void (transcriberRef.current?.pause(request) ?? Promise.resolve()).finally(() => {
      unanswered.current -= 1;
      if (unanswered.current === 0) store.set(pauseRequestAtom, undefined);
    });
  }, [request, store]);

  return null;
}

/**
 * Transcribes this device's own speech while it is in a room call MindRoom transcribes. Calls with
 * an agent are left alone: they post their own transcript.
 */
export function CallTranscription() {
  const active = useActiveCall();
  if (active?.kind !== 'room') return null;
  return <RoomCallTranscription call={active.call} />;
}
