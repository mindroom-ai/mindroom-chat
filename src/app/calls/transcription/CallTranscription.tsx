import { useEffect, useRef } from 'react';
import { useAtomValue, useStore } from 'jotai';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { clientSessions } from '../../computer/clientSessions';
import { useRoomMindroomServer } from '../../computer/useRoomMindroomServer';
import { useActiveCall, useCallState } from '../callStore';
import type { RoomCall } from '../RoomCall';
import type { CallTranscriber } from './callTranscriber';
import {
  applyLiveUpdate,
  callTranscriptionAtom,
  liveTranscriptAtom,
  pauseRequestAtom,
} from './transcriptionState';

/** Transcribes this device's speech while it is connected to `call`. */
function RoomCallTranscription({ call }: { call: RoomCall }) {
  const mx = useMatrixClient();
  const store = useStore();
  const { roomId } = call.room;
  const server = useRoomMindroomServer(mx, roomId);
  const state = useCallState(call);
  const connected = state.phase === 'connected' || state.phase === 'reconnecting';
  const apiUrl = connected ? server.apiUrl : undefined;
  // A muted microphone sends nothing.
  const track = state.microphone ? state.microphoneTrack : undefined;
  // Pause or Resume pressed here pauses capture at once, until MindRoom answered every request:
  // nothing said before it resumed is sent. The transcriber pauses it while MindRoom says so.
  const requestPending = useAtomValue(pauseRequestAtom) !== undefined;

  const transcriberRef = useRef<CallTranscriber>();
  const latest = useRef({ track, requestPending });
  latest.current = { track, requestPending };

  useEffect(() => {
    if (!apiUrl) return undefined;
    let current = true;
    let transcriber: CallTranscriber | undefined;
    /** This call's Pause and Resume requests MindRoom has not answered yet. */
    let unanswered = 0;
    store.set(callTranscriptionAtom, { roomId, status: 'joining' });
    // Loaded on the first call MindRoom may transcribe, with the speech finder and the routes.
    import('./callTranscriber').then(
      ({ CallTranscriber: Transcriber }) => {
        if (!current) return;
        transcriber = new Transcriber({
          roomId,
          sessions: clientSessions(mx, apiUrl),
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
        transcriber.setRequestPending(latest.current.requestPending);
        transcriber.start();
      },
      () => {
        // Without its part (offline after a deployment) the call goes on untranscribed.
        if (current) store.set(callTranscriptionAtom, undefined);
      }
    );
    // Pause pressed here goes to MindRoom; once it answered (or refused) every request of this
    // call, the request ends. Answers that come after the call never touch another call's.
    const unsubscribe = store.sub(pauseRequestAtom, () => {
      const request = store.get(pauseRequestAtom);
      if (request === undefined) return;
      unanswered += 1;
      void (transcriber?.pause(request) ?? Promise.resolve()).finally(() => {
        unanswered -= 1;
        if (current && unanswered === 0) store.set(pauseRequestAtom, undefined);
      });
    });
    // A page that goes away leaves MindRoom's call at once, so nobody stays listed in it.
    const pageHide = () => void transcriber?.leaveNow();
    window.addEventListener('pagehide', pageHide);
    return () => {
      unsubscribe();
      window.removeEventListener('pagehide', pageHide);
      current = false;
      transcriberRef.current = undefined;
      void transcriber?.end();
      store.set(callTranscriptionAtom, undefined);
      store.set(liveTranscriptAtom, undefined);
      store.set(pauseRequestAtom, undefined);
    };
  }, [apiUrl, call, mx, roomId, store]);

  useEffect(() => {
    transcriberRef.current?.setMicrophone(track);
  }, [track]);

  useEffect(() => {
    transcriberRef.current?.setRequestPending(requestPending);
  }, [requestPending]);

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
